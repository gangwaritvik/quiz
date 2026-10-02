import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { startAttempt } from '@/lib/exam';
import { recordServerEvent } from '@/lib/exam-guard';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { countActiveSessions, getRequestContext, revokeOtherSessions } from '@/lib/session';
import { startExamSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  const session = await requireStudent();
  const context = await getRequestContext();
  enforceRateLimit(RATE_LIMITS.examStart, `start:${session.userId}`);

  const body = await parseBody(request, startExamSchema);

  const quiz = await prisma.quiz.findUnique({
    where: { id: body.quizId },
    select: { requireFullscreen: true, bindDeviceSession: true },
  });
  if (!quiz) throw new ApiError('NOT_FOUND', 'Quiz not found.');

  // The client's readiness report is corroborating evidence, not the gate:
  // the server refuses to start a fullscreen-required exam that the browser
  // has told us it cannot deliver.
  if (quiz.requireFullscreen && body.checks && body.checks.fullscreenSupported === false) {
    throw new ApiError(
      'QUIZ_UNAVAILABLE',
      'This exam requires fullscreen, which your browser does not support. Use a recent desktop browser.',
    );
  }

  // Single-session enforcement: other live sessions for this student are
  // revoked before the paper is generated.
  let revokedSessions = 0;
  if (quiz.bindDeviceSession) {
    const active = await countActiveSessions(session.userId);
    if (active > 1) {
      revokedSessions = await revokeOtherSessions(
        session.userId,
        session.sessionId,
        'exam_session_binding',
      );
    }
  }

  const { attempt, resumed } = await startAttempt({
    quizId: body.quizId,
    studentId: session.studentId,
    sessionId: session.sessionId,
    deviceHash: context.deviceHash,
    ipHash: context.ipHash,
  });

  if (revokedSessions > 0 && !resumed) {
    await recordServerEvent(attempt.id, 'MULTIPLE_SESSION', {
      revokedSessions,
      note: 'Other sessions were signed out when this exam started.',
    });
  }

  await audit({
    action: 'exam.attempt_started',
    userId: session.userId,
    entityType: 'QuizAttempt',
    entityId: attempt.id,
    context,
    metadata: { quizId: body.quizId, resumed },
  });

  return ok({
    attemptId: attempt.id,
    resumed,
    expiresAt: attempt.expiresAt.toISOString(),
    serverNow: new Date().toISOString(),
  });
});

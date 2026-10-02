import { ApiError, assertSameOrigin, ok, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getRequestContext } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

/**
 * Rebinds an in-progress attempt to the student's newest live session.
 *
 * After a crash or a forced laptop swap the attempt is still bound to the old
 * session and device, and `loadLiveAttempt` refuses every request from the new
 * one. Only the quiz's author may release it, and only onto a session the
 * student has already signed in with — the binding is moved, never removed.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { attemptId } = await params;

  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      status: true,
      sessionId: true,
      deviceHash: true,
      quiz: { select: { authorId: true } },
      student: { select: { userId: true, rollNumber: true } },
    },
  });
  if (!attempt) throw new ApiError('NOT_FOUND', 'Attempt not found.');
  if (attempt.quiz.authorId !== session.adminId) {
    throw new ApiError('FORBIDDEN', 'Only the faculty who set this quiz can release its attempts.');
  }
  if (attempt.status !== 'IN_PROGRESS') {
    throw new ApiError('CONFLICT', 'This attempt has already been submitted.');
  }

  const latest = await prisma.deviceSession.findFirst({
    where: { userId: attempt.student.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, deviceHash: true, deviceLabel: true },
  });

  // No live session yet: leave the binding alone (clearing it would let any
  // future session in) and tell faculty to have the student sign in first.
  if (!latest) return ok({ sessionBound: false });

  const result = await prisma.quizAttempt.updateMany({
    where: { id: attempt.id, status: 'IN_PROGRESS' },
    data: { sessionId: latest.id, deviceHash: latest.deviceHash },
  });
  if (result.count !== 1) {
    throw new ApiError('CONFLICT', 'This attempt has already been submitted.');
  }

  // No server-authored timeline event type fits a faculty rebind without
  // scoring as an integrity signal, so the audit log is the record.
  await audit({
    action: 'admin.device_reset',
    userId: session.userId,
    entityType: 'QuizAttempt',
    entityId: attempt.id,
    context,
    metadata: {
      kind: 'attempt_device_release',
      rollNumber: attempt.student.rollNumber,
      fromSession: attempt.sessionId?.slice(0, 8) ?? null,
      toSession: latest.id.slice(0, 8),
      deviceLabel: latest.deviceLabel,
    },
  });

  return ok({ sessionBound: true });
});

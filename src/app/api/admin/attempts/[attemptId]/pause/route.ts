import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertAttemptOwner } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { pauseAttemptSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

/** Concurrent changes on one attempt are retried this many times before giving up. */
const MAX_RETRIES = 4;

/**
 * Pauses or resumes one running attempt.
 *
 * Pausing records the instant; from then the server reports a constant time
 * remaining and refuses answer writes. Resuming moves the stored deadline
 * forward by the pause length, so the student gets back exactly the time they
 * had. Both are compare-and-set on the row (like adding time), so a double
 * click or a simultaneous "add time" is applied once and never lost.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { attemptId } = await params;

  enforceRateLimit(RATE_LIMITS.adminWrite, `pause:${session.userId}`);
  const { action } = await parseBody(request, pauseAttemptSchema);

  await assertAttemptOwner(attemptId, session.adminId);

  for (let tries = 0; tries < MAX_RETRIES; tries += 1) {
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      select: {
        status: true,
        expiresAt: true,
        pausedAt: true,
        pausedTotalMs: true,
        extraMinutes: true,
        quizId: true,
        student: { select: { rollNumber: true } },
      },
    });
    if (!attempt) throw new ApiError('NOT_FOUND', 'Attempt not found.');

    const now = new Date();
    if (attempt.status !== 'IN_PROGRESS') {
      throw new ApiError('CONFLICT', 'This attempt has already ended.');
    }

    if (action === 'pause') {
      if (attempt.pausedAt) throw new ApiError('CONFLICT', 'This attempt is already paused.');
      if (attempt.expiresAt <= now) throw new ApiError('CONFLICT', 'This attempt has already ended.');

      const { count } = await prisma.quizAttempt.updateMany({
        where: { id: attemptId, status: 'IN_PROGRESS', pausedAt: null, expiresAt: attempt.expiresAt },
        data: { pausedAt: now },
      });
      if (count !== 1) continue;

      await audit({
        action: 'admin.attempt_paused',
        userId: session.userId,
        entityType: 'QuizAttempt',
        entityId: attemptId,
        context,
        metadata: { rollNumber: attempt.student.rollNumber },
      });
      return ok({
        paused: true,
        expiresAt: attempt.expiresAt.toISOString(),
        remainingMs: Math.max(0, attempt.expiresAt.getTime() - now.getTime()),
      });
    }

    // resume
    if (!attempt.pausedAt) throw new ApiError('CONFLICT', 'This attempt is not paused.');
    const pausedMs = Math.max(0, now.getTime() - attempt.pausedAt.getTime());
    const expiresAt = new Date(attempt.expiresAt.getTime() + pausedMs);
    const pausedTotalMs = attempt.pausedTotalMs + pausedMs;

    // Results stay hidden until the longest sitting is over, so a pause counts
    // like extra time for that purpose. Raised first: if the write below loses
    // a race, scores stay hidden a little longer, never shorter.
    const horizonMinutes = attempt.extraMinutes + Math.ceil(pausedTotalMs / 60_000);
    await prisma.quiz.updateMany({
      where: { id: attempt.quizId, maxExtensionMinutes: { lt: horizonMinutes } },
      data: { maxExtensionMinutes: horizonMinutes },
    });

    const { count } = await prisma.quizAttempt.updateMany({
      where: {
        id: attemptId,
        status: 'IN_PROGRESS',
        pausedAt: attempt.pausedAt,
        expiresAt: attempt.expiresAt,
      },
      data: { expiresAt, pausedAt: null, pausedTotalMs },
    });
    if (count !== 1) continue;

    await audit({
      action: 'admin.attempt_resumed',
      userId: session.userId,
      entityType: 'QuizAttempt',
      entityId: attemptId,
      context,
      metadata: {
        rollNumber: attempt.student.rollNumber,
        pausedMs,
        pausedTotalMs,
        to: expiresAt.toISOString(),
      },
    });
    return ok({
      paused: false,
      expiresAt: expiresAt.toISOString(),
      remainingMs: Math.max(0, expiresAt.getTime() - now.getTime()),
    });
  }

  throw new ApiError('CONFLICT', 'This attempt changed while you were updating it. Try again.');
});

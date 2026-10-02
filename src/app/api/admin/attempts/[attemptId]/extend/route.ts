import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertAttemptOwner } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { extendExpiresAt, extensionRefusal, pauseAdjustedExpiresAt } from '@/lib/time-extension';
import { extendAttemptSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

/** Concurrent grants on one attempt are retried this many times before giving up. */
const MAX_RETRIES = 4;

/**
 * Adds time to a running attempt.
 *
 * The write is a compare-and-set on the attempt's current deadline, so two
 * faculty adding time at once (or a double click) are each applied exactly once
 * and neither can overshoot the total cap. An attempt that has finished, or
 * whose time is already up, is refused: the student's browser may be submitting
 * it, and a late grant must not resurrect it.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { attemptId } = await params;

  enforceRateLimit(RATE_LIMITS.adminWrite, `extend:${session.userId}`);
  const { minutes } = await parseBody(request, extendAttemptSchema);

  await assertAttemptOwner(attemptId, session.adminId);

  for (let tries = 0; tries < MAX_RETRIES; tries += 1) {
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      select: {
        status: true,
        expiresAt: true,
        extraMinutes: true,
        pausedAt: true,
        quizId: true,
        student: { select: { rollNumber: true } },
      },
    });
    if (!attempt) throw new ApiError('NOT_FOUND', 'Attempt not found.');

    const now = new Date();
    if (attempt.status !== 'IN_PROGRESS' || pauseAdjustedExpiresAt(attempt.expiresAt, attempt.pausedAt, now) <= now) {
      throw new ApiError('CONFLICT', 'This attempt has already ended.');
    }

    const refusal = extensionRefusal(attempt.extraMinutes, minutes);
    if (refusal) throw new ApiError('VALIDATION', refusal);

    const extraMinutes = attempt.extraMinutes + minutes;
    const expiresAt = extendExpiresAt(attempt.expiresAt, minutes);

    // Raise the quiz's results-release horizon first: if the attempt write below
    // then loses a race, scores stay hidden a little longer, never shorter.
    await prisma.quiz.updateMany({
      where: { id: attempt.quizId, maxExtensionMinutes: { lt: extraMinutes } },
      data: { maxExtensionMinutes: extraMinutes },
    });

    const { count } = await prisma.quizAttempt.updateMany({
      where: {
        id: attemptId,
        status: 'IN_PROGRESS',
        expiresAt: attempt.expiresAt,
        extraMinutes: attempt.extraMinutes,
      },
      data: { expiresAt, extraMinutes },
    });
    if (count !== 1) continue; // somebody else moved the deadline: re-read and retry

    await audit({
      action: 'admin.time_extended',
      userId: session.userId,
      entityType: 'QuizAttempt',
      entityId: attemptId,
      context,
      metadata: {
        kind: 'live_extension',
        minutes,
        extraMinutes,
        rollNumber: attempt.student.rollNumber,
        from: attempt.expiresAt.toISOString(),
        to: expiresAt.toISOString(),
      },
    });

    return ok({
      expiresAt: expiresAt.toISOString(),
      extraMinutes,
      remainingMs: Math.max(0, expiresAt.getTime() - Date.now()),
    });
  }

  throw new ApiError('CONFLICT', 'This attempt changed while you were adding time. Try again.');
});

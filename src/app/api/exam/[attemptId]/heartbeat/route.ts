import { assertSameOrigin, ok, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { loadLiveAttempt, recordServerEvent } from '@/lib/exam-guard';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

/** Gap after which a silent client is treated as having lost connectivity. */
const MISSED_HEARTBEAT_MS = 45_000;

/**
 * Liveness ping. Doubles as the authoritative time sync: the client discards
 * its own drift and re-anchors the countdown to `remainingMs` on every beat.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireStudent();
  const context = await getRequestContext();
  const { attemptId } = await params;

  enforceRateLimit(RATE_LIMITS.examEvent, `heartbeat:${session.userId}:${attemptId}`);

  const { attempt, remaining } = await loadLiveAttempt(attemptId, session, context);

  const gapMs = Date.now() - attempt.lastSeenAt.getTime();
  if (gapMs > MISSED_HEARTBEAT_MS) {
    await recordServerEvent(attempt.id, 'HEARTBEAT_MISSED', { gapMs });
  }

  await prisma.quizAttempt.update({
    where: { id: attempt.id },
    data: { lastSeenAt: new Date() },
  });

  const integrity = await prisma.integrityScore.findUnique({
    where: { attemptId: attempt.id },
    select: { score: true, status: true },
  });

  return ok({
    alive: true,
    timer: {
      remainingMs: remaining.remainingMs,
      expiresAt: remaining.expiresAt.toISOString(),
      serverNow: new Date().toISOString(),
    },
    extraMinutes: attempt.extraMinutes,
    integrity: integrity ?? { score: 100, status: 'NORMAL' },
  });
});

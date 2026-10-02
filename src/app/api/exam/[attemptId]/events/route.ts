import { assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { loadLiveAttempt } from '@/lib/exam-guard';
import { recomputeIntegrityScore, severityForEvent } from '@/lib/integrity';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { examEventBatchSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

/**
 * Ingests client-reported security events.
 *
 * Two deliberate constraints:
 *  1. `examEventBatchSchema` only admits the event types a browser can
 *     legitimately observe — a client cannot inject MULTIPLE_SESSION or
 *     ATTEMPT_SUBMITTED to muddy its own timeline.
 *  2. `occurredAt` is the server clock. Any client timestamp is kept in
 *     metadata for forensics but never trusted for ordering.
 *
 * Absence of events proves nothing: a determined student can disable
 * JavaScript event reporting. This is one signal among several, which is
 * exactly why the output is a review indicator rather than a verdict.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireStudent();
  const context = await getRequestContext();
  const { attemptId } = await params;

  enforceRateLimit(RATE_LIMITS.examEvent, `events:${attemptId}`);

  // Events are still accepted for a just-submitted attempt so the tail end of
  // a session (fullscreen exit on submit, for example) is not lost.
  const { attempt } = await loadLiveAttempt(attemptId, session, context, {
    allowSubmitted: true,
  });

  const body = await parseBody(request, examEventBatchSchema);

  await prisma.examEvent.createMany({
    data: body.events.map((event) => ({
      attemptId: attempt.id,
      type: event.type,
      severity: severityForEvent(event.type),
      durationMs: event.durationMs ?? null,
      metadata: {
        ...(event.metadata ?? {}),
        ...(event.clientTimestamp ? { clientTs: event.clientTimestamp } : {}),
        deviceLabel: context.deviceLabel,
      },
    })),
  });

  await prisma.quizAttempt.update({
    where: { id: attempt.id },
    data: { lastSeenAt: new Date() },
  });

  const integrity = await recomputeIntegrityScore(attempt.id);

  return ok({
    recorded: body.events.length,
    integrity: { score: integrity.score, status: integrity.status },
  });
});

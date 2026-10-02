import { NextResponse } from 'next/server';

import { assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { loadLiveAttempt } from '@/lib/exam-guard';
import { recomputeIntegrityScoreThrottled, severityForEvent } from '@/lib/integrity';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { examEventBatchSchema, examEventTypeSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

const MAX_BODY_BYTES = 64 * 1024;
/** Tail events (fullscreen exit on submit) are accepted for this long after submission. */
const POST_SUBMIT_WINDOW_MS = 60_000;
/** Stored client events per attempt; anything beyond is dropped, not errored. */
const MAX_CLIENT_EVENTS = 2000;
const RECOMPUTE_INTERVAL_MS = 30_000;

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

  enforceRateLimit(RATE_LIMITS.examEvent, `events:${session.userId}:${attemptId}`);

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION', message: 'Event batch is too large.' } },
      { status: 413 },
    );
  }

  // Events are still accepted for a just-submitted attempt so the tail end of
  // a session (fullscreen exit on submit, for example) is not lost.
  const { attempt } = await loadLiveAttempt(attemptId, session, context, {
    allowSubmitted: true,
  });

  const body = await parseBody(request, examEventBatchSchema);

  const submitted = attempt.status !== 'IN_PROGRESS';
  if (
    submitted &&
    (!attempt.submittedAt || Date.now() - attempt.submittedAt.getTime() > POST_SUBMIT_WINDOW_MS)
  ) {
    // Acknowledged so the client stops retrying, but nothing is stored.
    return ok({ recorded: 0, dropped: body.events.length });
  }

  const stored = await prisma.examEvent.count({
    where: { attemptId: attempt.id, type: { in: examEventTypeSchema.options } },
  });
  const accepted = body.events.slice(0, Math.max(0, MAX_CLIENT_EVENTS - stored));
  const dropped = body.events.length - accepted.length;
  if (dropped > 0) {
    console.warn('[exam] client event cap reached; dropping', { attemptId: attempt.id, dropped });
  }

  if (accepted.length > 0) {
    await prisma.examEvent.createMany({
      data: accepted.map((event) => ({
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
  }

  await prisma.quizAttempt.update({
    where: { id: attempt.id },
    data: { lastSeenAt: new Date() },
  });

  // Finalisation already recomputed at submit; tail events after it are few
  // and bounded by the window above, so they recompute without throttling.
  const integrity = await recomputeIntegrityScoreThrottled(
    attempt.id,
    submitted ? 0 : RECOMPUTE_INTERVAL_MS,
  );

  return ok({
    recorded: accepted.length,
    dropped,
    integrity: { score: integrity.score, status: integrity.status },
  });
});

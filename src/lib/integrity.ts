import 'server-only';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { computeIntegrity } from '@/lib/integrity-engine';

/**
 * Persistence for the Integrity Engine.
 *
 * The scoring rules themselves live in `integrity-engine.ts`, which has no
 * database or runtime dependencies — so the seed, tests and any future
 * reporting job all score attempts through exactly the same code as the live
 * request path.
 */

export {
  computeIntegrity,
  statusForScore,
  severityForEvent,
  INTEGRITY_THRESHOLDS,
  INTEGRITY_STATUS_LABEL,
  EVENT_LABELS,
  type IntegrityComputation,
  type SignalBreakdown,
} from '@/lib/integrity-engine';

/** Recomputes and persists the integrity score for one attempt. */
export async function recomputeIntegrityScore(attemptId: string) {
  const events = await prisma.examEvent.findMany({
    where: { attemptId },
    // `metadata` is selected because the engine uses it to tell a blur caused
    // by an open file picker from one caused by leaving the exam.
    select: { type: true, durationMs: true, metadata: true },
  });

  const computation = computeIntegrity(events);

  await prisma.integrityScore.upsert({
    where: { attemptId },
    create: {
      attemptId,
      score: computation.score,
      status: computation.status,
      breakdown: computation.breakdown as unknown as Prisma.InputJsonValue,
    },
    update: {
      score: computation.score,
      status: computation.status,
      breakdown: computation.breakdown as unknown as Prisma.InputJsonValue,
      computedAt: new Date(),
    },
  });

  return computation;
}

/**
 * Recomputes only when the stored score is older than `minIntervalMs`, so a
 * stream of client events cannot turn every request into a full rescan.
 * Submission and server-authored events still recompute unconditionally.
 */
export async function recomputeIntegrityScoreThrottled(attemptId: string, minIntervalMs: number) {
  const stored = await prisma.integrityScore.findUnique({
    where: { attemptId },
    select: { score: true, status: true, computedAt: true },
  });
  if (stored && Date.now() - stored.computedAt.getTime() < minIntervalMs) return stored;
  return recomputeIntegrityScore(attemptId);
}

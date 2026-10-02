import 'server-only';

import type { Quiz, QuizAttempt } from '@prisma/client';

import { ApiError } from '@/lib/api';
import type { StudentSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { finalizeAttempt, remainingTime, SUBMIT_GRACE_MS } from '@/lib/exam';
import { recomputeIntegrityScore, severityForEvent } from '@/lib/integrity';
import type { RequestContext } from '@/lib/session';

export interface LiveAttempt {
  attempt: QuizAttempt & { quiz: Quiz };
  remaining: ReturnType<typeof remainingTime>;
}

/**
 * The single choke point every in-exam request passes through.
 *
 * Order matters: ownership before existence details, then session/device
 * binding, then the clock. Binding violations are recorded as integrity events
 * *and* refused — detection alone would not stop a shared login.
 */
export async function loadLiveAttempt(
  attemptId: string,
  session: StudentSession,
  context: RequestContext,
  options: { allowSubmitted?: boolean } = {},
): Promise<LiveAttempt> {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    include: { quiz: true },
  });

  if (!attempt) throw new ApiError('NOT_FOUND', 'Attempt not found.');

  // IDOR guard — the attempt id is a lookup key, never an authorisation token.
  if (attempt.studentId !== session.studentId) {
    throw new ApiError('FORBIDDEN', 'This attempt does not belong to you.');
  }

  if (attempt.status !== 'IN_PROGRESS') {
    if (options.allowSubmitted) {
      return { attempt, remaining: remainingTime(attempt.expiresAt) };
    }
    throw new ApiError('ATTEMPT_EXPIRED', 'This attempt has already been submitted.');
  }

  if (attempt.quiz.bindDeviceSession) {
    if (attempt.deviceHash && attempt.deviceHash !== context.deviceHash) {
      await recordServerEvent(attempt.id, 'DEVICE_MISMATCH', {
        expected: attempt.deviceHash.slice(0, 12),
        received: context.deviceHash.slice(0, 12),
      });
      throw new ApiError(
        'DEVICE_MISMATCH',
        'This exam was started on a different device. Continue on the original device, or contact your invigilator.',
      );
    }

    if (attempt.sessionId && attempt.sessionId !== session.sessionId) {
      await recordServerEvent(attempt.id, 'MULTIPLE_SESSION', {
        attemptSession: attempt.sessionId.slice(0, 8),
        requestSession: session.sessionId.slice(0, 8),
      });
      throw new ApiError(
        'CONFLICT',
        'This exam is already open in another session. Close the other window and reload.',
      );
    }
  }

  const remaining = remainingTime(attempt.expiresAt);
  if (remaining.remainingMs <= 0) {
    // The clock ran out while the client was away; grade now so the student
    // cannot keep answering past the deadline.
    if (Date.now() - attempt.expiresAt.getTime() > SUBMIT_GRACE_MS) {
      await finalizeAttempt(attempt.id, 'AUTO_SUBMITTED');
      throw new ApiError('ATTEMPT_EXPIRED', 'Time is up — your exam has been submitted.');
    }
  }

  return { attempt, remaining };
}

/** Records an event that only the server may author. */
export async function recordServerEvent(
  attemptId: string,
  type: Parameters<typeof severityForEvent>[0],
  metadata?: Record<string, unknown>,
) {
  await prisma.examEvent.create({
    data: {
      attemptId,
      type,
      severity: severityForEvent(type),
      metadata: (metadata ?? {}) as object,
    },
  });
  await recomputeIntegrityScore(attemptId);
}

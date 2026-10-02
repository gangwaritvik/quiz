import { assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { finalizeAttempt, remainingTime, resultsVisibility } from '@/lib/exam';
import { effectiveEndsAt, pauseAdjustedExpiresAt } from '@/lib/time-extension';
import { loadLiveAttempt } from '@/lib/exam-guard';
import { getRequestContext } from '@/lib/session';
import { submitExamSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireStudent();
  const context = await getRequestContext();
  const { attemptId } = await params;

  // `allowSubmitted` makes a repeated submit idempotent rather than an error —
  // a flaky connection retrying must not produce a scary failure.
  const { attempt } = await loadLiveAttempt(attemptId, session, context, {
    allowSubmitted: true,
  });

  if (attempt.status === 'IN_PROGRESS') {
    await parseBody(request, submitExamSchema);
  }

  const expired = remainingTime(pauseAdjustedExpiresAt(attempt.expiresAt, attempt.pausedAt)).expired;
  const finalized = await finalizeAttempt(
    attemptId,
    expired ? 'AUTO_SUBMITTED' : 'SUBMITTED',
  );

  await audit({
    action: expired ? 'exam.attempt_auto_submitted' : 'exam.attempt_submitted',
    userId: session.userId,
    entityType: 'QuizAttempt',
    entityId: attemptId,
    context,
  });

  // Every response kind counts: an option, a multi-select, text, or an upload.
  // (Whitespace-only text is stored as null by `saveAnswer`.)
  const answered = await prisma.answer.count({
    where: {
      attemptId,
      OR: [
        { selectedOptionId: { not: null } },
        { textResponse: { not: null } },
        { selectedOptions: { some: {} } },
        { attachments: { some: {} } },
      ],
    },
  });
  const total = await prisma.attemptQuestion.count({ where: { attemptId } });

  return ok({
    attemptId,
    status: finalized.status,
    submittedAt: (finalized.submittedAt ?? new Date()).toISOString(),
    answered,
    total,
    autoSubmitted: expired,
    // Scores are withheld here regardless; the results endpoint applies the
    // teacher's release policy.
    resultsReleased: resultsVisibility(finalized.quiz).results,
    releasesAt: finalized.quiz.releaseResults ? effectiveEndsAt(finalized.quiz).toISOString() : null,
  });
});

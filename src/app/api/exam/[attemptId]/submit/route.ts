import { assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { finalizeAttempt, remainingTime } from '@/lib/exam';
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

  const expired = remainingTime(attempt.expiresAt).expired;
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

  const answered = await prisma.answer.count({
    where: { attemptId, selectedOptionId: { not: null } },
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
    resultsReleased: finalized.quiz.releaseResults,
  });
});

import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { loadLiveAttempt } from '@/lib/exam-guard';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { flagQuestionSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

/** Toggles "mark for review" without touching the selected answer. */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireStudent();
  const context = await getRequestContext();
  const { attemptId } = await params;

  enforceRateLimit(RATE_LIMITS.answerSave, `flag:${attemptId}`);
  await loadLiveAttempt(attemptId, session, context);

  const body = await parseBody(request, flagQuestionSchema);

  const attemptQuestion = await prisma.attemptQuestion.findUnique({
    where: { id: body.attemptQuestionId },
    select: { id: true, attemptId: true },
  });
  if (!attemptQuestion || attemptQuestion.attemptId !== attemptId) {
    throw new ApiError('FORBIDDEN', 'That question is not part of this attempt.');
  }

  const answer = await prisma.answer.upsert({
    where: { attemptQuestionId: attemptQuestion.id },
    create: {
      attemptId,
      attemptQuestionId: attemptQuestion.id,
      selectedOptionId: null,
      markedForReview: body.markedForReview,
    },
    update: { markedForReview: body.markedForReview },
    select: { markedForReview: true, selectedOptionId: true },
  });

  return ok({
    attemptQuestionId: body.attemptQuestionId,
    markedForReview: answer.markedForReview,
    selectedOptionId: answer.selectedOptionId,
  });
});

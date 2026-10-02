import { assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { saveAnswer } from '@/lib/exam';
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

  enforceRateLimit(RATE_LIMITS.answerSave, `flag:${session.userId}:${attemptId}`);
  await loadLiveAttempt(attemptId, session, context);

  const body = await parseBody(request, flagQuestionSchema);

  // Goes through saveAnswer so the flag gets the same checks as an answer: the
  // question must be on this paper, and nothing is written once the attempt is
  // finalised.
  const answer = await saveAnswer({
    attemptId,
    studentId: session.studentId,
    attemptQuestionId: body.attemptQuestionId,
    markedForReview: body.markedForReview,
  });

  return ok({
    attemptQuestionId: body.attemptQuestionId,
    markedForReview: answer.markedForReview,
    selectedOptionId: answer.selectedOptionId,
  });
});

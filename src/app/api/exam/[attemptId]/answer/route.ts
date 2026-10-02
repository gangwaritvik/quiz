import { assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { saveAnswer } from '@/lib/exam';
import { loadLiveAttempt } from '@/lib/exam-guard';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { saveAnswerSchema } from '@/lib/validation';

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

  enforceRateLimit(RATE_LIMITS.answerSave, `answer:${attemptId}`);

  const { remaining } = await loadLiveAttempt(attemptId, session, context);
  const body = await parseBody(request, saveAnswerSchema);

  const answer = await saveAnswer({
    attemptId,
    studentId: session.studentId,
    attemptQuestionId: body.attemptQuestionId,
    selectedOptionId: body.selectedOptionId,
    selectedOptionIds: body.selectedOptionIds,
    textResponse: body.textResponse,
    markedForReview: body.markedForReview,
  });

  // The response carries no grading information — `isCorrect` is only written
  // during submission and is not selected here.
  return ok({
    saved: true,
    attemptQuestionId: body.attemptQuestionId,
    selectedOptionId: answer.selectedOptionId,
    selectedOptionIds: answer.selectedOptionIds,
    textResponse: answer.textResponse,
    markedForReview: answer.markedForReview,
    timer: {
      remainingMs: remaining.remainingMs,
      serverNow: new Date().toISOString(),
    },
  });
});

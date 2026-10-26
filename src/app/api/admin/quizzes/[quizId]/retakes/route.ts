import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { grantOne, revokeUnused } from '@/lib/attempt-policy';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resultsVisibility } from '@/lib/exam';
import { assertQuizOwner } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { retakeGrantSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ quizId: string }>;
}

/**
 * Lets one student sit a single-attempt quiz again (for a crash, a lost
 * connection, a genuine problem), or takes back a grant they have not used.
 *
 * It never edits the quiz: the student simply gets one more allowed start,
 * inside the same window. A retake is refused once the window has closed, and
 * once answers have been released, because the student would sit the paper
 * having seen the key.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { quizId } = await params;

  enforceRateLimit(RATE_LIMITS.adminWrite, `retake:${session.userId}`);
  const { studentId, action } = await parseBody(request, retakeGrantSchema);

  await assertQuizOwner(quizId, session.adminId);

  const quiz = await prisma.quiz.findUniqueOrThrow({
    where: { id: quizId },
    select: {
      singleAttempt: true,
      status: true,
      startsAt: true,
      endsAt: true,
      releaseResults: true,
      releaseAnswers: true,
      maxExtensionMinutes: true,
    },
  });
  if (!quiz.singleAttempt) {
    throw new ApiError('CONFLICT', 'This quiz already lets every student attempt it more than once.');
  }

  const assignment = await prisma.quizAssignment.findUnique({
    where: { quizId_studentId: { quizId, studentId } },
    select: { extraAttempts: true },
  });
  if (!assignment) throw new ApiError('NOT_FOUND', 'That student is not assigned to this quiz.');

  const attemptsMade = await prisma.quizAttempt.count({ where: { quizId, studentId } });
  const current = assignment.extraAttempts;

  let next: number;
  if (action === 'grant') {
    const now = new Date();
    if (quiz.status !== 'PUBLISHED') {
      throw new ApiError('CONFLICT', 'This quiz is not open, so a retake cannot be granted.');
    }
    if (now > quiz.endsAt) {
      throw new ApiError(
        'CONFLICT',
        'The quiz window has closed. A retake has to be taken inside the window, so extend the window first.',
      );
    }
    if (resultsVisibility(quiz, now).answers) {
      throw new ApiError(
        'CONFLICT',
        'Answers have already been released, so a retake would be sat with the key in view.',
      );
    }
    // Without this, a double click stacks a second retake on top of one not yet used.
    if (1 + current > attemptsMade) {
      throw new ApiError('CONFLICT', 'This student already has an attempt they have not used.');
    }
    next = grantOne(current, attemptsMade);
    if (next === current) {
      throw new ApiError(
        'CONFLICT',
        'This student already has the most extra attempts one student can be given.',
      );
    }
  } else {
    next = revokeUnused(current, attemptsMade);
  }

  await prisma.quizAssignment.update({
    where: { quizId_studentId: { quizId, studentId } },
    data: { extraAttempts: next },
  });

  await audit({
    action: 'admin.attempt_granted',
    userId: session.userId,
    entityType: 'Quiz',
    entityId: quizId,
    context,
    metadata: { studentId, action, from: current, to: next, attemptsMade },
  });

  return ok({ studentId, extraAttempts: next, attemptsMade, canStart: next >= attemptsMade });
});

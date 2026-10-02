import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resultsVisibility } from '@/lib/exam';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { fileAppealSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

/** Most appeals one attempt can ever collect, so a result cannot be re-argued forever. */
const MAX_APPEALS_PER_ATTEMPT = 3;

/**
 * A student asks faculty to re-check their own released result.
 *
 * Only after results are released and every answer has been marked: before
 * then there is nothing final to dispute. One appeal can be open at a time, and
 * the student's own words are the whole request: which question, and why.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireStudent();
  const context = await getRequestContext();
  const { attemptId } = await params;

  enforceRateLimit(RATE_LIMITS.appealSubmit, `appeal:${session.userId}`);
  const { reason } = await parseBody(request, fileAppealSchema);

  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      studentId: true,
      status: true,
      pendingManualCount: true,
      quiz: {
        select: {
          id: true,
          releaseResults: true,
          releaseAnswers: true,
          endsAt: true,
          maxExtensionMinutes: true,
        },
      },
    },
  });

  if (!attempt) throw new ApiError('NOT_FOUND', 'Result not found.');
  if (attempt.studentId !== session.studentId) {
    throw new ApiError('FORBIDDEN', 'This result does not belong to you.');
  }
  if (attempt.status === 'IN_PROGRESS' || !resultsVisibility(attempt.quiz).results) {
    throw new ApiError('CONFLICT', 'You can ask for a re-check once your result has been released.');
  }
  if (attempt.pendingManualCount > 0) {
    throw new ApiError(
      'CONFLICT',
      'Some answers are still being marked. Ask for a re-check once your result is final.',
    );
  }

  const existing = await prisma.resultAppeal.findMany({
    where: { attemptId },
    select: { status: true },
  });
  if (existing.some((appeal) => appeal.status === 'OPEN')) {
    throw new ApiError('CONFLICT', 'You already have a re-check request waiting for your faculty.');
  }
  if (existing.length >= MAX_APPEALS_PER_ATTEMPT) {
    throw new ApiError('CONFLICT', 'This result has reached the most re-check requests it can have.');
  }

  const appeal = await prisma.resultAppeal.create({
    data: { attemptId, studentId: session.studentId, reason },
    select: { id: true, status: true, createdAt: true },
  });

  await audit({
    action: 'student.appeal_filed',
    userId: session.userId,
    entityType: 'QuizAttempt',
    entityId: attemptId,
    context,
    metadata: { appealId: appeal.id, length: reason.length },
  });

  return ok({ id: appeal.id, status: appeal.status, createdAt: appeal.createdAt.toISOString() });
});

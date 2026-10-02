import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { gradeAnswerManually } from '@/lib/exam';
import { assertAppealOwner } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { resolveAppealSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ appealId: string }>;
}

/**
 * Answers a re-check request. Upholding may change marks on this student's
 * answers (including ones the server graded itself); every change goes through
 * the same marking path as ordinary marking, so the attempt's score is
 * recomputed and the change is on its timeline. Rejecting changes nothing.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { appealId } = await params;

  enforceRateLimit(RATE_LIMITS.adminWrite, `appeal-resolve:${session.userId}`);
  const body = await parseBody(request, resolveAppealSchema);

  await assertAppealOwner(appealId, session.adminId);

  const appeal = await prisma.resultAppeal.findUniqueOrThrow({
    where: { id: appealId },
    select: { id: true, attemptId: true, status: true },
  });
  if (appeal.status !== 'OPEN') {
    throw new ApiError('CONFLICT', 'This request has already been answered.');
  }

  // Only answers on this very attempt may be changed through this appeal.
  if (body.adjustments.length > 0) {
    const own = await prisma.answer.findMany({
      where: { attemptId: appeal.attemptId, id: { in: body.adjustments.map((a) => a.answerId) } },
      select: { id: true, attemptQuestion: { select: { marks: true } } },
    });
    if (own.length !== new Set(body.adjustments.map((a) => a.answerId)).size) {
      throw new ApiError('VALIDATION', "One of those answers is not part of this student's attempt.");
    }
    // Checked before the appeal is claimed, so a bad figure cannot leave it half done.
    const maxById = new Map(own.map((answer) => [answer.id, answer.attemptQuestion.marks]));
    for (const adjustment of body.adjustments) {
      const max = maxById.get(adjustment.answerId)!;
      if (adjustment.awardedMarks > max) {
        throw new ApiError('VALIDATION', `Marks cannot be more than ${max} for that question.`);
      }
    }
  }

  // Claim the appeal first: of two simultaneous answers, only one proceeds.
  const claimed = await prisma.resultAppeal.updateMany({
    where: { id: appealId, status: 'OPEN' },
    data: {
      status: body.status,
      facultyNote: body.note,
      resolvedById: session.adminId,
      resolvedAt: new Date(),
    },
  });
  if (claimed.count !== 1) throw new ApiError('CONFLICT', 'This request has already been answered.');

  const changed: Array<{ answerId: string; awardedMarks: number }> = [];
  for (const adjustment of body.adjustments) {
    await gradeAnswerManually({
      answerId: adjustment.answerId,
      adminId: session.adminId,
      awardedMarks: adjustment.awardedMarks,
      note: `Re-check: ${body.note}`,
      override: true,
    });
    changed.push(adjustment);
  }

  await audit({
    action: 'admin.appeal_resolved',
    userId: session.userId,
    entityType: 'QuizAttempt',
    entityId: appeal.attemptId,
    context,
    metadata: { appealId, status: body.status, changed },
  });

  const attempt = await prisma.quizAttempt.findUniqueOrThrow({
    where: { id: appeal.attemptId },
    select: { score: true, maxScore: true, percentage: true },
  });

  return ok({ id: appealId, status: body.status, ...attempt });
});

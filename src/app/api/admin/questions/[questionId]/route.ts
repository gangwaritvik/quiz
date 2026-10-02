import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { deleteUnreferencedAssets } from '@/lib/media';
import { questionFieldsFromInput, questionOptionsFromInput } from '@/lib/questions';
import { getRequestContext } from '@/lib/session';
import { updateQuestionSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ questionId: string }>;
}

export const PATCH = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { questionId } = await params;

  const body = await parseBody(request, updateQuestionSchema);

  const existing = await prisma.question.findUnique({
    where: { id: questionId },
    include: {
      _count: { select: { attemptQuestions: true } },
      options: { select: { imageAssetId: true } },
    },
  });
  if (!existing) throw new ApiError('NOT_FOUND', 'Question not found.');

  // The images this question referenced before the edit. Options are replaced
  // wholesale below, and the diagram may have been cleared, so any of these can
  // end up referenced by nothing at all.
  const previousAssetIds = [
    existing.imageAssetId,
    ...existing.options.map((option) => option.imageAssetId),
  ];

  // Options are replaced wholesale, which would orphan the answers of anyone
  // still sitting an exam that served this question.
  const liveUse = await prisma.attemptQuestion.count({
    where: { questionId, attempt: { status: 'IN_PROGRESS' } },
  });
  if (liveUse > 0) {
    throw new ApiError(
      'CONFLICT',
      'This question is on a paper that is currently being attempted. Edit it once those exams finish.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.option.deleteMany({ where: { questionId } });
    await tx.question.update({
      where: { id: questionId },
      data: {
        ...questionFieldsFromInput(body),
        subjectId: body.subjectId,
        options: { create: questionOptionsFromInput(body) },
      },
    });
  });

  const sweptAssets = await deleteUnreferencedAssets(previousAssetIds);

  await audit({
    action: 'admin.question_updated',
    userId: session.userId,
    entityType: 'Question',
    entityId: questionId,
    context,
    metadata: sweptAssets > 0 ? { imagesRemoved: sweptAssets } : undefined,
  });

  return ok({ questionId });
});

/**
 * Soft delete. Hard-deleting would break the historical record of every
 * attempt that served this question, so it is retired instead.
 */
export const DELETE = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { questionId } = await params;

  const existing = await prisma.question.findUnique({ where: { id: questionId } });
  if (!existing) throw new ApiError('NOT_FOUND', 'Question not found.');

  await prisma.question.update({ where: { id: questionId }, data: { active: false } });

  await audit({
    action: 'admin.question_deleted',
    userId: session.userId,
    entityType: 'Question',
    entityId: questionId,
    context,
    metadata: { softDelete: true },
  });

  return ok({ retired: true });
});

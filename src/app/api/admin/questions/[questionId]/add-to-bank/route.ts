import { assertNoBankRepeat } from '@/lib/ai/similarity';
import { ApiError, assertSameOrigin, ok, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ questionId: string }>;
}

/**
 * Moves a question that belongs to one quiz only into the shared bank. It stays
 * on the quiz. Refused when the bank already has one of the same meaning,
 * unless the teacher says to add it anyway.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);
  const session = await requireAdmin();
  const context = await getRequestContext();
  const { questionId } = await params;
  enforceRateLimit(RATE_LIMITS.adminWrite, `question-to-bank:${session.userId}`);

  const raw = await request.text();
  let allowSimilar = false;
  try {
    allowSimilar = raw.trim() ? (JSON.parse(raw) as { allowSimilar?: unknown }).allowSimilar === true : false;
  } catch {
    allowSimilar = false;
  }

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { id: true, text: true, assertionText: true, reasonText: true, subjectId: true, authorId: true, adHoc: true, active: true },
  });
  if (!question || !question.active) throw new ApiError('NOT_FOUND', 'Question not found.');
  if (question.authorId !== session.adminId) {
    throw new ApiError('FORBIDDEN', 'Only the faculty member who wrote this question can add it to the bank.');
  }
  if (!question.adHoc) throw new ApiError('CONFLICT', 'This question is already in the bank.');

  await assertNoBankRepeat({ subjectId: question.subjectId, question, allowSimilar });

  await prisma.question.update({ where: { id: questionId }, data: { adHoc: false } });
  await audit({
    action: 'admin.question_updated',
    userId: session.userId,
    entityType: 'Question',
    entityId: questionId,
    context,
    metadata: { change: 'added_to_bank', allowSimilar },
  });
  return ok({ questionId });
});

import { findDuplicateGroups } from '@/lib/ai/similarity';
import { AiError, aiEnabled } from '@/lib/ai/provider';
import { ApiError, ok, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ subjectId: string }>;
}

/**
 * Questions in a subject's bank that mean the same as one another, in groups,
 * so the teacher can keep one and retire the rest. The bank is shared for
 * reading; `mine` says which of them this teacher may retire.
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireAdmin();
  const { subjectId } = await params;
  if (!aiEnabled()) return ok({ enabled: false, scanned: 0, groups: [] });
  enforceRateLimit(RATE_LIMITS.adminWrite, `duplicate-scan:${session.userId}`);

  const subject = await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true } });
  if (!subject) throw new ApiError('NOT_FOUND', 'Subject not found.');

  let ids: string[][];
  try {
    ids = await findDuplicateGroups(subjectId);
  } catch (error) {
    if (error instanceof AiError) throw new ApiError('CONFLICT', error.message);
    throw error;
  }

  const questions = await prisma.question.findMany({
    where: { id: { in: ids.flat() } },
    select: {
      id: true,
      text: true,
      assertionText: true,
      type: true,
      difficulty: true,
      marks: true,
      aiGenerated: true,
      authorId: true,
      createdAt: true,
      topic: { select: { name: true } },
      _count: { select: { quizLinks: true } },
    },
  });
  const byId = new Map(questions.map((question) => [question.id, question]));
  const scanned = await prisma.question.count({ where: { subjectId, active: true, adHoc: false } });

  return ok({
    enabled: true,
    scanned,
    groups: ids.map((group) =>
      group
        .map((id) => byId.get(id)!)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((question) => ({
          id: question.id,
          text: question.text,
          assertionText: question.assertionText,
          type: question.type,
          difficulty: question.difficulty,
          marks: question.marks,
          aiGenerated: question.aiGenerated,
          topic: question.topic?.name ?? null,
          onQuizzes: question._count.quizLinks,
          createdAt: question.createdAt.toISOString(),
          mine: question.authorId === session.adminId,
        })),
    ),
  });
});

import { questionSignature } from '@/lib/ai/question-generation';
import { assemblePaper } from '@/lib/assemble-paper';
import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { assemblePaperSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Most bank questions considered for one paper. */
const CANDIDATE_LIMIT = 1500;

/**
 * Proposes a fixed paper from the subject's bank: the difficulty mix asked for,
 * spread over the topics, fresh questions first, no two that mean the same.
 * Nothing is saved; the teacher reviews the proposal on the quiz form.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const session = await requireAdmin();
  enforceRateLimit(RATE_LIMITS.adminWrite, `assemble:${session.userId}`);
  const body = await parseBody(request, assemblePaperSchema);

  const subject = await prisma.subject.findUnique({ where: { id: body.subjectId }, select: { id: true } });
  if (!subject) throw new ApiError('VALIDATION', 'Select a valid subject.');

  const rows = await prisma.question.findMany({
    where: {
      subjectId: body.subjectId,
      active: true,
      adHoc: false,
      ...(body.topicIds.length ? { topicId: { in: body.topicIds } } : {}),
      ...(body.bloom.length ? { bloom: { in: body.bloom } } : {}),
      ...(body.avoidIds.length ? { id: { notIn: body.avoidIds } } : {}),
    },
    select: {
      id: true,
      difficulty: true,
      topicId: true,
      text: true,
      assertionText: true,
      reasonText: true,
      usageCount: true,
      embedding: { select: { vector: true } },
    },
    take: CANDIDATE_LIMIT,
  });

  const result = assemblePaper(
    rows.map((row) => ({
      id: row.id,
      difficulty: row.difficulty,
      topicId: row.topicId,
      text: questionSignature(row),
      usageCount: row.usageCount,
      vector: row.embedding?.vector ?? null,
    })),
    body.count,
    { EASY: body.easyPct, MEDIUM: body.mediumPct, HARD: body.hardPct },
  );

  const full = await prisma.question.findMany({
    where: { id: { in: result.picked.map((candidate) => candidate.id) } },
    include: { options: { orderBy: { position: 'asc' } }, topic: { select: { name: true } } },
  });
  const byId = new Map(full.map((question) => [question.id, question]));

  return ok({
    questions: result.picked.map((candidate) => {
      const question = byId.get(candidate.id)!;
      return {
        id: question.id,
        text: question.text,
        type: question.type,
        difficulty: question.difficulty,
        marks: question.marks,
        assertionText: question.assertionText,
        reasonText: question.reasonText,
        acceptedAnswers: question.acceptedAnswers,
        modelAnswer: question.modelAnswer,
        maxAttachments: question.maxAttachments,
        imageAssetId: question.imageAssetId,
        topic: question.topic?.name ?? null,
        options: question.options.map((option) => ({ text: option.text, isCorrect: option.isCorrect })),
      };
    }),
    summary: {
      asked: body.count,
      picked: result.picked.length,
      available: rows.length,
      short: result.short,
      filledFromOther: result.filledFromOther,
      repeatsSkipped: result.repeatsSkipped,
    },
  });
});

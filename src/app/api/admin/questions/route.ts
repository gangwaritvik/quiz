import type { Prisma } from '@prisma/client';

import { assertNoBankRepeat } from '@/lib/ai/similarity';
import { assertSameOrigin, ok, parseBody, parseQuery, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  ADMIN_QUESTION_INCLUDE,
  assertQuestionRefs,
  questionFieldsFromInput,
  questionOptionsFromInput,
  serializeAdminQuestion,
} from '@/lib/questions';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { createQuestionSchema, questionFilterSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request: Request) => {
  await requireAdmin();
  const filters = parseQuery(request, questionFilterSchema);

  const where: Prisma.QuestionWhereInput = {
    active: true,
    // Questions written inline on a quiz form belong to that quiz, not to the
    // shared bank — they would otherwise clutter it and be reused by mistake.
    adHoc: false,
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(filters.topicId ? { topicId: filters.topicId === 'none' ? null : filters.topicId } : {}),
    ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
    ...(filters.bloom ? { bloom: filters.bloom } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.search
      ? { text: { contains: filters.search, mode: 'insensitive' as const } }
      : {}),
  };

  const [total, questions] = await Promise.all([
    prisma.question.count({ where }),
    prisma.question.findMany({
      where,
      include: ADMIN_QUESTION_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);

  // Admins are authorised to see correct answers — this is the one read path
  // where `isCorrect` legitimately leaves the server.
  return ok({
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
    questions: questions.map(serializeAdminQuestion),
  });
});

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  enforceRateLimit(RATE_LIMITS.adminWrite, `question-create:${session.userId}`);

  const body = await parseBody(request, createQuestionSchema);

  await assertQuestionRefs(body);

  await assertNoBankRepeat({ subjectId: body.subjectId, question: body, allowSimilar: body.allowSimilar });

  const question = await prisma.question.create({
    data: {
      ...questionFieldsFromInput(body),
      subjectId: body.subjectId,
      authorId: session.adminId,
      options: { create: questionOptionsFromInput(body) },
    },
  });

  await audit({
    action: 'admin.question_created',
    userId: session.userId,
    entityType: 'Question',
    entityId: question.id,
    context,
  });

  return ok({ questionId: question.id });
});

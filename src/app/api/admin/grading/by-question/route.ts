import { z } from 'zod';

import { ApiError, assertSameOrigin, ok, parseQuery, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  MAX_ANSWERS,
  excerpt,
  labelAnswers,
  summariseQuestions,
} from '@/lib/grading-by-question';
import { assertQuizOwner, ownAttemptWhere } from '@/lib/ownership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const id = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9]+$/i, 'Invalid identifier');

const byQuestionQuerySchema = z
  .object({
    quizId: id.optional(),
    questionId: id.optional(),
    /** `pending` (default) returns only unmarked answers; `all` includes marked ones. */
    include: z.enum(['pending', 'all']).default('pending'),
  })
  .refine((query) => !query.questionId || query.quizId, {
    message: 'quizId is required with questionId.',
    path: ['quizId'],
  });

/**
 * Marking one question across every student's paper.
 *
 *   (no params)           -> how many answers each of the caller's quizzes has pending
 *   ?quizId               -> that quiz's manually-marked questions, with counts
 *   ?quizId&questionId    -> that question's answers (pending only, or all with include=all)
 *
 * Marks are written through POST /api/admin/grading/answers/[answerId], which
 * owns validation, the audit trail and the attempt's score recomputation.
 */
export const GET = route(async (request: Request) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const { quizId, questionId, include } = parseQuery(request, byQuestionQuerySchema);

  if (!quizId) {
    const groups = await prisma.quizAttempt.groupBy({
      by: ['quizId'],
      where: { ...ownAttemptWhere(session.adminId), pendingManualCount: { gt: 0 } },
      _sum: { pendingManualCount: true },
    });
    return ok({
      quizzes: groups.map((group) => ({
        quizId: group.quizId,
        pending: group._sum.pendingManualCount ?? 0,
      })),
    });
  }

  await assertQuizOwner(quizId, session.adminId);

  if (!questionId) {
    // Two reads, neither per-row: every manual answer's question + state, and
    // the quiz's own question order. Question text is fetched once per question.
    const [answers, quizQuestions] = await Promise.all([
      prisma.answer.findMany({
        where: { requiresManualGrading: true, attempt: { quizId } },
        select: {
          gradedAt: true,
          attemptQuestion: { select: { questionId: true, position: true, marks: true } },
        },
      }),
      prisma.quizQuestion.findMany({ where: { quizId }, select: { questionId: true, position: true } }),
    ]);

    const stats = summariseQuestions(
      answers.map((answer) => ({
        questionId: answer.attemptQuestion.questionId,
        position: answer.attemptQuestion.position,
        marks: answer.attemptQuestion.marks,
        marked: answer.gradedAt !== null,
      })),
      new Map(quizQuestions.map((q) => [q.questionId, q.position])),
    );

    const questions = await prisma.question.findMany({
      where: { id: { in: stats.map((stat) => stat.questionId) } },
      select: { id: true, text: true, type: true },
    });
    const byId = new Map(questions.map((question) => [question.id, question]));

    return ok({
      questions: stats.flatMap((stat, index) => {
        const question = byId.get(stat.questionId);
        return question
          ? [
              {
                questionId: stat.questionId,
                order: index + 1,
                text: excerpt(question.text),
                type: question.type,
                maxMarks: stat.maxMarks,
                pending: stat.pending,
                total: stat.total,
              },
            ]
          : [];
      }),
    });
  }

  // The question lookup is scoped to this quiz's papers, so a question id from
  // someone else's quiz (and its model answer) can never be read through here.
  const [question, rows] = await Promise.all([
    prisma.question.findFirst({
      where: { id: questionId, attemptQuestions: { some: { attempt: { quizId } } } },
      select: {
        id: true,
        text: true,
        type: true,
        modelAnswer: true,
        maxWords: true,
        imageAssetId: true,
        topic: { select: { name: true } },
      },
    }),
    prisma.answer.findMany({
      where: { requiresManualGrading: true, attemptQuestion: { questionId }, attempt: { quizId } },
      orderBy: [{ attempt: { submittedAt: 'asc' } }, { id: 'asc' }],
      take: MAX_ANSWERS + 1,
      select: {
        id: true,
        attemptId: true,
        textResponse: true,
        awardedMarks: true,
        graderNote: true,
        gradedAt: true,
        attemptQuestion: { select: { marks: true } },
        attempt: {
          select: {
            submittedAt: true,
            student: { select: { rollNumber: true, user: { select: { name: true } } } },
          },
        },
        attachments: {
          orderBy: { position: 'asc' },
          select: { id: true, asset: { select: { id: true, originalName: true } } },
        },
      },
    }),
  ]);

  if (!question) throw new ApiError('NOT_FOUND', 'That question is not on this quiz.');

  const labelled = labelAnswers(
    rows.slice(0, MAX_ANSWERS).map((row) => ({
      answerId: row.id,
      attemptId: row.attemptId,
      student: { rollNumber: row.attempt.student.rollNumber, name: row.attempt.student.user.name },
      maxMarks: row.attemptQuestion.marks,
      textResponse: row.textResponse,
      attachments: row.attachments.map((attachment) => ({
        id: attachment.id,
        url: `/api/media/${attachment.asset.id}`,
        name: attachment.asset.originalName,
      })),
      awardedMarks: row.awardedMarks,
      graderNote: row.graderNote,
      gradedAt: row.gradedAt?.toISOString() ?? null,
      submittedAt: row.attempt.submittedAt?.toISOString() ?? null,
    })),
  );

  return ok({
    question: {
      id: question.id,
      text: question.text,
      type: question.type,
      topic: question.topic?.name ?? null,
      imageUrl: question.imageAssetId ? `/api/media/${question.imageAssetId}` : null,
      modelAnswer: question.modelAnswer,
      maxWords: question.maxWords,
    },
    total: labelled.length,
    pending: labelled.filter((answer) => answer.gradedAt === null).length,
    truncated: rows.length > MAX_ANSWERS,
    answers: include === 'all' ? labelled : labelled.filter((answer) => answer.gradedAt === null),
  });
});

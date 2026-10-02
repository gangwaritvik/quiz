import type { Prisma } from '@prisma/client';

import { ok, parseQuery, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ownAttemptWhere, ownQuizWhere } from '@/lib/ownership';
import { gradingQueueSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The manual marking queue.
 *
 * Descriptive and uploaded answers cannot be marked by the server, so every
 * attempt containing one lands here until a person has marked it. Until then
 * that attempt's score is provisional, and the student is told so rather than
 * shown a total that will later move.
 */
export const GET = route(async (request: Request) => {
  const session = await requireAdmin();
  const own = ownAttemptWhere(session.adminId);
  const filters = parseQuery(request, gradingQueueSchema);

  const inQueue: Prisma.QuizAttemptWhereInput[] = [
    { pendingManualCount: { gt: 0 } },
    { manualGradedAt: { not: null } },
  ];

  // `own` stays spread first: quizId and q can only narrow it, never widen it.
  const where: Prisma.QuizAttemptWhereInput = {
    ...own,
    ...(filters.quizId ? { quizId: filters.quizId } : {}),
    ...(filters.q
      ? {
          student: {
            OR: [
              { rollNumber: { contains: filters.q, mode: 'insensitive' } },
              { user: { name: { contains: filters.q, mode: 'insensitive' } } },
            ],
          },
        }
      : {}),
    ...(filters.includeCompleted ? { OR: inQueue } : { pendingManualCount: { gt: 0 } }),
  };

  // Unfinished attempts have no manualGradedAt, so "nulls first" puts everyone
  // still waiting ahead of the finished ones; then longest-waiting first.
  const ORDER: Record<typeof filters.sort, Prisma.QuizAttemptOrderByWithRelationInput[]> = {
    oldest: [{ manualGradedAt: { sort: 'desc', nulls: 'first' } }, { submittedAt: 'asc' }],
    newest: [{ submittedAt: 'desc' }],
    student: [{ student: { rollNumber: 'asc' } }, { submittedAt: 'asc' }],
    quiz: [{ quiz: { title: 'asc' } }, { quizId: 'asc' }, { submittedAt: 'asc' }],
  };

  const [total, attempts, answersPending, attemptsPending, quizzes] = await Promise.all([
    prisma.quizAttempt.count({ where }),
    prisma.quizAttempt.findMany({
      where,
      select: {
        id: true,
        submittedAt: true,
        score: true,
        maxScore: true,
        pendingManualCount: true,
        manualGradedAt: true,
        student: {
          select: {
            rollNumber: true,
            section: true,
            user: { select: { name: true } },
          },
        },
        quiz: { select: { id: true, title: true, subject: { select: { name: true } } } },
        _count: { select: { answers: true } },
      },
      // `id` last: a stable page boundary when the chosen key ties.
      orderBy: [...ORDER[filters.sort], { id: 'asc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.answer.count({
      where: { requiresManualGrading: true, gradedAt: null, attempt: own },
    }),
    prisma.quizAttempt.count({ where: { ...own, pendingManualCount: { gt: 0 } } }),
    // Options for the quiz filter: the faculty's own quizzes that can appear
    // in this queue, whatever the other filters say.
    prisma.quiz.findMany({
      where: { ...ownQuizWhere(session.adminId), attempts: { some: { OR: inQueue } } },
      select: {
        id: true,
        title: true,
        _count: { select: { attempts: { where: { pendingManualCount: { gt: 0 } } } } },
      },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    }),
  ]);

  return ok({
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
    summary: { attemptsPending, answersPending },
    quizzes: quizzes.map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      pending: quiz._count.attempts,
    })),
    attempts: attempts.map((attempt) => ({
      attemptId: attempt.id,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      score: attempt.score,
      maxScore: attempt.maxScore,
      pendingCount: attempt.pendingManualCount,
      completedAt: attempt.manualGradedAt?.toISOString() ?? null,
      student: {
        name: attempt.student.user.name,
        rollNumber: attempt.student.rollNumber,
        section: attempt.student.section,
      },
      quiz: {
        id: attempt.quiz.id,
        title: attempt.quiz.title,
        subject: attempt.quiz.subject.name,
      },
    })),
  });
});

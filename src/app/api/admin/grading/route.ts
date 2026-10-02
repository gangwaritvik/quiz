import type { Prisma } from '@prisma/client';

import { ok, parseQuery, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ownAttemptWhere } from '@/lib/ownership';
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

  const where: Prisma.QuizAttemptWhereInput = {
    ...own,
    ...(filters.quizId ? { quizId: filters.quizId } : {}),
    ...(filters.includeCompleted
      ? { OR: [{ pendingManualCount: { gt: 0 } }, { manualGradedAt: { not: null } }] }
      : { pendingManualCount: { gt: 0 } }),
  };

  const [total, attempts, answersPending] = await Promise.all([
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
      // Oldest submissions first: students who have waited longest come first.
      orderBy: [{ pendingManualCount: 'desc' }, { submittedAt: 'asc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.answer.count({
      where: { requiresManualGrading: true, gradedAt: null, attempt: own },
    }),
  ]);

  return ok({
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
    summary: {
      attemptsPending: await prisma.quizAttempt.count({
        where: { ...own, pendingManualCount: { gt: 0 } },
      }),
      answersPending,
    },
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

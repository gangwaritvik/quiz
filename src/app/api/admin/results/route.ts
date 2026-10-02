import type { Prisma } from '@prisma/client';

import { ok, parseQuery, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { bestPerStudent } from '@/lib/attempt-policy';
import { prisma } from '@/lib/db';
import { ownAttemptWhere, ownQuizWhere } from '@/lib/ownership';
import { resultsFilterSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Graded attempts across the caller's quizzes, with per-quiz aggregates.
 * Filters narrow the set, and the summaries are worked out from what is left,
 * so "Section A" shows Section A's average. `options` always describes the
 * whole set, so choosing a filter never removes the others' choices.
 */
export const GET = route(async (request: Request) => {
  const session = await requireAdmin();
  const filters = parseQuery(request, resultsFilterSchema);
  const own = ownAttemptWhere(session.adminId);
  const submitted = { status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } } satisfies Prisma.QuizAttemptWhereInput;

  const where: Prisma.QuizAttemptWhereInput = {
    ...own,
    ...submitted,
    ...(filters.quizId ? { quizId: filters.quizId } : {}),
    ...(filters.subjectId ? { quiz: { ...own.quiz, subjectId: filters.subjectId } } : {}),
    ...(filters.department && filters.section
      ? { student: { department: filters.department, section: filters.section } }
      : {}),
    ...(filters.flagged ? { integrity: { status: { not: 'NORMAL' } } } : {}),
    ...(filters.q
      ? {
          OR: [
            { student: { rollNumber: { contains: filters.q, mode: 'insensitive' } } },
            { student: { user: { name: { contains: filters.q, mode: 'insensitive' } } } },
            { quiz: { title: { contains: filters.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [optionQuizzes, optionSections] = await Promise.all([
    prisma.quiz.findMany({
      where: { ...ownQuizWhere(session.adminId), attempts: { some: submitted } },
      select: { id: true, title: true, subject: { select: { id: true, name: true } } },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    }),
    prisma.student.findMany({
      where: { attempts: { some: { ...own, ...submitted } } },
      distinct: ['department', 'section'],
      select: { department: true, section: true },
      orderBy: [{ department: 'asc' }, { section: 'asc' }],
    }),
  ]);

  const attempts = await prisma.quizAttempt.findMany({
    where,
    include: {
      student: { include: { user: { select: { name: true } } } },
      quiz: { select: { id: true, title: true, subject: { select: { name: true } } } },
      integrity: { select: { score: true, status: true } },
    },
    orderBy: { submittedAt: 'desc' },
    take: 500,
  });

  const byQuiz = new Map<
    string,
    { title: string; subject: string; scores: number[]; flagged: number }
  >();

  // A student who retook a quiz counts once, at their best attempt.
  const bestIds = new Set(
    bestPerStudent(
      attempts,
      (a) => `${a.quizId}:${a.studentId}`,
      (a) => a.percentage,
    ).map((a) => a.id),
  );

  for (const attempt of attempts) {
    const entry = byQuiz.get(attempt.quiz.id) ?? {
      title: attempt.quiz.title,
      subject: attempt.quiz.subject.name,
      scores: [],
      flagged: 0,
    };
    if (attempt.percentage !== null && bestIds.has(attempt.id)) entry.scores.push(attempt.percentage);
    if (attempt.integrity && attempt.integrity.status !== 'NORMAL') entry.flagged += 1;
    byQuiz.set(attempt.quiz.id, entry);
  }

  const quizSummaries = [...byQuiz.entries()].map(([id, entry]) => {
    const sorted = [...entry.scores].sort((a, b) => a - b);
    const average =
      sorted.length > 0
        ? Math.round((sorted.reduce((sum, v) => sum + v, 0) / sorted.length) * 10) / 10
        : null;
    const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : null;

    return {
      quizId: id,
      title: entry.title,
      subject: entry.subject,
      attempts: entry.scores.length,
      average,
      median,
      highest: sorted.length ? sorted[sorted.length - 1]! : null,
      lowest: sorted.length ? sorted[0]! : null,
      flagged: entry.flagged,
    };
  });

  return ok({
    options: {
      subjects: [
        ...new Map(optionQuizzes.map((quiz) => [quiz.subject.id, quiz.subject.name])).entries(),
      ].map(([id, name]) => ({ id, name })),
      quizzes: optionQuizzes.map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        subjectId: quiz.subject.id,
      })),
      sections: optionSections,
    },
    quizSummaries,
    results: attempts.map((attempt) => ({
      attemptId: attempt.id,
      studentName: attempt.student.user.name,
      rollNumber: attempt.student.rollNumber,
      section: attempt.student.section,
      quizId: attempt.quiz.id,
      quizTitle: attempt.quiz.title,
      subject: attempt.quiz.subject.name,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percentage: attempt.percentage,
      correctCount: attempt.correctCount,
      incorrectCount: attempt.incorrectCount,
      unansweredCount: attempt.unansweredCount,
      status: attempt.status,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      integrityScore: attempt.integrity?.score ?? null,
      integrityStatus: attempt.integrity?.status ?? null,
    })),
  });
});

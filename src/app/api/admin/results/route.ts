import { ok, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Graded attempts across all quizzes, with per-quiz aggregates. */
export const GET = route(async (request: Request) => {
  await requireAdmin();

  const url = new URL(request.url);
  const quizId = url.searchParams.get('quizId');

  const attempts = await prisma.quizAttempt.findMany({
    where: {
      status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
      ...(quizId ? { quizId } : {}),
    },
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

  for (const attempt of attempts) {
    const entry = byQuiz.get(attempt.quiz.id) ?? {
      title: attempt.quiz.title,
      subject: attempt.quiz.subject.name,
      scores: [],
      flagged: 0,
    };
    if (attempt.percentage !== null) entry.scores.push(attempt.percentage);
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

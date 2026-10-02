import { ok, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sweepExpiredAttempts } from '@/lib/exam';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Full examination history for the signed-in student. */
export const GET = route(async () => {
  const session = await requireStudent();
  enforceRateLimit(RATE_LIMITS.read, `history:${session.userId}`);
  await sweepExpiredAttempts();

  const attempts = await prisma.quizAttempt.findMany({
    where: { studentId: session.studentId },
    include: {
      quiz: { include: { subject: { select: { name: true, code: true } } } },
      integrity: { select: { score: true, status: true } },
      _count: { select: { events: true } },
    },
    orderBy: { startedAt: 'desc' },
  });

  return ok({
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      quizTitle: attempt.quiz.title,
      subject: attempt.quiz.subject.name,
      subjectCode: attempt.quiz.subject.code,
      status: attempt.status,
      attemptNumber: attempt.attemptNumber,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      durationMinutes: attempt.quiz.durationMinutes,
      // Scores stay hidden until the teacher releases results for that quiz.
      resultsReleased: attempt.quiz.releaseResults,
      score: attempt.quiz.releaseResults ? attempt.score : null,
      maxScore: attempt.quiz.releaseResults ? attempt.maxScore : null,
      percentage: attempt.quiz.releaseResults ? attempt.percentage : null,
      integrityScore: attempt.integrity?.score ?? null,
      integrityStatus: attempt.integrity?.status ?? null,
      eventCount: attempt._count.events,
    })),
  });
});

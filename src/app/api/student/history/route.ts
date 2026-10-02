import { ok, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resultsVisibility, sweepExpiredAttempts } from '@/lib/exam';
import { effectiveEndsAt } from '@/lib/time-extension';
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

  const now = new Date();

  return ok({
    attempts: attempts.map((attempt) => {
      const released = resultsVisibility(attempt.quiz, now).results;
      return {
        id: attempt.id,
        quizTitle: attempt.quiz.title,
        subject: attempt.quiz.subject.name,
        subjectCode: attempt.quiz.subject.code,
        status: attempt.status,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt.toISOString(),
        submittedAt: attempt.submittedAt?.toISOString() ?? null,
        durationMinutes: attempt.quiz.durationMinutes,
        // Scores stay hidden until results are released AND the window has closed.
        resultsReleased: released,
        releasesAt: attempt.quiz.releaseResults ? effectiveEndsAt(attempt.quiz).toISOString() : null,
        score: released ? attempt.score : null,
        maxScore: released ? attempt.maxScore : null,
        percentage: released ? attempt.percentage : null,
        awaitingMarking: attempt.pendingManualCount > 0,
        integrityScore: attempt.integrity?.score ?? null,
        integrityStatus: attempt.integrity?.status ?? null,
        eventCount: attempt._count.events,
      };
    }),
  });
});

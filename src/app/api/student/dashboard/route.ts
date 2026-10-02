import { ok, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resultsVisibility, sweepExpiredAttempts } from '@/lib/exam';
import { statusForScore } from '@/lib/integrity';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { effectiveEndsAt } from '@/lib/time-extension';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const session = await requireStudent();
  enforceRateLimit(RATE_LIMITS.read, `dashboard:${session.userId}`);

  // Close out any attempt whose server deadline passed while the tab was shut.
  await sweepExpiredAttempts();

  const now = new Date();
  const studentId = session.studentId;

  const [assignments, attempts, integrityScores] = await Promise.all([
    prisma.quizAssignment.findMany({
      where: {
        studentId,
        quiz: {
          status: 'PUBLISHED',
          // Past the window only while this student is still sitting on extra time.
          OR: [
            { endsAt: { gt: now } },
            { attempts: { some: { studentId, status: 'IN_PROGRESS', expiresAt: { gt: now } } } },
          ],
        },
      },
      include: {
        quiz: {
          include: {
            subject: { select: { name: true, code: true } },
            attempts: {
              where: { studentId },
              select: { id: true, status: true, expiresAt: true },
            },
          },
        },
      },
      orderBy: { quiz: { startsAt: 'asc' } },
    }),
    prisma.quizAttempt.findMany({
      where: { studentId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
      select: {
        id: true,
        percentage: true,
        submittedAt: true,
        pendingManualCount: true,
        quiz: {
          select: {
            title: true,
            releaseResults: true,
            releaseAnswers: true,
            endsAt: true,
            maxExtensionMinutes: true,
            subject: { select: { name: true } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    }),
    prisma.integrityScore.findMany({
      where: { attempt: { studentId } },
      select: { score: true },
    }),
  ]);

  const upcoming = assignments.map(({ quiz }) => {
    const live = quiz.attempts.find((a) => a.status === 'IN_PROGRESS');
    const finished = quiz.attempts.find(
      (a) => a.status === 'SUBMITTED' || a.status === 'AUTO_SUBMITTED',
    );

    const state = finished
      ? 'COMPLETED'
      : live
        ? 'IN_PROGRESS'
        : now < quiz.startsAt
          ? 'SCHEDULED'
          : 'AVAILABLE';

    return {
      id: quiz.id,
      title: quiz.title,
      subject: quiz.subject.name,
      subjectCode: quiz.subject.code,
      questionCount: quiz.questionCount,
      durationMinutes: quiz.durationMinutes,
      startsAt: quiz.startsAt.toISOString(),
      endsAt: quiz.endsAt.toISOString(),
      state,
      activeAttemptId: live?.id ?? null,
      cameraMonitoring: quiz.cameraMonitoring,
      requireFullscreen: quiz.requireFullscreen,
    };
  });

  const completed = attempts.length;
  // Only attempts whose results are visible (released and window closed) may
  // feed the average, or it would leak a hidden score by difference.
  // Provisional scores (answers still being marked) are left out, as on the
  // results page, so both averages agree.
  const visible = attempts.filter(
    (a) => resultsVisibility(a.quiz, now).results && a.pendingManualCount === 0,
  );
  const averageScore =
    visible.length > 0
      ? Math.round(
          (visible.reduce((sum, a) => sum + (a.percentage ?? 0), 0) / visible.length) * 10,
        ) / 10
      : null;

  const averageIntegrity =
    integrityScores.length > 0
      ? Math.round(integrityScores.reduce((sum, s) => sum + s.score, 0) / integrityScores.length)
      : 100;

  return ok({
    student: {
      name: session.name,
      rollNumber: session.rollNumber ?? null,
      department: session.department ?? null,
      section: session.section ?? null,
    },
    stats: {
      upcomingCount: upcoming.filter((q) => q.state !== 'COMPLETED').length,
      completed,
      averageScore,
      integrityScore: averageIntegrity,
      integrityStatus: statusForScore(averageIntegrity),
    },
    upcoming,
    recentResults: attempts.slice(0, 5).map((a) => {
      const released = resultsVisibility(a.quiz, now).results;
      return {
        attemptId: a.id,
        title: a.quiz.title,
        subject: a.quiz.subject.name,
        submittedAt: a.submittedAt?.toISOString() ?? null,
        // The score is withheld unless faculty released it, exactly as on the
        // full results page — the dashboard must not become a side channel.
        released,
        releasesAt: a.quiz.releaseResults ? effectiveEndsAt(a.quiz).toISOString() : null,
        percentage: released ? a.percentage : null,
        awaitingMarking: a.pendingManualCount > 0,
      };
    }),
  });
});

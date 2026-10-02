import { ok, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sweepExpiredAttempts } from '@/lib/exam';
import { ownAttemptWhere, ownQuizWhere } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const session = await requireAdmin();
  enforceRateLimit(RATE_LIMITS.read, `admin-overview:${session.userId}`);
  await sweepExpiredAttempts();

  const now = new Date();
  // Every count and list below is limited to this faculty member's own quizzes.
  const ownQuiz = ownQuizWhere(session.adminId);
  const ownAttempt = ownAttemptWhere(session.adminId);

  const [
    activeExams,
    liveAttempts,
    completedAttempts,
    flagged,
    awaitingMarking,
    recentAttempts,
    quizzes,
    pendingAttempts,
    recentSubmissions,
    recentlyPublished,
    recentFlags,
    students,
    questionDifficulty,
    integrityEventCounts,
  ] = await Promise.all([
      prisma.quiz.count({
        where: { ...ownQuiz, status: 'PUBLISHED', startsAt: { lte: now }, endsAt: { gte: now } },
      }),
      prisma.quizAttempt.count({ where: { ...ownAttempt, status: 'IN_PROGRESS' } }),
      prisma.quizAttempt.count({
        where: { ...ownAttempt, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
      }),
      prisma.integrityScore.count({
        where: {
          status: { in: ['REVIEW_RECOMMENDED', 'HIGH_RISK'] },
          reviewed: false,
          attempt: ownAttempt,
        },
      }),
      // Descriptive and uploaded answers a person still has to mark. Students
      // are waiting on these, so the count is surfaced in the sidebar.
      prisma.answer.count({
        where: { requiresManualGrading: true, gradedAt: null, attempt: ownAttempt },
      }),
      prisma.quizAttempt.findMany({
        where: { ...ownAttempt, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
        select: {
          percentage: true,
          submittedAt: true,
          pendingManualCount: true,
          quiz: { select: { id: true, title: true } },
        },
        orderBy: { submittedAt: 'desc' },
        take: 400,
      }),
      prisma.quiz.findMany({
        where: { ...ownQuiz, status: { not: 'DRAFT' } },
        select: {
          id: true,
          title: true,
          status: true,
          startsAt: true,
          endsAt: true,
          questionCount: true,
          subject: { select: { name: true } },
          _count: { select: { attempts: true, assignments: true } },
        },
        orderBy: { startsAt: 'desc' },
        take: 6,
      }),
      // Papers still with a marker, oldest first — the queue a person works.
      prisma.quizAttempt.findMany({
        where: { ...ownAttempt, pendingManualCount: { gt: 0 } },
        select: {
          id: true,
          submittedAt: true,
          pendingManualCount: true,
          quiz: { select: { id: true, title: true } },
        },
        orderBy: { submittedAt: 'asc' },
        take: 200,
      }),
      // The activity feed is built from real domain rows rather than the audit
      // log: each one already carries the names and the timestamp needed to
      // write a sentence, where an audit row would need a lookup per entry.
      prisma.quizAttempt.findMany({
        where: { ...ownAttempt, submittedAt: { not: null } },
        select: {
          id: true,
          submittedAt: true,
          quiz: { select: { title: true } },
          student: { select: { user: { select: { name: true } } } },
        },
        orderBy: { submittedAt: 'desc' },
        take: 5,
      }),
      prisma.quiz.findMany({
        where: { ...ownQuiz, status: { not: 'DRAFT' } },
        select: { id: true, title: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      prisma.integrityScore.findMany({
        where: {
          status: { in: ['REVIEW_RECOMMENDED', 'HIGH_RISK'] },
          reviewed: false,
          attempt: ownAttempt,
        },
        select: {
          id: true,
          computedAt: true,
          attempt: { select: { id: true, quiz: { select: { title: true } } } },
        },
        orderBy: { computedAt: 'desc' },
        take: 4,
      }),
      prisma.student.findMany({
        where: { user: { status: 'ACTIVE' } },
        select: {
          id: true,
          rollNumber: true,
          section: true,
          user: { select: { name: true } },
          attempts: {
            where: { ...ownAttempt, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
            select: { quizId: true, percentage: true, pendingManualCount: true },
          },
          // Only exams that have closed can be counted as missed — an open one
          // is simply not sat yet.
          assignments: {
            where: { quiz: { ...ownQuiz, status: { not: 'DRAFT' }, endsAt: { lt: now } } },
            select: { quizId: true },
          },
        },
      }),
      prisma.question.groupBy({
        by: ['difficulty'],
        _count: { _all: true },
        where: { active: true },
      }),
      prisma.examEvent.groupBy({
        by: ['type'],
        _count: { _all: true },
        where: { attempt: ownAttempt },
        orderBy: { _count: { type: 'desc' } },
        take: 7,
      }),
    ]);

  // Average score per quiz, for the bar chart.
  const scoreByQuiz = new Map<string, { title: string; total: number; count: number }>();
  for (const attempt of recentAttempts) {
    if (attempt.percentage === null) continue;
    const entry = scoreByQuiz.get(attempt.quiz.id) ?? {
      title: attempt.quiz.title,
      total: 0,
      count: 0,
    };
    entry.total += attempt.percentage;
    entry.count += 1;
    scoreByQuiz.set(attempt.quiz.id, entry);
  }

  // Titles are sent whole; the chart lays them out rather than the API
  // guessing at a width and truncating mid-word.
  const averageScoreByQuiz = [...scoreByQuiz.values()]
    .map((entry) => ({
      quiz: entry.title,
      average: Math.round((entry.total / entry.count) * 10) / 10,
      attempts: entry.count,
    }))
    .sort((a, b) => a.average - b.average)
    .slice(0, 6);

  // Only quizzes that have actually opened. A draft nobody can sit, or one
  // scheduled for next week, is not a participation problem — counting it
  // drags the headline down and invents a shortfall that does not exist.
  const participation = quizzes
    .filter((quiz) => quiz.startsAt <= now && quiz._count.assignments > 0)
    .map((quiz) => ({
      quiz: quiz.title,
      assigned: quiz._count.assignments,
      attempted: quiz._count.attempts,
    }));

  // Grade bands. Attempts still carrying unmarked answers are left out: their
  // percentage is provisional and will move, so binning it would draw a
  // distribution out of numbers that are not final.
  const finalAttempts = recentAttempts.filter(
    (attempt) => attempt.percentage !== null && attempt.pendingManualCount === 0,
  );

  const BANDS = [
    { label: 'Below 40', min: 0, max: 40, failing: true },
    { label: '40–59', min: 40, max: 60, failing: false },
    { label: '60–74', min: 60, max: 75, failing: false },
    { label: '75–100', min: 75, max: 101, failing: false },
  ];

  const scoreDistribution = BANDS.map((band) => ({
    band: band.label,
    failing: band.failing,
    count: finalAttempts.filter(
      (attempt) => (attempt.percentage ?? 0) >= band.min && (attempt.percentage ?? 0) < band.max,
    ).length,
  }));

  // The marking queue, grouped by paper.
  const queueByQuiz = new Map<
    string,
    { quizId: string; title: string; papers: number; answers: number; oldest: Date | null }
  >();
  for (const attempt of pendingAttempts) {
    const entry = queueByQuiz.get(attempt.quiz.id) ?? {
      quizId: attempt.quiz.id,
      title: attempt.quiz.title,
      papers: 0,
      answers: 0,
      oldest: null,
    };
    entry.papers += 1;
    entry.answers += attempt.pendingManualCount;
    if (attempt.submittedAt && (!entry.oldest || attempt.submittedAt < entry.oldest)) {
      entry.oldest = attempt.submittedAt;
    }
    queueByQuiz.set(attempt.quiz.id, entry);
  }

  const markingQueue = [...queueByQuiz.values()]
    .sort((a, b) => (a.oldest?.getTime() ?? 0) - (b.oldest?.getTime() ?? 0))
    .slice(0, 6)
    .map((entry) => ({
      quizId: entry.quizId,
      title: entry.title,
      papers: entry.papers,
      answers: entry.answers,
      waitingSince: entry.oldest?.toISOString() ?? null,
    }));

  // Students worth a look: a failing average, or closed exams they never sat.
  // Both are flagged rather than scored — this is a prompt to check on someone,
  // not a judgement about them.
  const FAIL_UNDER = 40;
  const atRiskStudents = students
    .map((student) => {
      const marked = student.attempts.filter(
        (attempt) => attempt.percentage !== null && attempt.pendingManualCount === 0,
      );
      const average =
        marked.length > 0
          ? Math.round(
              (marked.reduce((sum, a) => sum + (a.percentage ?? 0), 0) / marked.length) * 10,
            ) / 10
          : null;

      const satQuizIds = new Set(student.attempts.map((attempt) => attempt.quizId));
      const missed = student.assignments.filter(
        (assignment) => !satQuizIds.has(assignment.quizId),
      ).length;

      return {
        studentId: student.id,
        name: student.user.name,
        rollNumber: student.rollNumber,
        section: student.section,
        average,
        attempts: marked.length,
        missed,
      };
    })
    .filter((student) => (student.average !== null && student.average < FAIL_UNDER) || student.missed > 0)
    .sort((a, b) => {
      if (b.missed !== a.missed) return b.missed - a.missed;
      return (a.average ?? 101) - (b.average ?? 101);
    })
    .slice(0, 6);

  // One merged, time-ordered feed. Every entry is a real row with a real
  // timestamp — nothing here is generated to fill the panel out.
  type Activity = {
    id: string;
    kind: 'SUBMISSION' | 'PUBLISHED' | 'FLAGGED' | 'MARKING';
    text: string;
    detail: string | null;
    href: string;
    at: string;
  };

  const activity: Activity[] = [
    ...recentSubmissions.map((attempt) => ({
      id: `submission-${attempt.id}`,
      kind: 'SUBMISSION' as const,
      text: `${attempt.student.user.name} submitted`,
      detail: attempt.quiz.title,
      href: `/admin/results`,
      at: attempt.submittedAt!.toISOString(),
    })),
    ...recentlyPublished.map((quiz) => ({
      id: `quiz-${quiz.id}`,
      kind: 'PUBLISHED' as const,
      text: 'Quiz published',
      detail: quiz.title,
      href: `/admin/quizzes/${quiz.id}`,
      at: quiz.createdAt.toISOString(),
    })),
    ...recentFlags.map((flag) => ({
      id: `flag-${flag.id}`,
      kind: 'FLAGGED' as const,
      text: 'Attempt flagged for review',
      detail: flag.attempt.quiz.title,
      href: `/admin/integrity/${flag.attempt.id}`,
      at: flag.computedAt.toISOString(),
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 6);

  // Change in average score against the previous week, so the headline figure
  // carries direction rather than sitting on its own. Null unless both weeks
  // actually have marked attempts — a delta against nothing is not a delta.
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const meanOf = (from: number, to: number) => {
    const window = recentAttempts.filter((attempt) => {
      if (attempt.percentage === null || !attempt.submittedAt) return false;
      const at = attempt.submittedAt.getTime();
      return at >= now.getTime() - from && at < now.getTime() - to;
    });
    if (window.length === 0) return null;
    return window.reduce((sum, a) => sum + (a.percentage ?? 0), 0) / window.length;
  };

  const thisWeek = meanOf(WEEK, 0);
  const lastWeek = meanOf(2 * WEEK, WEEK);
  const scoreTrend =
    thisWeek !== null && lastWeek !== null && lastWeek > 0
      ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
      : null;

  const overallAverage =
    recentAttempts.length > 0
      ? Math.round(
          (recentAttempts.reduce((sum, a) => sum + (a.percentage ?? 0), 0) /
            recentAttempts.length) *
            10,
        ) / 10
      : null;

  return ok({
    faculty: { name: session.name },
    stats: {
      activeExams,
      studentsTakingExams: liveAttempts,
      completedAttempts,
      flaggedAttempts: flagged,
      answersAwaitingMarking: awaitingMarking,
      averageScore: overallAverage,
      scoreTrend,
    },
    activity,
    charts: {
      averageScoreByQuiz,
      participation,
      scoreDistribution,
      difficultyDistribution: questionDifficulty.map((entry) => ({
        difficulty: entry.difficulty,
        count: entry._count._all,
      })),
      integrityEvents: integrityEventCounts.map((entry) => ({
        type: entry.type,
        count: entry._count._all,
      })),
      /** Attempts left out of the distribution because marking is unfinished. */
      provisionalAttempts: recentAttempts.length - finalAttempts.length,
    },
    markingQueue,
    atRiskStudents,
    // Already queried for the charts above, so surfacing it costs nothing.
    recentQuizzes: quizzes.map((quiz) => {
      const live = quiz.status === 'PUBLISHED' && quiz.startsAt <= now && quiz.endsAt >= now;
      return {
        id: quiz.id,
        title: quiz.title,
        subject: quiz.subject.name,
        questionCount: quiz.questionCount,
        assigned: quiz._count.assignments,
        attempts: quiz._count.attempts,
        startsAt: quiz.startsAt.toISOString(),
        endsAt: quiz.endsAt.toISOString(),
        state: live
          ? ('LIVE' as const)
          : quiz.startsAt > now
            ? ('SCHEDULED' as const)
            : ('CLOSED' as const),
      };
    }),
  });
});

import { ok, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  buildAttention,
  quizStatusWord,
  sortQuizzesByRelevance,
} from '@/lib/dashboard-attention';
import { sweepExpiredAttempts } from '@/lib/exam';
import { ownAttemptWhere, ownQuizWhere } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Rows in "Your quizzes", and the most any one status can contribute to it. */
const QUIZ_LIST_LIMIT = 6;

/** Marking groups shown in the attention list, longest wait first. */
const MARKING_ROWS = 6;

const listedQuiz = {
  id: true,
  title: true,
  status: true,
  startsAt: true,
  endsAt: true,
  _count: { select: { attempts: true, assignments: true } },
} as const;

export const GET = route(async () => {
  const session = await requireAdmin();
  enforceRateLimit(RATE_LIMITS.read, `admin-overview:${session.userId}`);
  await sweepExpiredAttempts();

  const now = new Date();
  // Every count and list below is limited to this faculty member's own quizzes.
  const ownQuiz = ownQuizWhere(session.adminId);
  const ownAttempt = ownAttemptWhere(session.adminId);
  // Students waiting for a re-check of a released result.
  const openAppeals = await prisma.resultAppeal.count({
    where: { status: 'OPEN', attempt: ownAttempt },
  });

  const [
    activeExams,
    liveGroups,
    completedAttempts,
    flagged,
    awaitingMarking,
    recentAttempts,
    quizzes,
    markingGroups,
    questionDifficulty,
    integrityEventCounts,
    ownedQuizCount,
    liveQuizzes,
    upcomingQuizzes,
    draftQuizzes,
    closedQuizzes,
  ] = await Promise.all([
      prisma.quiz.count({
        where: { ...ownQuiz, status: 'PUBLISHED', startsAt: { lte: now }, endsAt: { gte: now } },
      }),
      // Attempts in progress, per quiz: the total feeds the sidebar badge and
      // the group count says how many exams those students are spread over.
      prisma.quizAttempt.groupBy({
        by: ['quizId'],
        where: { ...ownAttempt, status: 'IN_PROGRESS' },
        _count: { _all: true },
      }),
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
          title: true,
          startsAt: true,
          endsAt: true,
          _count: { select: { attempts: true, assignments: true } },
        },
        orderBy: { startsAt: 'desc' },
        take: 6,
      }),
      // Papers still with a marker, one row per quiz, longest wait first. An
      // aggregate rather than a capped list of attempts, so the answer counts
      // stay exact however large the backlog.
      prisma.quizAttempt.groupBy({
        by: ['quizId'],
        where: { ...ownAttempt, pendingManualCount: { gt: 0 } },
        _sum: { pendingManualCount: true },
        _min: { submittedAt: true },
        _count: { _all: true },
        orderBy: { _min: { submittedAt: 'asc' } },
        take: MARKING_ROWS,
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
      prisma.quiz.count({ where: ownQuiz }),
      // "Your quizzes": a few of each status, merged by relevance below. Each
      // is bounded, so a faculty member with hundreds of quizzes costs the same.
      prisma.quiz.findMany({
        where: { ...ownQuiz, status: 'PUBLISHED', startsAt: { lte: now }, endsAt: { gte: now } },
        select: listedQuiz,
        orderBy: { endsAt: 'asc' },
        take: QUIZ_LIST_LIMIT,
      }),
      prisma.quiz.findMany({
        where: { ...ownQuiz, status: 'PUBLISHED', startsAt: { gt: now } },
        select: listedQuiz,
        orderBy: { startsAt: 'asc' },
        take: QUIZ_LIST_LIMIT,
      }),
      prisma.quiz.findMany({
        where: { ...ownQuiz, status: 'DRAFT' },
        select: listedQuiz,
        orderBy: { updatedAt: 'desc' },
        take: QUIZ_LIST_LIMIT,
      }),
      prisma.quiz.findMany({
        where: { ...ownQuiz, status: 'PUBLISHED', endsAt: { lt: now } },
        select: listedQuiz,
        orderBy: { endsAt: 'desc' },
        take: QUIZ_LIST_LIMIT,
      }),
    ]);

  // Titles for the marking groups: one lookup for all of them, still scoped to
  // this faculty member's quizzes.
  const markingTitles = new Map(
    (markingGroups.length > 0
      ? await prisma.quiz.findMany({
          where: { ...ownQuiz, id: { in: markingGroups.map((group) => group.quizId) } },
          select: { id: true, title: true },
        })
      : []
    ).map((quiz) => [quiz.id, quiz.title]),
  );

  const liveStudents = liveGroups.reduce((sum, group) => sum + group._count._all, 0);

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
      closed: quiz.endsAt < now,
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

  // What wants this faculty member now. Built here, from the aggregates above,
  // so the page renders rows rather than working them out.
  const liveQuizTitle =
    liveGroups.length === 1
      ? (liveQuizzes.find((quiz) => quiz.id === liveGroups[0].quizId)?.title ?? null)
      : null;

  const attention = buildAttention({
    now,
    marking: markingGroups.map((group) => ({
      quizId: group.quizId,
      title: markingTitles.get(group.quizId) ?? 'a quiz',
      papers: group._count._all,
      answers: group._sum.pendingManualCount ?? 0,
      waitingSince: group._min.submittedAt,
    })),
    flagged,
    live: { students: liveStudents, exams: liveGroups.length, title: liveQuizTitle },
    upcoming: upcomingQuizzes.map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      startsAt: quiz.startsAt,
      assigned: quiz._count.assignments,
    })),
  });

  // Soonest scheduled quiz, for the "nothing needs you" line.
  const next = upcomingQuizzes[0];

  const yourQuizzes = sortQuizzesByRelevance(
    [...liveQuizzes, ...upcomingQuizzes, ...draftQuizzes, ...closedQuizzes],
    now,
  )
    .slice(0, QUIZ_LIST_LIMIT)
    .map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      state: quizStatusWord(quiz, now),
      assigned: quiz._count.assignments,
      attempts: quiz._count.attempts,
      startsAt: quiz.startsAt.toISOString(),
      endsAt: quiz.endsAt.toISOString(),
    }));

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

  // Mean over attempts that actually carry a score, so an unscored attempt is
  // not counted as zero.
  const scored = recentAttempts.filter((attempt) => attempt.percentage !== null);
  const overallAverage =
    scored.length > 0
      ? Math.round((scored.reduce((sum, a) => sum + (a.percentage ?? 0), 0) / scored.length) * 10) /
        10
      : null;

  return ok({
    faculty: { name: session.name },
    stats: {
      activeExams,
      studentsTakingExams: liveStudents,
      completedAttempts,
      flaggedAttempts: flagged,
      openAppeals,
      answersAwaitingMarking: awaitingMarking,
      averageScore: overallAverage,
      scoredAttempts: scored.length,
      scoreTrend,
    },
    /** Rows for "Needs your attention", most time-critical first. */
    attention,
    nextScheduled: next
      ? { id: next.id, title: next.title, startsAt: next.startsAt.toISOString() }
      : null,
    /** Every quiz this faculty member owns, so a first-time user can be told. */
    ownedQuizCount,
    yourQuizzes,
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
  });
});

import { ok, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ownAttemptWhere, ownQuizWhere } from '@/lib/ownership';
import { remainingTime, sweepExpiredAttempts } from '@/lib/exam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A student silent for longer than this is shown as unstable, not offline. */
const UNSTABLE_MS = 30_000;
const OFFLINE_MS = 90_000;

/**
 * Live invigilation feed. Polled by the monitoring dashboard.
 *
 * Connection state is inferred from `lastSeenAt`, which the exam client
 * refreshes on every heartbeat — so a closed laptop shows as offline within
 * about a minute and a half.
 */
export const GET = route(async (request: Request) => {
  const session = await requireAdmin();
  await sweepExpiredAttempts();

  const url = new URL(request.url);
  const quizId = url.searchParams.get('quizId');

  const attempts = await prisma.quizAttempt.findMany({
    where: { ...ownAttemptWhere(session.adminId), status: 'IN_PROGRESS', ...(quizId ? { quizId } : {}) },
    include: {
      student: { include: { user: { select: { name: true } } } },
      quiz: { select: { id: true, title: true, questionCount: true, durationMinutes: true } },
      integrity: { select: { score: true, status: true } },
      _count: { select: { answers: true } },
    },
    orderBy: { startedAt: 'asc' },
  });

  const attemptIds = attempts.map((a) => a.id);

  const [answeredCounts, recentEvents] = await Promise.all([
    prisma.answer.groupBy({
      by: ['attemptId'],
      where: { attemptId: { in: attemptIds }, selectedOptionId: { not: null } },
      _count: { _all: true },
    }),
    prisma.examEvent.groupBy({
      by: ['attemptId', 'type'],
      where: { attemptId: { in: attemptIds }, severity: { in: ['LOW', 'MEDIUM', 'HIGH'] } },
      _count: { _all: true },
    }),
  ]);

  const answeredByAttempt = new Map(answeredCounts.map((row) => [row.attemptId, row._count._all]));

  const eventsByAttempt = new Map<string, Array<{ type: string; count: number }>>();
  for (const row of recentEvents) {
    const list = eventsByAttempt.get(row.attemptId) ?? [];
    list.push({ type: row.type, count: row._count._all });
    eventsByAttempt.set(row.attemptId, list);
  }

  const now = Date.now();

  const students = attempts.map((attempt) => {
    const silentMs = now - attempt.lastSeenAt.getTime();
    const connection =
      silentMs > OFFLINE_MS ? 'OFFLINE' : silentMs > UNSTABLE_MS ? 'UNSTABLE' : 'STABLE';

    return {
      attemptId: attempt.id,
      studentId: attempt.studentId,
      name: attempt.student.user.name,
      rollNumber: attempt.student.rollNumber,
      section: attempt.student.section,
      quizId: attempt.quiz.id,
      quizTitle: attempt.quiz.title,
      // "Question N of M" uses answered count, which is what an invigilator
      // actually wants to see; navigation position is not tracked server-side.
      answered: answeredByAttempt.get(attempt.id) ?? 0,
      totalQuestions: attempt.quiz.questionCount,
      remainingMs: remainingTime(attempt.expiresAt).remainingMs,
      startedAt: attempt.startedAt.toISOString(),
      lastSeenAt: attempt.lastSeenAt.toISOString(),
      connection,
      integrityScore: attempt.integrity?.score ?? 100,
      integrityStatus: attempt.integrity?.status ?? 'NORMAL',
      events: (eventsByAttempt.get(attempt.id) ?? []).sort((a, b) => b.count - a.count),
    };
  });

  const liveQuizzes = await prisma.quiz.findMany({
    where: { ...ownQuizWhere(session.adminId), status: 'PUBLISHED', startsAt: { lte: new Date() }, endsAt: { gte: new Date() } },
    select: {
      id: true,
      title: true,
      endsAt: true,
      subject: { select: { name: true } },
      _count: { select: { assignments: true } },
    },
    orderBy: { endsAt: 'asc' },
  });

  return ok({
    serverNow: new Date().toISOString(),
    students,
    quizzes: liveQuizzes.map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      subject: quiz.subject.name,
      endsAt: quiz.endsAt.toISOString(),
      assigned: quiz._count.assignments,
      active: students.filter((s) => s.quizId === quiz.id).length,
    })),
    summary: {
      active: students.length,
      flagged: students.filter((s) => s.integrityStatus !== 'NORMAL').length,
      unstable: students.filter((s) => s.connection !== 'STABLE').length,
    },
  });
});

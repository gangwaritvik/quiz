import type { Prisma } from '@prisma/client';

import { ok, parseQuery, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ownQuizWhere } from '@/lib/ownership';
import { integrityQueueSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS: Partial<Record<string, Prisma.IntegrityScoreWhereInput>> = {
  'needs-review': { status: { in: ['REVIEW_RECOMMENDED', 'HIGH_RISK'] } },
  'high-risk': { status: 'HIGH_RISK' },
  normal: { status: 'NORMAL' },
};

/** `risk` is lowest integrity score first (100 is clean), as the queue always was. */
const ORDER: Record<string, Prisma.IntegrityScoreOrderByWithRelationInput[]> = {
  risk: [{ score: 'asc' }, { computedAt: 'desc' }],
  newest: [{ attempt: { submittedAt: 'desc' } }],
  oldest: [{ attempt: { submittedAt: 'asc' } }],
  student: [{ attempt: { student: { rollNumber: 'asc' } } }, { attempt: { submittedAt: 'desc' } }],
};

/** Attempts ordered by how much they warrant a human look. */
export const GET = route(async (request: Request) => {
  const session = await requireAdmin();
  const ownQuiz = ownQuizWhere(session.adminId);
  const filters = parseQuery(request, integrityQueueSchema);

  // The faculty's whole set, with no filter applied: it feeds the summary and
  // the "of N" in the count line, so neither moves when a filter changes.
  const everything: Prisma.IntegrityScoreWhereInput = {
    attempt: { status: { not: 'IN_PROGRESS' }, quiz: ownQuiz },
  };

  const where: Prisma.IntegrityScoreWhereInput = {
    ...STATUS[filters.status],
    ...(filters.reviewed === 'all' ? {} : { reviewed: filters.reviewed === 'reviewed' }),
    attempt: {
      status: { not: 'IN_PROGRESS' },
      quiz: ownQuiz,
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
    },
  };

  const [total, scores, counts, quizzes] = await Promise.all([
    prisma.integrityScore.count({ where }),
    prisma.integrityScore.findMany({
      where,
      include: {
        attempt: {
          include: {
            student: { include: { user: { select: { name: true } } } },
            quiz: { select: { title: true, subject: { select: { name: true } } } },
            _count: { select: { events: true, reviews: true } },
          },
        },
      },
      orderBy: [...ORDER[filters.sort], { attemptId: 'asc' }],
      take: 200,
    }),
    prisma.integrityScore.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: everything,
    }),
    // Options for the quiz filter: own quizzes that have a scored attempt.
    prisma.quiz.findMany({
      where: {
        ...ownQuiz,
        attempts: { some: { status: { not: 'IN_PROGRESS' }, integrity: { isNot: null } } },
      },
      select: { id: true, title: true },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    }),
  ]);

  return ok({
    total,
    summary: {
      normal: counts.find((c) => c.status === 'NORMAL')?._count._all ?? 0,
      review: counts.find((c) => c.status === 'REVIEW_RECOMMENDED')?._count._all ?? 0,
      highRisk: counts.find((c) => c.status === 'HIGH_RISK')?._count._all ?? 0,
    },
    quizzes,
    reports: scores.map((entry) => ({
      attemptId: entry.attemptId,
      score: entry.score,
      status: entry.status,
      reviewed: entry.reviewed,
      computedAt: entry.computedAt.toISOString(),
      studentName: entry.attempt.student.user.name,
      rollNumber: entry.attempt.student.rollNumber,
      section: entry.attempt.student.section,
      quizTitle: entry.attempt.quiz.title,
      subject: entry.attempt.quiz.subject.name,
      submittedAt: entry.attempt.submittedAt?.toISOString() ?? null,
      eventCount: entry.attempt._count.events,
      reviewCount: entry.attempt._count.reviews,
    })),
  });
});

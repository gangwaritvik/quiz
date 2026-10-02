import type { Prisma } from '@prisma/client';

import { ok, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Attempts ordered by how much they warrant a human look. */
export const GET = route(async (request: Request) => {
  await requireAdmin();

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const reviewed = url.searchParams.get('reviewed');

  const where: Prisma.IntegrityScoreWhereInput = {
    ...(status && status !== 'ALL'
      ? { status: status as 'NORMAL' | 'REVIEW_RECOMMENDED' | 'HIGH_RISK' }
      : {}),
    ...(reviewed === 'true' ? { reviewed: true } : {}),
    ...(reviewed === 'false' ? { reviewed: false } : {}),
    attempt: { status: { not: 'IN_PROGRESS' } },
  };

  const scores = await prisma.integrityScore.findMany({
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
    orderBy: [{ score: 'asc' }, { computedAt: 'desc' }],
    take: 200,
  });

  const counts = await prisma.integrityScore.groupBy({
    by: ['status'],
    _count: { _all: true },
    where: { attempt: { status: { not: 'IN_PROGRESS' } } },
  });

  return ok({
    summary: {
      normal: counts.find((c) => c.status === 'NORMAL')?._count._all ?? 0,
      review: counts.find((c) => c.status === 'REVIEW_RECOMMENDED')?._count._all ?? 0,
      highRisk: counts.find((c) => c.status === 'HIGH_RISK')?._count._all ?? 0,
    },
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

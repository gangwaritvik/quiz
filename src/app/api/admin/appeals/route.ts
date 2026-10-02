import { z } from 'zod';

import { ok, parseQuery, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ownAttemptWhere } from '@/lib/ownership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  /** `open` (default) is the queue; `all` adds the ones already answered. */
  status: z.enum(['open', 'all']).catch('open'),
});

/** Re-check requests on the caller's own quizzes, newest first. */
export const GET = route(async (request: Request) => {
  const session = await requireAdmin();
  const { status } = parseQuery(request, querySchema);

  const appeals = await prisma.resultAppeal.findMany({
    where: {
      attempt: ownAttemptWhere(session.adminId),
      ...(status === 'open' ? { status: 'OPEN' } : {}),
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      attemptId: true,
      reason: true,
      status: true,
      facultyNote: true,
      createdAt: true,
      resolvedAt: true,
      attempt: {
        select: {
          score: true,
          maxScore: true,
          percentage: true,
          student: {
            select: { rollNumber: true, section: true, user: { select: { name: true } } },
          },
          quiz: { select: { id: true, title: true } },
        },
      },
    },
  });

  return ok({
    appeals: appeals.map((appeal) => ({
      id: appeal.id,
      attemptId: appeal.attemptId,
      reason: appeal.reason,
      status: appeal.status,
      facultyNote: appeal.facultyNote,
      createdAt: appeal.createdAt.toISOString(),
      resolvedAt: appeal.resolvedAt?.toISOString() ?? null,
      studentName: appeal.attempt.student.user.name,
      rollNumber: appeal.attempt.student.rollNumber,
      section: appeal.attempt.student.section,
      quizId: appeal.attempt.quiz.id,
      quizTitle: appeal.attempt.quiz.title,
      score: appeal.attempt.score,
      maxScore: appeal.attempt.maxScore,
      percentage: appeal.attempt.percentage,
    })),
  });
});

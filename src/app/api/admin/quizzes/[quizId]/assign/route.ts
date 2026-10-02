import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { assignQuizSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ quizId: string }>;
}

/** Replaces the assignment list for a quiz. */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { quizId } = await params;

  enforceRateLimit(RATE_LIMITS.adminWrite, `assign:${session.userId}`);
  const body = await parseBody(request, assignQuizSchema);

  const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
  if (!quiz) throw new ApiError('NOT_FOUND', 'Quiz not found.');

  const validStudents = await prisma.student.findMany({
    where: { id: { in: body.studentIds }, user: { status: 'ACTIVE' } },
    select: { id: true },
  });
  const validIds = new Set(validStudents.map((s) => s.id));

  // A student who has already started must keep their assignment, otherwise
  // the next request in their exam would be refused as unassigned.
  const startedStudentIds = await prisma.quizAttempt
    .findMany({ where: { quizId }, select: { studentId: true }, distinct: ['studentId'] })
    .then((rows) => rows.map((r) => r.studentId));

  const finalIds = new Set([...validIds, ...startedStudentIds]);

  await prisma.$transaction([
    prisma.quizAssignment.deleteMany({
      where: { quizId, studentId: { notIn: [...finalIds] } },
    }),
    prisma.quizAssignment.createMany({
      data: [...finalIds].map((studentId) => ({ quizId, studentId })),
      skipDuplicates: true,
    }),
  ]);

  await audit({
    action: 'admin.assignment_updated',
    userId: session.userId,
    entityType: 'Quiz',
    entityId: quizId,
    context,
    metadata: { assigned: finalIds.size, requested: body.studentIds.length },
  });

  return ok({
    assigned: finalIds.size,
    skipped: body.studentIds.length - validIds.size,
    retainedInProgress: startedStudentIds.filter((id) => !validIds.has(id)).length,
  });
});

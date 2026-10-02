import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertQuizOwner } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { setExtensionSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ quizId: string }>;
}

/**
 * Every student assigned to the quiz with the extra time agreed for them before
 * they begin (an accommodation), and whether they already have.
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireAdmin();
  const { quizId } = await params;
  await assertQuizOwner(quizId, session.adminId);

  const [assignments, attempts] = await Promise.all([
    prisma.quizAssignment.findMany({
      where: { quizId },
      select: {
        extraMinutes: true,
        student: {
          select: { id: true, rollNumber: true, section: true, user: { select: { name: true } } },
        },
      },
      orderBy: { student: { rollNumber: 'asc' } },
    }),
    prisma.quizAttempt.findMany({
      where: { quizId },
      select: { studentId: true },
      distinct: ['studentId'],
    }),
  ]);
  const started = new Set(attempts.map((a) => a.studentId));

  return ok({
    students: assignments.map(({ extraMinutes, student }) => ({
      studentId: student.id,
      name: student.user.name,
      rollNumber: student.rollNumber,
      section: student.section,
      extraMinutes,
      started: started.has(student.id),
    })),
  });
});

/**
 * Sets (or with 0 removes) one student's extra time before they start. Once a
 * student has begun their clock is fixed, so further time goes through the live
 * "add time" route instead.
 */
export const PUT = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { quizId } = await params;

  enforceRateLimit(RATE_LIMITS.adminWrite, `extension:${session.userId}`);
  const body = await parseBody(request, setExtensionSchema);

  await assertQuizOwner(quizId, session.adminId);

  const quiz = await prisma.quiz.findUniqueOrThrow({
    where: { id: quizId },
    select: { endsAt: true },
  });
  if (quiz.endsAt <= new Date()) {
    throw new ApiError('CONFLICT', 'This quiz has closed, so extra time can no longer be set.');
  }

  const assignment = await prisma.quizAssignment.findUnique({
    where: { quizId_studentId: { quizId, studentId: body.studentId } },
    select: { extraMinutes: true },
  });
  if (!assignment) throw new ApiError('NOT_FOUND', 'That student is not assigned to this quiz.');

  const attempts = await prisma.quizAttempt.count({
    where: { quizId, studentId: body.studentId },
  });
  if (attempts > 0) {
    throw new ApiError('CONFLICT', 'This student has already started, so their time is fixed.');
  }

  // Raise the quiz's results-release horizon first (never lowered), so scores
  // cannot unlock while this student may still be sitting on their extra time.
  if (body.minutes > 0) {
    await prisma.quiz.updateMany({
      where: { id: quizId, maxExtensionMinutes: { lt: body.minutes } },
      data: { maxExtensionMinutes: body.minutes },
    });
  }

  // Re-check "not started" inside the write: the attempt row is created in a
  // separate transaction, so this keeps a start racing the update from being
  // given the old figure silently.
  await prisma.quizAssignment.update({
    where: { quizId_studentId: { quizId, studentId: body.studentId } },
    data: { extraMinutes: body.minutes },
  });
  const raced = await prisma.quizAttempt.count({ where: { quizId, studentId: body.studentId } });
  if (raced > 0) {
    await prisma.quizAssignment.update({
      where: { quizId_studentId: { quizId, studentId: body.studentId } },
      data: { extraMinutes: assignment.extraMinutes },
    });
    throw new ApiError(
      'CONFLICT',
      'This student started just now, so their time is fixed. Use "Add time" on Live exams.',
    );
  }

  await audit({
    action: 'admin.time_extended',
    userId: session.userId,
    entityType: 'Quiz',
    entityId: quizId,
    context,
    metadata: {
      kind: 'prestart_extension',
      studentId: body.studentId,
      from: assignment.extraMinutes,
      to: body.minutes,
    },
  });

  return ok({ studentId: body.studentId, extraMinutes: body.minutes });
});

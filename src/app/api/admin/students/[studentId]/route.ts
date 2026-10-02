import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ownAttemptWhere } from '@/lib/ownership';
import { getRequestContext } from '@/lib/session';
import { updateStudentSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ studentId: string }>;
}

export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireAdmin();
  const { studentId } = await params;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      user: {
        select: { id: true, name: true, email: true, status: true, lastLoginAt: true },
      },
      // Directory fields are shared; attempts only from this faculty's quizzes.
      attempts: {
        where: ownAttemptWhere(session.adminId),
        include: {
          quiz: { select: { title: true, releaseResults: true } },
          integrity: { select: { score: true, status: true } },
        },
        orderBy: { startedAt: 'desc' },
      },
    },
  });

  if (!student) throw new ApiError('NOT_FOUND', 'Student not found.');

  const devices = await prisma.deviceSession.findMany({
    where: { userId: student.userId },
    orderBy: { lastSeenAt: 'desc' },
    take: 10,
    select: {
      id: true,
      deviceLabel: true,
      trusted: true,
      lastSeenAt: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  return ok({
    student: {
      id: student.id,
      name: student.user.name,
      email: student.user.email,
      rollNumber: student.rollNumber,
      department: student.department,
      section: student.section,
      semester: student.semester,
      status: student.user.status,
      lastLoginAt: student.user.lastLoginAt?.toISOString() ?? null,
    },
    attempts: student.attempts.map((attempt) => ({
      id: attempt.id,
      quizTitle: attempt.quiz.title,
      status: attempt.status,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percentage: attempt.percentage,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      integrityScore: attempt.integrity?.score ?? null,
      integrityStatus: attempt.integrity?.status ?? null,
    })),
    devices: devices.map((device) => ({
      id: device.id,
      label: device.deviceLabel,
      trusted: device.trusted,
      lastSeenAt: device.lastSeenAt.toISOString(),
      active: !device.revokedAt && device.expiresAt > new Date(),
    })),
  });
});

export const PATCH = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { studentId } = await params;

  const body = await parseBody(request, updateStudentSchema);

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw new ApiError('NOT_FOUND', 'Student not found.');

  if (body.rollNumber && body.rollNumber !== student.rollNumber) {
    const taken = await prisma.student.findFirst({
      where: { rollNumber: body.rollNumber, id: { not: studentId } },
    });
    if (taken) throw new ApiError('CONFLICT', 'That student ID is already in use.');
  }

  await prisma.student.update({
    where: { id: studentId },
    data: {
      ...(body.rollNumber ? { rollNumber: body.rollNumber } : {}),
      ...(body.department ? { department: body.department } : {}),
      ...(body.section ? { section: body.section } : {}),
      ...(body.semester ? { semester: body.semester } : {}),
      user: {
        update: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.email ? { email: body.email.toLowerCase() } : {}),
          ...(body.status ? { status: body.status } : {}),
        },
      },
    },
  });

  // Disabling an account must terminate its live sessions, not just block
  // future logins.
  if (body.status === 'DISABLED') {
    await prisma.deviceSession.updateMany({
      where: { userId: student.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'account_disabled' },
    });
  }

  await audit({
    action: 'admin.student_updated',
    userId: session.userId,
    entityType: 'Student',
    entityId: studentId,
    context,
    metadata: { changes: Object.keys(body) },
  });

  return ok({ studentId });
});

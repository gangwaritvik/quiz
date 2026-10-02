import type { Prisma } from '@prisma/client';

import { ApiError, assertSameOrigin, ok, parseBody, parseQuery, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { createStudentSchema, studentFilterSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request: Request) => {
  await requireAdmin();
  const filters = parseQuery(request, studentFilterSchema);

  const where: Prisma.StudentWhereInput = {
    ...(filters.department ? { department: filters.department } : {}),
    ...(filters.section ? { section: filters.section } : {}),
    ...(filters.status ? { user: { status: filters.status } } : {}),
    ...(filters.search
      ? {
          OR: [
            { rollNumber: { contains: filters.search, mode: 'insensitive' as const } },
            { user: { name: { contains: filters.search, mode: 'insensitive' as const } } },
            { user: { email: { contains: filters.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [total, students] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            lastLoginAt: true,
            _count: { select: { deviceSessions: true } },
          },
        },
        _count: { select: { attempts: true } },
      },
      orderBy: { rollNumber: 'asc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);

  return ok({
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
    students: students.map((student) => ({
      id: student.id,
      userId: student.userId,
      name: student.user.name,
      email: student.user.email,
      rollNumber: student.rollNumber,
      department: student.department,
      section: student.section,
      semester: student.semester,
      status: student.user.status,
      lastLoginAt: student.user.lastLoginAt?.toISOString() ?? null,
      attemptCount: student._count.attempts,
      registeredDevices: student.user._count.deviceSessions,
    })),
  });
});

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  enforceRateLimit(RATE_LIMITS.adminWrite, `student-create:${session.userId}`);

  const body = await parseBody(request, createStudentSchema);

  const [emailTaken, rollTaken] = await Promise.all([
    prisma.user.findFirst({ where: { email: { equals: body.email, mode: 'insensitive' } } }),
    prisma.student.findFirst({
      where: { rollNumber: { equals: body.rollNumber, mode: 'insensitive' } },
    }),
  ]);

  if (emailTaken) throw new ApiError('CONFLICT', 'A user with that email already exists.');
  if (rollTaken) throw new ApiError('CONFLICT', 'A student with that ID already exists.');

  const student = await prisma.student.create({
    data: {
      rollNumber: body.rollNumber,
      department: body.department,
      section: body.section,
      semester: body.semester,
      user: {
        create: {
          name: body.name,
          email: body.email.toLowerCase(),
          role: 'STUDENT',
          status: 'ACTIVE',
        },
      },
    },
  });

  await audit({
    action: 'admin.student_created',
    userId: session.userId,
    entityType: 'Student',
    entityId: student.id,
    context,
    metadata: { rollNumber: body.rollNumber },
  });

  return ok({ studentId: student.id });
});

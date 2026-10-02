import { ok, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { statusForScore } from '@/lib/integrity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const session = await requireStudent();

  const [student, devices, integrityScores, attemptCount] = await Promise.all([
    prisma.student.findUnique({
      where: { id: session.studentId },
      include: { user: { select: { name: true, email: true, lastLoginAt: true, status: true } } },
    }),
    prisma.deviceSession.findMany({
      where: { userId: session.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        deviceLabel: true,
        trusted: true,
        lastSeenAt: true,
        createdAt: true,
      },
    }),
    prisma.integrityScore.findMany({
      where: { attempt: { studentId: session.studentId } },
      select: { score: true },
    }),
    prisma.quizAttempt.count({ where: { studentId: session.studentId } }),
  ]);

  const averageIntegrity =
    integrityScores.length > 0
      ? Math.round(integrityScores.reduce((sum, s) => sum + s.score, 0) / integrityScores.length)
      : 100;

  return ok({
    profile: {
      name: student?.user.name ?? session.name,
      email: student?.user.email ?? session.email,
      rollNumber: student?.rollNumber ?? null,
      department: student?.department ?? null,
      section: student?.section ?? null,
      semester: student?.semester ?? null,
      enrollmentYear: student?.enrollmentYear ?? null,
      status: student?.user.status ?? 'ACTIVE',
      lastLoginAt: student?.user.lastLoginAt?.toISOString() ?? null,
    },
    // The current session is highlighted so a student can tell which row is
    // "this browser" before revoking anything.
    devices: devices.map((device) => ({
      id: device.id,
      label: device.deviceLabel,
      trusted: device.trusted,
      current: device.id === session.sessionId,
      lastSeenAt: device.lastSeenAt.toISOString(),
      createdAt: device.createdAt.toISOString(),
    })),
    integrity: {
      average: averageIntegrity,
      status: statusForScore(averageIntegrity),
      attempts: attemptCount,
    },
  });
});

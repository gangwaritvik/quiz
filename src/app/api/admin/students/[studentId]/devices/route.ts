import { ApiError, assertSameOrigin, ok, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getRequestContext } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ studentId: string }>;
}

/**
 * Resets a student's device registration.
 *
 * Needed when a student legitimately changes laptop mid-semester: every
 * existing session is revoked so the next login re-binds cleanly. Attempts
 * already in progress are left alone — the student would be locked out of an
 * exam they are sitting.
 */
export const DELETE = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { studentId } = await params;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, userId: true, rollNumber: true },
  });
  if (!student) throw new ApiError('NOT_FOUND', 'Student not found.');

  const liveAttempts = await prisma.quizAttempt.count({
    where: { studentId, status: 'IN_PROGRESS' },
  });
  if (liveAttempts > 0) {
    throw new ApiError(
      'CONFLICT',
      'This student is currently taking an exam. Resetting their device now would end that attempt.',
    );
  }

  const result = await prisma.deviceSession.updateMany({
    where: { userId: student.userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'admin_device_reset' },
  });

  await audit({
    action: 'admin.device_reset',
    userId: session.userId,
    entityType: 'Student',
    entityId: studentId,
    context,
    metadata: { revokedSessions: result.count, rollNumber: student.rollNumber },
  });

  return ok({ revokedSessions: result.count });
});

import { ApiError, assertSameOrigin, ok, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getRequestContext, revokeSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ sessionId: string }>;
}

/** Lets a student sign out a device they no longer recognise. */
export const DELETE = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireStudent();
  const context = await getRequestContext();
  const { sessionId } = await params;

  const target = await prisma.deviceSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true },
  });

  // Ownership check: a session id from another account must not be revocable.
  if (!target || target.userId !== session.userId) {
    throw new ApiError('NOT_FOUND', 'That device was not found on your account.');
  }
  if (target.id === session.sessionId) {
    throw new ApiError('CONFLICT', 'Use “Sign out” to end the session you are currently using.');
  }

  const liveAttempt = await prisma.quizAttempt.findFirst({
    where: { studentId: session.studentId, status: 'IN_PROGRESS', sessionId: target.id },
    select: { id: true },
  });
  if (liveAttempt) {
    throw new ApiError(
      'CONFLICT',
      'That device has an examination in progress. Finish or submit it before signing the device out.',
    );
  }

  await revokeSession(target.id, 'student_revoked');
  await audit({
    action: 'auth.session_revoked',
    userId: session.userId,
    entityType: 'DeviceSession',
    entityId: target.id,
    context,
  });

  return ok({ revoked: true });
});

import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertQuizOwner } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { sendNoticeSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ quizId: string }>;
}

/**
 * Broadcasts a short notice to everyone sitting this quiz. Students pick it up
 * with their next heartbeat (within about 20 seconds); there is no read receipt.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { quizId } = await params;

  // Few and deliberate: a stream of notices would bury the paper.
  enforceRateLimit(RATE_LIMITS.adminWrite, `notice:${session.userId}`);
  const { message } = await parseBody(request, sendNoticeSchema);

  await assertQuizOwner(quizId, session.adminId);

  const sitting = await prisma.quizAttempt.count({ where: { quizId, status: 'IN_PROGRESS' } });
  if (sitting === 0) {
    throw new ApiError('CONFLICT', 'Nobody is sitting this quiz right now, so there is no one to tell.');
  }

  const notice = await prisma.quizNotice.create({
    data: { quizId, authorId: session.adminId, message },
    select: { id: true, createdAt: true },
  });

  await audit({
    action: 'admin.notice_sent',
    userId: session.userId,
    entityType: 'Quiz',
    entityId: quizId,
    context,
    metadata: { noticeId: notice.id, sitting, length: message.length },
  });

  return ok({ id: notice.id, createdAt: notice.createdAt.toISOString(), sitting });
});

import { acceptDraft } from '@/lib/ai/jobs';
import { ApiError, assertSameOrigin, ok, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertJobOwner } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ jobId: string }>;
}

/** Accepts every pending draft that passes validation; the rest stay for review. */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);
  const session = await requireAdmin();
  const context = await getRequestContext();
  const { jobId } = await params;
  enforceRateLimit(RATE_LIMITS.adminWrite, `ai-accept-all:${session.userId}`);
  await assertJobOwner(jobId, session.adminId);

  const pending = await prisma.questionDraft.findMany({
    where: { jobId, status: 'PENDING' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  let accepted = 0;
  let skipped = 0;
  for (const draft of pending) {
    try {
      const question = await acceptDraft({ draftId: draft.id, adminId: session.adminId });
      accepted += 1;
      await audit({
        action: 'admin.ai_draft_accepted',
        userId: session.userId,
        entityType: 'Question',
        entityId: question.id,
        context,
        metadata: { draftId: draft.id, jobId, bulk: true },
      });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      skipped += 1;
    }
  }

  return ok({ accepted, skipped });
});

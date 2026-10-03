import { acceptDraft } from '@/lib/ai/jobs';
import { assertSameOrigin, ok, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { assertDraftOwner } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ draftId: string }>;
}

/**
 * Accepts a draft into the question bank. An optional body carries the
 * teacher's edited version, validated like any hand-written question.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);
  const session = await requireAdmin();
  const context = await getRequestContext();
  const { draftId } = await params;
  enforceRateLimit(RATE_LIMITS.adminWrite, `ai-accept:${session.userId}`);
  await assertDraftOwner(draftId, session.adminId);

  const raw = await request.text();
  let edited: unknown;
  let allowSimilar = false;
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as { question?: unknown; allowSimilar?: unknown };
      edited = parsed.question;
      allowSimilar = parsed.allowSimilar === true;
    } catch {
      edited = undefined;
    }
  }

  const question = await acceptDraft({ draftId, adminId: session.adminId, edited, allowSimilar });
  await audit({
    action: 'admin.ai_draft_accepted',
    userId: session.userId,
    entityType: 'Question',
    entityId: question.id,
    context,
    metadata: { draftId, edited: edited !== undefined, allowSimilar },
  });
  return ok({ questionId: question.id });
});

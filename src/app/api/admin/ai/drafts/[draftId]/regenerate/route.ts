import { regenerateDraft } from '@/lib/ai/jobs';
import { AiError } from '@/lib/ai/provider';
import { ApiError, assertSameOrigin, ok, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { assertDraftOwner } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ draftId: string }>;
}

/** Replaces one draft with a fresh question of the same type and difficulty. */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);
  const session = await requireAdmin();
  const { draftId } = await params;
  // Each regeneration is a model call, so it shares the generation budget.
  enforceRateLimit(RATE_LIMITS.aiGenerate, `ai-generate:${session.userId}`);
  await assertDraftOwner(draftId, session.adminId);

  try {
    const draft = await regenerateDraft(draftId);
    return ok({ id: draft.id, payload: draft.payload, source: draft.source });
  } catch (error) {
    if (error instanceof AiError) throw new ApiError('CONFLICT', error.message);
    throw error;
  }
});

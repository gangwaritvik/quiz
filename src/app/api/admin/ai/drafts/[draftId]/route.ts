import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { normalizeForMatch } from '@/lib/ai/verification';
import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertDraftOwner } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { instantQuestionSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ draftId: string }>;
}

const editDraftSchema = z.object({
  draft: instantQuestionSchema,
  topicId: z.string().max(40).default(''),
});

/** Saves the teacher's edits to a draft without accepting it yet. */
export const PATCH = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);
  const session = await requireAdmin();
  const { draftId } = await params;
  enforceRateLimit(RATE_LIMITS.adminWrite, `ai-draft:${session.userId}`);
  await assertDraftOwner(draftId, session.adminId);

  const body = await parseBody(request, editDraftSchema);
  // A suggested extra answer is dropped once the teacher's version lists it.
  const current = await prisma.questionDraft.findUnique({ where: { id: draftId }, select: { source: true } });
  const source = { ...((current?.source as Record<string, unknown> | null) ?? {}) };
  const listed = (body.draft.acceptedAnswers ?? []).map(normalizeForMatch);
  if (typeof source.suggestedAnswer === 'string' && listed.includes(normalizeForMatch(source.suggestedAnswer))) {
    delete source.suggestedAnswer;
  }
  const updated = await prisma.questionDraft.updateMany({
    where: { id: draftId, status: 'PENDING' },
    data: { payload: { ...body.draft, topicId: body.topicId }, source: source as Prisma.InputJsonValue },
  });
  if (updated.count !== 1) throw new ApiError('CONFLICT', 'This draft has already been handled.');
  return ok({ id: draftId });
});

/** Discards a draft. It stays on record as discarded. */
export const DELETE = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);
  const session = await requireAdmin();
  const context = await getRequestContext();
  const { draftId } = await params;
  enforceRateLimit(RATE_LIMITS.adminWrite, `ai-draft:${session.userId}`);
  await assertDraftOwner(draftId, session.adminId);

  const updated = await prisma.questionDraft.updateMany({
    where: { id: draftId, status: 'PENDING' },
    data: { status: 'DISCARDED' },
  });
  if (updated.count !== 1) throw new ApiError('CONFLICT', 'This draft has already been handled.');
  await audit({
    action: 'admin.ai_draft_discarded',
    userId: session.userId,
    entityType: 'QuestionDraft',
    entityId: draftId,
    context,
  });
  return ok({ id: draftId });
});

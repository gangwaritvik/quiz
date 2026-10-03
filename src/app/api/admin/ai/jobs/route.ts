import { z } from 'zod';

import { runJob } from '@/lib/ai/jobs';
import { aiEnabled } from '@/lib/ai/provider';
import { generationParamsSchema } from '@/lib/ai/question-generation';
import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const id = z.string().min(20).max(40).regex(/^[a-z0-9]+$/i);

const createJobSchema = z.object({
  subjectId: id,
  materialIds: z.array(id).min(1, 'Choose at least one material.').max(5),
  params: generationParamsSchema,
});

/**
 * Starts generating draft questions. Everything that can be checked up front
 * is checked here, so a job only fails for reasons the teacher could not have
 * seen (the AI, the quota). The work itself runs in the background.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const session = await requireAdmin();
  const context = await getRequestContext();

  if (!aiEnabled()) throw new ApiError('CONFLICT', 'AI question generation is not set up on this server.');
  const body = await parseBody(request, createJobSchema);
  enforceRateLimit(RATE_LIMITS.aiGenerate, `ai-generate:${session.userId}`);

  const materialIds = [...new Set(body.materialIds)];
  const materials = await prisma.studyMaterial.findMany({
    where: { id: { in: materialIds } },
    select: { id: true, ownerId: true, subjectId: true, status: true, mimeType: true, pageCount: true },
  });
  if (materials.length !== materialIds.length) throw new ApiError('NOT_FOUND', 'One of those materials no longer exists.');
  if (materials.some((material) => material.ownerId !== session.adminId)) {
    throw new ApiError('FORBIDDEN', 'You can only generate from your own study material.');
  }
  if (materials.some((material) => material.subjectId !== body.subjectId)) {
    throw new ApiError('VALIDATION', 'Every material must belong to this subject.');
  }
  if (materials.some((material) => material.status !== 'READY')) {
    throw new ApiError('CONFLICT', 'Wait until the chosen materials are ready.');
  }

  const { focus, topicId } = body.params;
  if (focus.mode === 'pages') {
    const [only] = materials;
    if (materials.length !== 1 || only!.mimeType !== 'application/pdf') {
      throw new ApiError('VALIDATION', 'Page ranges work with a single PDF. Choose one PDF, or use a topic focus.');
    }
    if (only!.pageCount !== null && focus.to > only!.pageCount) {
      throw new ApiError('VALIDATION', `This PDF has ${only!.pageCount} pages.`);
    }
    if (focus.to - focus.from + 1 > 100) {
      throw new ApiError('VALIDATION', 'Choose at most 100 pages at a time.');
    }
  }
  if (topicId) {
    const topic = await prisma.topic.findFirst({ where: { id: topicId, subjectId: body.subjectId } });
    if (!topic) throw new ApiError('VALIDATION', 'That topic does not belong to the subject.');
  }

  const job = await prisma.generationJob.create({
    data: {
      subjectId: body.subjectId,
      authorId: session.adminId,
      materialIds,
      params: body.params,
    },
    select: { id: true },
  });

  await audit({
    action: 'admin.ai_job_created',
    userId: session.userId,
    entityType: 'GenerationJob',
    entityId: job.id,
    context,
    metadata: { subjectId: body.subjectId, count: body.params.count, focus: focus.mode },
  });

  void runJob(job.id);
  return ok({ id: job.id });
});

import 'server-only';

import type { Prisma } from '@prisma/client';

import { readMaterialFile } from '@/lib/ai/materials';
import { extractPages, pageRange } from '@/lib/ai/pdf-pages';
import { AiError, type RetrievedSource, getProvider } from '@/lib/ai/provider';
import {
  AI_QUESTION_TYPES,
  AI_RESPONSE_SCHEMA,
  type AcceptedDraft,
  type AiQuestionType,
  type DifficultyCounts,
  type DraftSource,
  type GenerationParams,
  buildPrompt,
  generationParamsSchema,
  planBatches,
  splitByMix,
  validateModelOutput,
} from '@/lib/ai/question-generation';
import { ApiError } from '@/lib/api';
import { type SemanticGuard, createSemanticGuard } from '@/lib/ai/similarity';
import { prisma } from '@/lib/db';
import { questionFieldsFromInput, questionOptionsFromInput } from '@/lib/questions';
import { createQuestionSchema } from '@/lib/validation';

/** A job still "running" after this was cut off (e.g. a server restart). */
const STALE_MS = 10 * 60_000;

/** Context one generation call needs, loaded once per job. */
interface JobContext {
  subjectName: string;
  topics: Array<{ id: string; name: string }>;
  existing: string[];
  params: GenerationParams;
  store: string | null;
  materialIds: string[];
  inline?: { bytes: Uint8Array; mimeType: string };
  guard: SemanticGuard;
}

async function loadContext(job: {
  subjectId: string;
  materialIds: string[];
  params: Prisma.JsonValue;
}): Promise<JobContext> {
  const params = generationParamsSchema.parse(job.params);
  const [subject, existing, materials] = await Promise.all([
    prisma.subject.findUniqueOrThrow({
      where: { id: job.subjectId },
      select: { name: true, fileSearchStore: true, topics: { select: { id: true, name: true } } },
    }),
    prisma.question.findMany({
      where: { subjectId: job.subjectId, active: true },
      select: { text: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.studyMaterial.findMany({
      where: { id: { in: job.materialIds }, status: 'READY' },
      select: { id: true, storageKey: true, mimeType: true },
    }),
  ]);
  if (materials.length === 0) throw new AiError('None of the chosen materials is ready any more.');

  let inline: JobContext['inline'];
  if (params.focus.mode === 'pages') {
    const pdf = materials[0]!;
    inline = {
      bytes: await extractPages(
        await readMaterialFile(pdf.storageKey),
        pageRange(params.focus.from, params.focus.to),
      ),
      mimeType: 'application/pdf',
    };
  }

  return {
    subjectName: subject.name,
    topics: subject.topics,
    existing: existing.map((question) => question.text),
    params,
    store: subject.fileSearchStore,
    materialIds: materials.map((material) => material.id),
    inline,
    guard: await createSemanticGuard(job.subjectId),
  };
}

/** Where a draft came from: the model's own citation, else the retrieved passage it quotes. */
function attachSource(draft: AcceptedDraft, sources: RetrievedSource[], ctx: JobContext): DraftSource {
  const source = { ...draft.source };
  if (!source.materialId && ctx.materialIds.length === 1) source.materialId = ctx.materialIds[0];
  // With a page range the model only saw those pages, numbered from 1.
  const focus = ctx.params.focus;
  if (focus.mode === 'pages' && source.page) {
    const page = focus.from + source.page - 1;
    source.page = page >= focus.from && page <= focus.to ? page : undefined;
  }
  const quote = source.excerpt?.toLowerCase().slice(0, 40);
  const match = quote ? sources.find((entry) => entry.text?.toLowerCase().includes(quote)) : undefined;
  if (match) {
    source.materialId ??= match.materialId;
    source.page ??= match.page;
  }
  return source;
}

/** One model call: `batch` questions of the job's types, validated and de-duplicated. */
async function generateBatch(ctx: JobContext, batch: DifficultyCounts, types: AiQuestionType[], avoid: string[]) {
  const provider = await getProvider();
  const { json, sources } = await provider.generate({
    prompt: buildPrompt({
      subjectName: ctx.subjectName,
      topics: ctx.topics.map((topic) => topic.name),
      focus: ctx.params.focus,
      batch,
      types,
      bloom: ctx.params.bloom,
      avoid,
    }),
    schema: AI_RESPONSE_SCHEMA,
    ...(ctx.inline
      ? { inline: ctx.inline }
      : { retrieval: { store: ctx.store ?? '', materialIds: ctx.materialIds } }),
    request: { batch, types },
  });
  const outcome = validateModelOutput(json, {
    marks: ctx.params.marks,
    negativeMarks: ctx.params.negativeMarks,
    fixedTopicId: ctx.params.topicId,
    topicIdByName: new Map(ctx.topics.map((topic) => [topic.name.toLowerCase(), topic.id])),
    existing: avoid,
  });
  const { kept, dropped } = await ctx.guard.filter(outcome.drafts);
  return {
    ...outcome,
    dropped: outcome.dropped + dropped,
    drafts: kept.map((draft) => ({ ...draft, source: attachSource(draft, sources, ctx) })),
  };
}

/** Runs a job to the end. Never throws: the outcome is recorded on the job. */
export async function runJob(jobId: string) {
  const claimed = await prisma.generationJob.updateMany({
    where: { id: jobId, status: 'QUEUED' },
    data: { status: 'RUNNING' },
  });
  if (claimed.count !== 1) return;

  let created = 0;
  let dropped = 0;
  try {
    const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    const ctx = await loadContext(job);
    const avoid = [...ctx.existing];

    for (const batch of planBatches(splitByMix(ctx.params.count, ctx.params.mix))) {
      const outcome = await generateBatch(ctx, batch, ctx.params.types, avoid);
      dropped += outcome.dropped;
      if (outcome.drafts.length > 0) {
        await prisma.questionDraft.createMany({
          data: outcome.drafts.map((draft) => ({
            jobId,
            payload: draft.body as unknown as Prisma.InputJsonValue,
            source: draft.source as Prisma.InputJsonValue,
          })),
        });
        created += outcome.drafts.length;
        avoid.push(...outcome.drafts.map((draft) => draft.body.text));
      }
      await prisma.generationJob.update({
        where: { id: jobId },
        data: { stats: { asked: ctx.params.count, created, dropped } },
      });
    }

    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: 'DONE',
        finishedAt: new Date(),
        stats: { asked: ctx.params.count, created, dropped },
        error:
          created === 0
            ? 'The AI did not return any usable questions. Try a broader focus or another material.'
            : null,
      },
    });
  } catch (error) {
    console.error('[ai] generation job failed', jobId, error);
    const message =
      error instanceof AiError ? error.message : 'Generation stopped because of an unexpected error.';
    await prisma.generationJob
      .update({
        where: { id: jobId },
        data: {
          // Questions made before the failure are kept for review.
          status: created > 0 ? 'DONE' : 'FAILED',
          finishedAt: new Date(),
          stats: { created, dropped },
          error: created > 0 ? `Stopped early: ${message}` : message,
        },
      })
      .catch(() => undefined);
  }
}

export async function failStaleJobs(authorId: string) {
  await prisma.generationJob.updateMany({
    where: {
      authorId,
      status: { in: ['QUEUED', 'RUNNING'] },
      createdAt: { lt: new Date(Date.now() - STALE_MS) },
    },
    data: { status: 'FAILED', error: 'Generation was interrupted. Start it again.', finishedAt: new Date() },
  });
}

/** Replaces one draft with a fresh question of the same difficulty and type. */
export async function regenerateDraft(draftId: string) {
  const draft = await prisma.questionDraft.findUniqueOrThrow({
    where: { id: draftId },
    include: { job: true },
  });
  if (draft.status !== 'PENDING') throw new ApiError('CONFLICT', 'Only a draft waiting for review can be regenerated.');

  const payload = draft.payload as { type?: string; difficulty?: keyof DifficultyCounts; text?: string };
  const ctx = await loadContext(draft.job);
  const type = (AI_QUESTION_TYPES as readonly string[]).includes(payload.type ?? '')
    ? (payload.type as AiQuestionType)
    : ctx.params.types[0]!;
  const batch: DifficultyCounts = { EASY: 0, MEDIUM: 0, HARD: 0 };
  batch[payload.difficulty ?? 'MEDIUM'] = 1;

  const siblings = await prisma.questionDraft.findMany({
    where: { jobId: draft.jobId, status: { not: 'DISCARDED' } },
    select: { payload: true },
  });
  const avoid = [
    ...ctx.existing,
    ...siblings.map((sibling) => String((sibling.payload as { text?: string }).text ?? '')),
  ];
  // A different question, not a rewording of the old one: try a few times.
  let fresh: Awaited<ReturnType<typeof generateBatch>>['drafts'][number] | undefined;
  for (let attempt = 0; attempt < 3 && !fresh; attempt += 1) {
    fresh = (await generateBatch(ctx, batch, [type], avoid)).drafts[0];
  }
  if (!fresh) throw new AiError('The AI could not produce a different question this time. Try again.');

  return prisma.questionDraft.update({
    where: { id: draftId },
    data: {
      payload: fresh.body as unknown as Prisma.InputJsonValue,
      source: fresh.source as Prisma.InputJsonValue,
    },
  });
}

/**
 * Turns a pending draft into a bank question, optionally with the teacher's
 * edits. Validated exactly like a hand-written question. The draft is claimed
 * first, so a double click creates one question, not two.
 */
export async function acceptDraft(input: { draftId: string; adminId: string; edited?: unknown }) {
  const draft = await prisma.questionDraft.findUniqueOrThrow({
    where: { id: input.draftId },
    include: { job: { select: { subjectId: true } } },
  });
  if (draft.status !== 'PENDING') throw new ApiError('CONFLICT', 'This draft has already been handled.');

  const parsed = createQuestionSchema.safeParse({
    ...((input.edited ?? draft.payload) as object),
    subjectId: draft.job.subjectId,
  });
  if (!parsed.success) {
    throw new ApiError('VALIDATION', parsed.error.issues[0]?.message ?? 'This question is not valid.', parsed.error.flatten());
  }
  const body = parsed.data;
  if (body.topicId) {
    const topic = await prisma.topic.findFirst({ where: { id: body.topicId, subjectId: body.subjectId } });
    if (!topic) throw new ApiError('VALIDATION', 'That topic does not belong to the subject.');
  }

  return prisma.$transaction(async (tx) => {
    const claim = await tx.questionDraft.updateMany({
      where: { id: input.draftId, status: 'PENDING' },
      data: { status: 'ACCEPTED' },
    });
    if (claim.count !== 1) throw new ApiError('CONFLICT', 'This draft has already been handled.');
    const question = await tx.question.create({
      data: {
        ...questionFieldsFromInput(body),
        subjectId: body.subjectId,
        authorId: input.adminId,
        aiGenerated: true,
        options: { create: questionOptionsFromInput(body) },
      },
      select: { id: true },
    });
    await tx.questionDraft.update({
      where: { id: input.draftId },
      data: { questionId: question.id, payload: body as unknown as Prisma.InputJsonValue },
    });
    return question;
  });
}

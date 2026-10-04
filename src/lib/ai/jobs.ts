import 'server-only';

import type { Prisma } from '@prisma/client';

import { pagesForQuery, pagesInRange, sliceForBatch } from '@/lib/ai/material-text';
import { materialPages, readMaterialFile } from '@/lib/ai/materials';
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
  questionSignature,
  splitByMix,
  validateModelOutput,
} from '@/lib/ai/question-generation';
import { ApiError } from '@/lib/api';
import { type SemanticGuard, assertNoBankRepeat, createSemanticGuard, findSimilarInBank } from '@/lib/ai/similarity';
import { prisma } from '@/lib/db';
import { questionFieldsFromInput, questionOptionsFromInput } from '@/lib/questions';
import {
  type CheckItem,
  compareAnswer,
  isFlagged,
  locateQuote,
  suggestAnswer,
  toCheckItem,
} from '@/lib/ai/verification';
import { createQuestionSchema, quizSecuritySchema } from '@/lib/validation';

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
  /** The materials' own text by id, one entry per page, for checking quotes. */
  pages: Map<string, string[]>;
  titles: Map<string, string>;
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
      select: { id: true, title: true, storageKey: true, mimeType: true, ocrText: true },
    }),
  ]);
  if (materials.length === 0) throw new AiError('None of the chosen materials is ready any more.');

  let inline: JobContext['inline'];
  if (params.focus.mode === 'pages' && (await getProvider()).readsPdf) {
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
    pages: new Map(await Promise.all(materials.map(async (material) => [material.id, await materialPages(material)] as const))),
    titles: new Map(materials.map((material) => [material.id, material.title])),
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

/** The most of a passage a second reading is shown. */
const PASSAGE_CHARS = 4000;

/**
 * Looks up each draft's quote in the material's own text (correcting the page
 * to where it really is), then has the answer re-derived from that page. The
 * results go on the draft so the review screen can flag what needs a closer
 * look. Never blocks a draft: a check that cannot run just leaves it unmarked.
 */
async function verifyDrafts(drafts: Array<{ body: AcceptedDraft['body']; source: DraftSource }>, ctx: JobContext) {
  const range = ctx.params.focus.mode === 'pages' ? { from: ctx.params.focus.from, to: ctx.params.focus.to } : undefined;
  const items: CheckItem[] = [];

  for (const [index, draft] of drafts.entries()) {
    const { source } = draft;
    const candidates = source.materialId ? [source.materialId] : ctx.materialIds;
    const readable = candidates.filter((id) => (ctx.pages.get(id) ?? []).some((page) => page.trim()));
    if (!source.excerpt) {
      source.quote = 'missing';
      continue;
    }
    if (readable.length === 0) {
      source.quote = 'unchecked';
      continue;
    }
    let passage = '';
    source.quote = 'missing';
    for (const id of readable) {
      const found = locateQuote(source.excerpt, ctx.pages.get(id)!, range);
      if (!found) continue;
      source.materialId = id;
      source.page = found.page;
      source.quote = found.exact ? 'exact' : 'close';
      passage = ctx.pages.get(id)![found.page - 1]!.slice(0, PASSAGE_CHARS);
      break;
    }
    if (passage) items.push(toCheckItem(draft.body, index, passage));
  }

  if (items.length === 0) return;
  try {
    const answers = await (await getProvider()).check(items);
    for (const item of items) {
      const draft = drafts[item.id]!;
      const answer = answers.find((entry) => entry.id === item.id);
      const verdict = compareAnswer(draft.body, answer);
      if (verdict) draft.source.check = verdict;
      const suggestion = suggestAnswer(draft.body, answer);
      if (suggestion) draft.source.suggestedAnswer = suggestion;
    }
  } catch (error) {
    console.warn('[ai] second reading unavailable', error);
  }
}

/** One model call: `batch` questions of the job's types, validated and de-duplicated. */
async function generateBatch(
  ctx: JobContext,
  batch: DifficultyCounts,
  types: AiQuestionType[],
  avoid: string[],
  /** Which of the job's batches this is, so each covers a different part of the material. */
  slot: { index: number; count: number } = { index: 0, count: 1 },
) {
  const provider = await getProvider();
  // Text we choose ourselves: whole-material focus always (a different window per batch),
  // and topic or page focus for a model that cannot search a store or read a PDF.
  const focus = ctx.params.focus;
  const sliceMaterials = ctx.materialIds.map((id) => ({ title: ctx.titles.get(id) ?? 'Material', pages: ctx.pages.get(id) ?? [] }));
  let text = '';
  if (focus.mode === 'whole') {
    text = sliceForBatch(sliceMaterials, slot.index, slot.count, provider.maxContextChars);
  } else if (focus.mode === 'topic' && !provider.searchesStore) {
    text = pagesForQuery(sliceMaterials, focus.query, provider.maxContextChars);
    if (!text) throw new AiError('Nothing in the chosen material matches that topic.');
  } else if (focus.mode === 'pages' && !provider.readsPdf) {
    text = pagesInRange(sliceMaterials[0]!, focus.from, focus.to, provider.maxContextChars);
    if (!text) throw new AiError('Those pages have no readable text.');
  }
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
      : text
        ? { text }
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
  const drafts = kept.map((draft) => ({ ...draft, source: attachSource(draft, sources, ctx) }));
  await verifyDrafts(drafts, ctx);
  return { ...outcome, dropped: outcome.dropped + dropped, drafts };
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

    const batches = planBatches(splitByMix(ctx.params.count, ctx.params.mix));
    for (const [index, batch] of batches.entries()) {
      const outcome = await generateBatch(ctx, batch, ctx.params.types, avoid, { index, count: batches.length });
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
export async function acceptDraft(input: {
  draftId: string;
  adminId: string;
  edited?: unknown;
  /** Add it even though the bank already has a question of the same meaning. */
  allowSimilar?: boolean;
}) {
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

  await assertNoBankRepeat({ subjectId: body.subjectId, question: body, allowSimilar: input.allowSimilar });

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

/**
 * Builds a fixed-paper quiz (saved as a draft) from a batch: its waiting drafts
 * become questions, and drafts already in the bank are linked. With `addToBank`
 * the new questions also join the bank, except ones that repeat a bank question
 * in meaning; those stay on this quiz only. Without it every new question is
 * private to the quiz, like one written in the quiz builder.
 */
export async function createQuizFromDrafts(input: {
  jobId: string;
  adminId: string;
  title: string;
  durationMinutes: number;
  startsAt: Date;
  endsAt: Date;
  addToBank: boolean;
}) {
  const job = await prisma.generationJob.findUniqueOrThrow({
    where: { id: input.jobId },
    select: { subjectId: true },
  });
  const drafts = await prisma.questionDraft.findMany({
    where: { jobId: input.jobId, status: { in: ['PENDING', 'ACCEPTED'] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const linked = await prisma.question.findMany({
    // A question private to another quiz is not reused here (deleting that quiz would remove it).
    where: { id: { in: drafts.flatMap((draft) => (draft.questionId ? [draft.questionId] : [])) }, active: true, adHoc: false },
    select: { id: true, marks: true },
  });
  const linkedById = new Map(linked.map((question) => [question.id, question]));

  type Body = ReturnType<typeof createQuestionSchema.parse>;
  type Entry = { draftId: string; existing: { id: string; marks: number } } | { draftId: string; body: Body };
  const entries: Entry[] = [];
  let skipped = 0;
  let held = 0;
  for (const draft of drafts) {
    if (draft.status === 'ACCEPTED') {
      const existing = draft.questionId ? linkedById.get(draft.questionId) : undefined;
      if (existing) entries.push({ draftId: draft.id, existing });
      else skipped += 1;
      continue;
    }
    // A flagged draft goes onto a paper only after the teacher has reviewed and accepted it.
    if (isFlagged(draft.source as Parameters<typeof isFlagged>[0])) {
      held += 1;
      continue;
    }
    const parsed = createQuestionSchema.safeParse({ ...(draft.payload as object), subjectId: job.subjectId });
    const topicOk =
      parsed.success &&
      (!parsed.data.topicId ||
        (await prisma.topic.findFirst({ where: { id: parsed.data.topicId, subjectId: job.subjectId } })) !== null);
    if (!parsed.success || !topicOk) {
      skipped += 1;
      continue;
    }
    entries.push({ draftId: draft.id, body: parsed.data });
  }
  if (entries.length === 0) {
    throw new ApiError('VALIDATION', 'There are no usable questions in this batch to build a quiz from.');
  }

  const fresh = entries.filter((entry): entry is { draftId: string; body: Body } => 'body' in entry);
  const similar = input.addToBank
    ? await findSimilarInBank(job.subjectId, fresh.map((entry) => questionSignature(entry.body)))
    : fresh.map(() => null);
  const quizOnly = new Set(fresh.filter((_, i) => !input.addToBank || similar[i]).map((entry) => entry.draftId));

  const totalMarks = entries.reduce((sum, entry) => sum + ('body' in entry ? entry.body.marks : entry.existing.marks), 0);
  const quiz = await prisma.$transaction(async (tx) => {
    const created = await tx.quiz.create({
      data: {
        title: input.title,
        subjectId: job.subjectId,
        authorId: input.adminId,
        status: 'DRAFT',
        sourceMode: 'FIXED',
        durationMinutes: input.durationMinutes,
        questionCount: entries.length,
        totalMarks,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        ...quizSecuritySchema.parse({}),
      },
      select: { id: true },
    });
    for (const [position, entry] of entries.entries()) {
      let questionId: string;
      if ('existing' in entry) questionId = entry.existing.id;
      else {
        const question = await tx.question.create({
          data: {
            ...questionFieldsFromInput(entry.body),
            subjectId: job.subjectId,
            authorId: input.adminId,
            aiGenerated: true,
            adHoc: quizOnly.has(entry.draftId),
            options: { create: questionOptionsFromInput(entry.body) },
          },
          select: { id: true },
        });
        questionId = question.id;
        const claim = await tx.questionDraft.updateMany({
          where: { id: entry.draftId, status: 'PENDING' },
          data: { status: 'ACCEPTED', questionId },
        });
        if (claim.count !== 1) {
          throw new ApiError('CONFLICT', 'A draft changed while the quiz was being built. Try again.');
        }
      }
      await tx.quizQuestion.create({ data: { quizId: created.id, questionId, position } });
    }
    return created;
  });

  return {
    quizId: quiz.id,
    questions: entries.length,
    toBank: fresh.length - quizOnly.size,
    quizOnly: quizOnly.size,
    repeats: similar.filter(Boolean).length,
    skipped,
    held,
  };
}

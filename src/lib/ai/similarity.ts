import 'server-only';

import { createHash } from 'node:crypto';

import { type AiProvider, aiEnabled, getProvider } from '@/lib/ai/provider';
import { ApiError } from '@/lib/api';
import {
  type AcceptedDraft,
  SEMANTIC_DUPLICATE,
  cosine,
  questionSignature,
  sameNumbers,
} from '@/lib/ai/question-generation';
import { prisma } from '@/lib/db';

/** How many bank questions and waiting drafts a new question is compared with. */
const BANK_LIMIT = 500;
const PENDING_LIMIT = 100;

/** The model is part of the key, so vectors from another embedding model are never compared. */
const keyOf = (model: string, signature: string) => createHash('sha1').update(`${model}\n${signature}`).digest('hex');

interface Known {
  id?: string;
  /** What to show a teacher when a new question matches this one. */
  label: string;
  /** The question's text, to tell a rewording from the same template with other numbers. */
  signature: string;
  vector: number[];
}

/**
 * The subject's bank as vectors. Each question is embedded once and cached
 * (re-embedded when its text changes); `extra` texts are embedded alongside.
 */
async function loadBank(
  provider: AiProvider,
  subjectId: string,
  extra: string[] = [],
  excludeId?: string,
  limit = BANK_LIMIT,
) {
  const bank = await prisma.question.findMany({
    // Questions private to one quiz are not the bank.
    where: { subjectId, active: true, adHoc: false, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, text: true, assertionText: true, reasonText: true, embedding: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  const rows = bank.map((question) => {
    const signature = questionSignature(question);
    return { id: question.id, label: question.text, signature, key: keyOf(provider.embedModel, signature), cached: question.embedding };
  });
  const stale = rows.filter((row) => !row.cached || row.cached.key !== row.key);

  const fresh = await provider.embed([...stale.map((row) => row.signature), ...extra]);
  stale.forEach((row, i) => {
    row.cached = { questionId: row.id, key: row.key, vector: fresh[i]! };
  });
  await Promise.all(
    stale.map((row) =>
      prisma.questionEmbedding.upsert({
        where: { questionId: row.id },
        create: { questionId: row.id, key: row.key, vector: row.cached!.vector },
        update: { key: row.key, vector: row.cached!.vector },
      }),
    ),
  );
  return {
    bank: rows.map((row): Known => ({ id: row.id, label: row.label, signature: row.signature, vector: row.cached!.vector })),
    extra: fresh.slice(stale.length),
  };
}

const nearest = (vector: number[], signature: string, known: Known[]) =>
  known.find((entry) => cosine(entry.vector, vector) >= SEMANTIC_DUPLICATE && sameNumbers(entry.signature, signature));

/**
 * For each text, the bank question it repeats in meaning, or null. Fails open
 * (all null) if embedding is unavailable, so accepting never gets stuck on it.
 */
export async function findSimilarInBank(
  subjectId: string,
  signatures: string[],
  excludeId?: string,
): Promise<Array<string | null>> {
  if (signatures.length === 0) return [];
  try {
    const provider = await getProvider();
    const { bank, extra } = await loadBank(provider, subjectId, signatures, excludeId);
    return extra.map((vector, i) => nearest(vector, signatures[i]!, bank)?.label ?? null);
  } catch (error) {
    console.warn('[ai] meaning check unavailable', error);
    return signatures.map(() => null);
  }
}

/** Most questions one duplicate scan compares (pairs grow with the square of this). */
export const SCAN_LIMIT = 1000;

/**
 * Groups of bank questions that mean the same, as ids. Questions are linked
 * when similar enough, and a chain A~B~C is one group.
 */
export async function findDuplicateGroups(subjectId: string, limit = SCAN_LIMIT): Promise<string[][]> {
  const { bank } = await loadBank(await getProvider(), subjectId, [], undefined, limit);
  const parent = bank.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < bank.length; i += 1) {
    for (let j = i + 1; j < bank.length; j += 1) {
      if (cosine(bank[i]!.vector, bank[j]!.vector) >= SEMANTIC_DUPLICATE && sameNumbers(bank[i]!.signature, bank[j]!.signature)) {
        parent[root(j)] = root(i);
      }
    }
  }
  const groups = new Map<number, string[]>();
  bank.forEach((entry, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), entry.id!]));
  return [...groups.values()].filter((ids) => ids.length > 1).sort((a, b) => b.length - a.length);
}

/**
 * After an import: which freshly imported rows repeat something in the bank or
 * an earlier row, in words a teacher can act on. Null when the check could not
 * run (no AI key, or Google unavailable), so the import itself is never held up.
 */
export async function describeImportRepeats(
  subjectId: string,
  imported: Array<{ id: string; row: number }>,
): Promise<Array<{ row: number; message: string }> | null> {
  if (imported.length === 0 || !aiEnabled()) return null;
  try {
    const groups = await findDuplicateGroups(subjectId);
    const rowOf = new Map(imported.map((entry) => [entry.id, entry.row]));
    const relevant = groups.filter((group) => group.some((id) => rowOf.has(id)));
    const texts = new Map(
      (await prisma.question.findMany({ where: { id: { in: relevant.flat() } }, select: { id: true, text: true } })).map(
        (question) => [question.id, question.text] as const,
      ),
    );
    const quote = (id: string) => `“${(texts.get(id) ?? '').slice(0, 100)}”`;
    const found: Array<{ row: number; message: string }> = [];
    for (const group of relevant) {
      for (const id of group) {
        const row = rowOf.get(id);
        if (row === undefined) continue;
        const others = group.filter((other) => other !== id);
        const inBank = others.find((other) => !rowOf.has(other));
        const earlier = others.find((other) => (rowOf.get(other) ?? Infinity) < row);
        if (inBank) found.push({ row, message: `Means the same as ${quote(inBank)}, already in the bank.` });
        else if (earlier) found.push({ row, message: `Means the same as row ${rowOf.get(earlier)} of this file.` });
      }
    }
    return found.sort((a, b) => a.row - b.row).slice(0, 50);
  } catch (error) {
    console.warn('[ai] could not check the import for repeats', error);
    return null;
  }
}

/**
 * Refuses (409, naming the question) when the bank already holds one of the
 * same meaning, unless the teacher chose to add it anyway.
 */
export async function assertNoBankRepeat(input: {
  subjectId: string;
  question: { text: string; assertionText?: string | null; reasonText?: string | null };
  allowSimilar?: boolean;
  /** The question being edited, which must not count as a repeat of itself. */
  excludeId?: string;
}) {
  if (input.allowSimilar) return;
  const [similar] = await findSimilarInBank(input.subjectId, [questionSignature(input.question)], input.excludeId);
  if (similar) {
    throw new ApiError('CONFLICT', `The bank already has a question that means the same: “${similar.slice(0, 140)}”.`, {
      similar: [similar],
    });
  }
}

export interface SemanticGuard {
  /** Drops drafts that mean the same as something already known, and remembers the rest. */
  filter(drafts: AcceptedDraft[]): Promise<{ kept: AcceptedDraft[]; dropped: number }>;
}

/**
 * Compares by meaning, not wording, against the subject's bank and the drafts
 * still waiting for review. If embedding fails the word-overlap check in
 * validateModelOutput still applies, so generation carries on.
 */
export async function createSemanticGuard(subjectId: string): Promise<SemanticGuard> {
  const known: Known[] = [];
  try {
    const provider = await getProvider();
    const pending = await prisma.questionDraft.findMany({
      where: { status: 'PENDING', job: { subjectId } },
      select: { payload: true },
      orderBy: { createdAt: 'desc' },
      take: PENDING_LIMIT,
    });
    const texts = pending.map((draft) =>
      questionSignature(draft.payload as { text: string; assertionText?: string; reasonText?: string }),
    );
    const loaded = await loadBank(provider, subjectId, texts);
    known.push(...loaded.bank, ...loaded.extra.map((vector, i) => ({ label: texts[i]!, signature: texts[i]!, vector })));
  } catch (error) {
    console.warn('[ai] meaning check unavailable, using word overlap only', error);
  }

  return {
    async filter(drafts) {
      if (drafts.length === 0 || known.length === 0) return { kept: drafts, dropped: 0 };
      let embedded: number[][];
      try {
        embedded = await (await getProvider()).embed(drafts.map((draft) => questionSignature(draft.body)));
      } catch (error) {
        console.warn('[ai] meaning check unavailable for this batch', error);
        return { kept: drafts, dropped: 0 };
      }
      const kept: AcceptedDraft[] = [];
      drafts.forEach((draft, i) => {
        const signature = questionSignature(draft.body);
        if (nearest(embedded[i]!, signature, known)) return;
        known.push({ label: draft.body.text, signature, vector: embedded[i]! });
        kept.push(draft);
      });
      return { kept, dropped: drafts.length - kept.length };
    },
  };
}

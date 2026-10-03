import 'server-only';

import { createHash } from 'node:crypto';

import { type AiProvider, getProvider } from '@/lib/ai/provider';
import {
  type AcceptedDraft,
  SEMANTIC_DUPLICATE,
  cosine,
  questionSignature,
} from '@/lib/ai/question-generation';
import { prisma } from '@/lib/db';

/** How many bank questions and waiting drafts a new question is compared with. */
const BANK_LIMIT = 500;
const PENDING_LIMIT = 100;

const keyOf = (signature: string) => createHash('sha1').update(signature).digest('hex');

interface Known {
  /** What to show a teacher when a new question matches this one. */
  label: string;
  vector: number[];
}

/**
 * The subject's bank as vectors. Each question is embedded once and cached
 * (re-embedded when its text changes); `extra` texts are embedded alongside.
 */
async function loadBank(provider: AiProvider, subjectId: string, extra: string[] = []) {
  const bank = await prisma.question.findMany({
    where: { subjectId, active: true },
    select: { id: true, text: true, assertionText: true, reasonText: true, embedding: true },
    orderBy: { createdAt: 'desc' },
    take: BANK_LIMIT,
  });
  const rows = bank.map((question) => {
    const signature = questionSignature(question);
    return { id: question.id, label: question.text, signature, key: keyOf(signature), cached: question.embedding };
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
    bank: rows.map((row): Known => ({ label: row.label, vector: row.cached!.vector })),
    extra: fresh.slice(stale.length),
  };
}

const nearest = (vector: number[], known: Known[]) =>
  known.find((entry) => cosine(entry.vector, vector) >= SEMANTIC_DUPLICATE);

/**
 * For each text, the bank question it repeats in meaning, or null. Fails open
 * (all null) if embedding is unavailable, so accepting never gets stuck on it.
 */
export async function findSimilarInBank(subjectId: string, signatures: string[]): Promise<Array<string | null>> {
  if (signatures.length === 0) return [];
  try {
    const provider = await getProvider();
    const { bank, extra } = await loadBank(provider, subjectId, signatures);
    return extra.map((vector) => nearest(vector, bank)?.label ?? null);
  } catch (error) {
    console.warn('[ai] meaning check unavailable', error);
    return signatures.map(() => null);
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
    known.push(...loaded.bank, ...loaded.extra.map((vector, i) => ({ label: texts[i]!, vector })));
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
        if (nearest(embedded[i]!, known)) return;
        known.push({ label: draft.body.text, vector: embedded[i]! });
        kept.push(draft);
      });
      return { kept, dropped: drafts.length - kept.length };
    },
  };
}

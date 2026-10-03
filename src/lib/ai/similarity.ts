import 'server-only';

import { createHash } from 'node:crypto';

import { getProvider } from '@/lib/ai/provider';
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

export interface SemanticGuard {
  /** Drops drafts that mean the same as something already known, and remembers the rest. */
  filter(drafts: AcceptedDraft[]): Promise<{ kept: AcceptedDraft[]; dropped: number }>;
}

/**
 * Compares by meaning, not wording. Knows the subject's bank (embedded once and
 * cached, re-embedded when a question's text changes) and the drafts still
 * waiting for review. If embedding fails the word-overlap check in
 * validateModelOutput still applies, so generation carries on.
 */
export async function createSemanticGuard(subjectId: string): Promise<SemanticGuard> {
  const vectors: number[][] = [];
  try {
    const provider = await getProvider();
    const [bank, pending] = await Promise.all([
      prisma.question.findMany({
        where: { subjectId, active: true },
        select: { id: true, text: true, assertionText: true, reasonText: true, embedding: true },
        orderBy: { createdAt: 'desc' },
        take: BANK_LIMIT,
      }),
      prisma.questionDraft.findMany({
        where: { status: 'PENDING', job: { subjectId } },
        select: { payload: true },
        orderBy: { createdAt: 'desc' },
        take: PENDING_LIMIT,
      }),
    ]);

    const rows = bank.map((question) => {
      const signature = questionSignature(question);
      return { id: question.id, signature, key: keyOf(signature), cached: question.embedding };
    });
    const stale = rows.filter((row) => !row.cached || row.cached.key !== row.key);
    const pendingTexts = pending.map((draft) =>
      questionSignature(draft.payload as { text: string; assertionText?: string; reasonText?: string }),
    );

    const fresh = await provider.embed([...stale.map((row) => row.signature), ...pendingTexts]);
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
    vectors.push(...rows.map((row) => row.cached!.vector), ...fresh.slice(stale.length));
  } catch (error) {
    console.warn('[ai] meaning check unavailable, using word overlap only', error);
  }

  return {
    async filter(drafts) {
      if (drafts.length === 0 || vectors.length === 0) return { kept: drafts, dropped: 0 };
      let embedded: number[][];
      try {
        embedded = await (await getProvider()).embed(drafts.map((draft) => questionSignature(draft.body)));
      } catch (error) {
        console.warn('[ai] meaning check unavailable for this batch', error);
        return { kept: drafts, dropped: 0 };
      }
      const kept: AcceptedDraft[] = [];
      drafts.forEach((draft, i) => {
        const vector = embedded[i]!;
        if (vectors.some((known) => cosine(known, vector) >= SEMANTIC_DUPLICATE)) return;
        vectors.push(vector);
        kept.push(draft);
      });
      return { kept, dropped: drafts.length - kept.length };
    },
  };
}

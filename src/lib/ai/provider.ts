import 'server-only';

import type { AiQuestionType, DifficultyCounts } from '@/lib/ai/question-generation';
import type { CheckAnswer, CheckItem } from '@/lib/ai/verification';

/**
 * The one seam between SecureQuiz and a language model. Everything else in
 * the feature talks to this interface, so the Gemini implementation can be
 * swapped (a local model later) and e2e tests run against `fake` without
 * calling Google.
 */
export interface AiProvider {
  name: 'gemini' | 'fake';
  /** The subject's File Search store, created if it does not exist yet. */
  createStore(displayName: string): Promise<string>;
  /** Indexes one file into a store; resolves once it is searchable. */
  indexDocument(input: {
    store: string;
    bytes: Uint8Array;
    mimeType: string;
    displayName: string;
    materialId: string;
  }): Promise<string>;
  deleteDocument(documentName: string): Promise<void>;
  /** OCR: page-marked Markdown for a PDF of scanned pages, or an image. */
  transcribe(input: { bytes: Uint8Array; mimeType: string; pages: number[] }): Promise<string>;
  /** Meaning-vectors for short texts, one per input, in order. */
  embed(texts: string[]): Promise<number[][]>;
  /** A second, independent reading: answers each item from its own passage. */
  check(items: CheckItem[]): Promise<CheckAnswer[]>;
  /** One structured generation call; `json` is untrusted and validated by the caller. */
  generate(input: {
    prompt: string;
    schema: object;
    /** Retrieve from these materials in this store (topic / whole focus). */
    retrieval?: { store: string; materialIds: string[] };
    /** Or read this document directly (page focus). */
    inline?: { bytes: Uint8Array; mimeType: string };
    /** What was asked, so the fake provider can answer in kind. */
    request: { batch: DifficultyCounts; types: AiQuestionType[] };
  }): Promise<{ json: unknown; sources: RetrievedSource[] }>;
}

export interface RetrievedSource {
  materialId?: string;
  page?: number;
  text?: string;
}

/** A failure worth showing to the teacher as it is. */
export class AiError extends Error {}

export function aiProviderName(): 'gemini' | 'fake' | null {
  if (process.env.AI_PROVIDER === 'fake') return 'fake';
  return process.env.GEMINI_API_KEY ? 'gemini' : null;
}

/** Whether the feature is switched on at all (a key is set, or tests run on `fake`). */
export function aiEnabled(): boolean {
  return aiProviderName() !== null;
}

export async function getProvider(): Promise<AiProvider> {
  const name = aiProviderName();
  if (name === 'fake') return (await import('@/lib/ai/fake-provider')).fakeProvider;
  if (name === 'gemini') return (await import('@/lib/ai/gemini')).geminiProvider;
  throw new AiError('AI question generation is not set up. Add GEMINI_API_KEY to the server environment.');
}

import 'server-only';

import { AiError, type AiProvider } from '@/lib/ai/provider';
import { CHECK_SCHEMA, type CheckAnswer, buildCheckPrompt } from '@/lib/ai/verification';

/**
 * A model running on the college's own machine through Ollama. Nothing leaves
 * the building and there is no quota. It cannot search a store or read a PDF
 * itself, so the job hands it the relevant text directly (see `jobs.ts`).
 */

const host = () => (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');
const model = () => process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const embedModel = () => process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const visionModel = () => process.env.OLLAMA_VISION_MODEL || '';

/** A small local model can take minutes for ten questions; give it room. */
const REQUEST_TIMEOUT_MS = 10 * 60_000;

/** Tokens of context to ask for: the text plus room for the questions. Ollama's default is far too small. */
function contextFor(characters: number) {
  const requested = Number(process.env.OLLAMA_NUM_CTX);
  if (Number.isFinite(requested) && requested > 0) return requested;
  return Math.min(32768, Math.max(8192, Math.ceil(characters / 3) + 3000));
}

interface OllamaReply {
  message?: { content?: string };
  embeddings?: number[][];
}

async function call(path: string, body: unknown): Promise<OllamaReply> {
  let response: Response;
  try {
    response = await fetch(`${host()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new AiError('The local AI model took too long to answer. Try fewer questions, or a smaller model.');
    }
    throw new AiError(`Could not reach Ollama at ${host()}. Is it running? (${error instanceof Error ? error.message : 'no reply'})`);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      detail = String((JSON.parse(text) as { error?: unknown }).error ?? text);
    } catch {
      // not JSON: show it as it is
    }
    const missing = /model ['"]?([^'"\s]+)['"]? not found/i.exec(detail)?.[1];
    if (response.status === 404 && missing) {
      throw new AiError(`Ollama does not have the model "${missing}". Install it with: ollama pull ${missing}`);
    }
    throw new AiError(`Ollama said: ${detail.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as OllamaReply;
  } catch {
    throw new AiError('Ollama sent a reply that could not be read.');
  }
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

export const ollamaProvider: AiProvider = {
  name: 'ollama',
  searchesStore: false,
  readsPdf: false,
  // A small model reads a few pages at a time, not a whole chapter.
  maxContextChars: 24_000,
  get embedModel() {
    return `ollama:${embedModel()}`;
  },

  // No managed store: the text of each material is kept by us and handed over per job.
  async createStore(displayName) {
    return `local/${displayName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  },
  async indexDocument({ store, materialId }) {
    return `${store}/documents/${materialId}`;
  },
  async deleteDocument() {},

  async transcribe({ bytes, mimeType, pages }) {
    if (!visionModel()) {
      throw new AiError(
        'Reading scanned pages needs a vision model. Set OLLAMA_VISION_MODEL (for example llama3.2-vision), or upload a text version of the file.',
      );
    }
    if (mimeType === 'application/pdf') {
      throw new AiError('This setup can read photos (JPG or PNG) of notes, but not scanned PDF pages. Upload the pages as images.');
    }
    const prompt = [
      'Transcribe this scanned study material exactly, as Markdown.',
      `It is page ${pages[0] ?? 1}. Start with a line "--- Page ${pages[0] ?? 1} ---".`,
      'Keep headings, lists and tables. Write mathematics as LaTeX between $...$.',
      'For a diagram write [figure: one-line description]. Do not summarise or add anything.',
    ].join('\n');
    const reply = await call('/api/chat', {
      model: visionModel(),
      stream: false,
      options: { temperature: 0 },
      messages: [{ role: 'user', content: prompt, images: [base64(bytes)] }],
    });
    return String(reply?.message?.content ?? '');
  },

  async embed(texts) {
    const reply = await call('/api/embed', { model: embedModel(), input: texts });
    const vectors = reply?.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
      throw new AiError('Ollama returned the wrong number of embeddings.');
    }
    return vectors as number[][];
  },

  async check(items) {
    const prompt = buildCheckPrompt(items);
    try {
      const reply = await call('/api/chat', {
        model: model(),
        stream: false,
        format: CHECK_SCHEMA,
        options: { temperature: 0, num_ctx: contextFor(prompt.length) },
        messages: [{ role: 'user', content: prompt }],
      });
      const parsed = JSON.parse(String(reply?.message?.content ?? '{}')) as { answers?: CheckAnswer[] };
      return Array.isArray(parsed.answers) ? parsed.answers : [];
    } catch (error) {
      if (error instanceof SyntaxError) return []; // an unreadable reply is "no second opinion"
      throw error;
    }
  },

  async generate({ prompt, schema, text }) {
    if (!text) throw new AiError('There was no study material text to write questions from.');
    const content = `Study material:\n${text}\n\n${prompt}`;
    const reply = await call('/api/chat', {
      model: model(),
      stream: false,
      format: schema,
      options: { temperature: 0.7, num_ctx: contextFor(content.length) },
      messages: [{ role: 'user', content }],
    });
    let json: unknown = null;
    try {
      json = JSON.parse(String(reply?.message?.content ?? ''));
    } catch {
      json = null; // validated (and counted as dropped) by the caller
    }
    return { json, sources: [] };
  },
};

import 'server-only';

import { GoogleGenAI } from '@google/genai';

import { AiError, type AiProvider, type RetrievedSource } from '@/lib/ai/provider';

/** A Flash model on the free tier. Override with GEMINI_MODEL if Google renames it. */
const DEFAULT_MODEL = 'gemini-flash-latest';
/** How long indexing may take before we give up on it. */
const INDEX_TIMEOUT_MS = 10 * 60_000;

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

/** Used when the main model stays overloaded: lighter, also on the free tier. */
const DEFAULT_FALLBACK_MODEL = 'gemini-flash-lite-latest';

const embedModel = () => process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
const model = () => process.env.GEMINI_MODEL || DEFAULT_MODEL;
const models = () => [
  ...new Set([model(), process.env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL]),
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Google's free tier often answers "overloaded" (503) or "slow down" (429) for
 * a moment. Those are retried a few times with a growing pause; anything else
 * fails at once.
 */
const isTransient = (error: unknown) =>
  [429, 500, 503, 504].includes((error as { status?: number })?.status ?? 0);

async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  const pauses = [2000, 5000, 12000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (!isTransient(error) || attempt >= pauses.length) throw error;
      await sleep(pauses[attempt]!);
    }
  }
}

/** Retries on the main model, then once more on the fallback if it is still overloaded. */
async function onAnyModel<T>(call: (model: string) => Promise<T>): Promise<T> {
  const list = models();
  for (let i = 0; ; i += 1) {
    try {
      return await withRetry(() => call(list[i]!));
    } catch (error) {
      if (!isTransient(error) || i + 1 >= list.length) throw error;
      console.warn(`[ai] ${list[i]} overloaded, falling back to ${list[i + 1]}`);
    }
  }
}

/** Turns Google's errors into something a teacher can act on. */
function explain(error: unknown): never {
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : String(error);
  // The teacher gets the plain sentence; the server log keeps Google's own words.
  console.error('[ai] gemini error', status, message.slice(0, 500));
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(message)) {
    throw new AiError("Google's free AI quota is used up for now. Try again in a few minutes.");
  }
  if (status === 401 || status === 403 || /API key/i.test(message)) {
    throw new AiError('Google refused the Gemini API key. Check GEMINI_API_KEY on the server.');
  }
  if (status === 404 && /model/i.test(message)) {
    throw new AiError(
      `The model "${model()}" is not available. Set GEMINI_MODEL to a current Flash model.`,
    );
  }
  if (status !== undefined && status >= 500) {
    throw new AiError('Google AI is having trouble right now. Try again shortly.');
  }
  throw new AiError(`The AI request failed: ${message.slice(0, 200)}`);
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

export const geminiProvider: AiProvider = {
  name: 'gemini',

  async createStore(displayName) {
    try {
      const store = await ai().fileSearchStores.create({ config: { displayName } });
      if (!store.name) throw new AiError('Google did not return a store name.');
      return store.name;
    } catch (error) {
      if (error instanceof AiError) throw error;
      explain(error);
    }
  },

  async indexDocument({ store, bytes, mimeType, displayName, materialId }) {
    try {
      let operation = await ai().fileSearchStores.uploadToFileSearchStore({
        file: new Blob([Buffer.from(bytes)], { type: mimeType }),
        fileSearchStoreName: store,
        config: {
          mimeType,
          displayName,
          customMetadata: [{ key: 'material_id', stringValue: materialId }],
        },
      });
      const started = Date.now();
      while (!operation.done) {
        if (Date.now() - started > INDEX_TIMEOUT_MS) {
          throw new AiError('Indexing took too long. Try uploading the file again.');
        }
        await sleep(3000);
        operation = (await ai().operations.get({ operation })) as typeof operation;
      }
      if (operation.error) {
        throw new AiError(
          `Google could not index this file: ${JSON.stringify(operation.error).slice(0, 200)}`,
        );
      }
      const name = operation.response?.documentName;
      if (!name) throw new AiError('Google did not return a document name.');
      return name;
    } catch (error) {
      if (error instanceof AiError) throw error;
      explain(error);
    }
  },

  async deleteDocument(documentName) {
    try {
      await ai().fileSearchStores.documents.delete({ name: documentName, config: { force: true } });
    } catch (error) {
      // Already gone is fine; anything else is reported.
      if ((error as { status?: number })?.status === 404) return;
      explain(error);
    }
  },

  async transcribe({ bytes, mimeType, pages }) {
    const prompt = [
      'Transcribe this scanned study material exactly, as Markdown.',
      `It contains page(s) ${pages.join(', ')}. Start each page with a line "--- Page N ---" using those page numbers, in order.`,
      'Keep headings, lists and tables. Write mathematics as LaTeX between $...$.',
      'For a diagram or figure write [figure: one-line description]. Do not summarise, translate or add anything.',
    ].join('\n');
    try {
      const response = await onAnyModel((name) =>
        ai().models.generateContent({
          model: name,
          contents: [
            {
              role: 'user',
              parts: [{ inlineData: { data: base64(bytes), mimeType } }, { text: prompt }],
            },
          ],
          config: { temperature: 0 },
        }),
      );
      return response.text ?? '';
    } catch (error) {
      explain(error);
    }
  },

  async embed(texts) {
    try {
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += 100) {
        const response = await withRetry(() =>
          ai().models.embedContent({
            model: embedModel(),
            contents: texts.slice(i, i + 100),
            config: { taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: 768 },
          }),
        );
        for (const entry of response.embeddings ?? []) vectors.push(entry.values ?? []);
      }
      if (vectors.length !== texts.length) throw new AiError('Google returned too few embeddings.');
      return vectors;
    } catch (error) {
      if (error instanceof AiError) throw error;
      explain(error);
    }
  },

  async generate({ prompt, schema, retrieval, inline }) {
    try {
      // With JSON output switched on, Gemini skips the file search and writes from
      // the subject name alone. So the passages are fetched first, as plain text.
      let passages: string | undefined;
      let sources: RetrievedSource[] = [];
      if (retrieval) {
        const found = await onAnyModel((name) =>
          ai().models.generateContent({
            model: name,
            contents: [
              'Search the study material and copy out, word for word, the passages needed for the task below.',
              'Put "--- Page N ---" before each passage when the page is known. Do not write the questions yourself.',
              'Use only what the material says, even if it does not match the subject name.',
              '',
              'Task:',
              prompt,
            ].join('\n'),
            config: {
              temperature: 0,
              tools: [
                {
                  fileSearch: {
                    fileSearchStoreNames: [retrieval.store],
                    metadataFilter: retrieval.materialIds
                      .map((id) => `material_id="${id}"`)
                      .join(' OR '),
                  },
                },
              ],
            },
          }),
        );
        passages = found.text?.trim();
        if (!passages) throw new AiError('Nothing relevant was found in the chosen material.');
        sources = (found.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).flatMap(
          (chunk) => {
            const context = chunk.retrievedContext;
            if (!context) return [];
            const materialId = context.customMetadata?.find(
              (entry) => entry.key === 'material_id',
            )?.stringValue;
            return [{ materialId, page: context.pageNumber, text: context.text }];
          },
        );
        // The passages themselves, so a quote can be traced even without grounding data.
        sources.push({ text: passages });
      }

      const response = await onAnyModel((name) =>
        ai().models.generateContent({
          model: name,
          contents: [
            {
              role: 'user',
              parts: [
                ...(inline
                  ? [{ inlineData: { data: base64(inline.bytes), mimeType: inline.mimeType } }]
                  : []),
                ...(passages ? [{ text: `Study material:\n${passages}` }] : []),
                { text: prompt },
              ],
            },
          ],
          config: {
            temperature: 0.7,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
          },
        }),
      );

      let json: unknown = null;
      try {
        json = JSON.parse(response.text ?? '');
      } catch {
        json = null; // validated (and counted as dropped) by the caller
      }
      return { json, sources };
    } catch (error) {
      explain(error);
    }
  },
};

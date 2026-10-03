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

const model = () => process.env.GEMINI_MODEL || DEFAULT_MODEL;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Turns Google's errors into something a teacher can act on. */
function explain(error: unknown): never {
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(message)) {
    throw new AiError("Google's free AI quota is used up for now. Try again in a few minutes.");
  }
  if (status === 401 || status === 403 || /API key/i.test(message)) {
    throw new AiError('Google refused the Gemini API key. Check GEMINI_API_KEY on the server.');
  }
  if (status === 404 && /model/i.test(message)) {
    throw new AiError(`The model "${model()}" is not available. Set GEMINI_MODEL to a current Flash model.`);
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
        throw new AiError(`Google could not index this file: ${JSON.stringify(operation.error).slice(0, 200)}`);
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
      const response = await ai().models.generateContent({
        model: model(),
        contents: [
          { role: 'user', parts: [{ inlineData: { data: base64(bytes), mimeType } }, { text: prompt }] },
        ],
        config: { temperature: 0 },
      });
      return response.text ?? '';
    } catch (error) {
      explain(error);
    }
  },

  async generate({ prompt, schema, retrieval, inline }) {
    try {
      const response = await ai().models.generateContent({
        model: model(),
        contents: [
          {
            role: 'user',
            parts: [
              ...(inline ? [{ inlineData: { data: base64(inline.bytes), mimeType: inline.mimeType } }] : []),
              { text: prompt },
            ],
          },
        ],
        config: {
          temperature: 0.7,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          ...(retrieval
            ? {
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
              }
            : {}),
        },
      });

      const sources: RetrievedSource[] = (
        response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
      ).flatMap((chunk) => {
        const context = chunk.retrievedContext;
        if (!context) return [];
        const materialId = context.customMetadata?.find((entry) => entry.key === 'material_id')
          ?.stringValue;
        return [{ materialId, page: context.pageNumber, text: context.text }];
      });

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

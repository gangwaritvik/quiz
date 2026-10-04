import assert from 'node:assert/strict';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { ollamaProvider } from '@/lib/ai/ollama';
import { AiError, aiEnabled, aiProviderName } from '@/lib/ai/provider';

interface Body {
  model?: string;
  stream?: boolean;
  format?: unknown;
  input?: string[];
  options?: { num_ctx?: number };
  messages?: Array<{ content: string; images?: string[] }>;
}

interface Seen {
  path: string;
  body: Body;
}

let server: Server;
let seen: Seen[] = [];
/** What the fake Ollama answers, per path; a function can inspect the request. */
let replies: Record<string, (body: Body) => { status?: number; json: unknown }> = {};

before(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ path: request.url ?? '', body });
      const handler = replies[request.url ?? ''];
      const { status = 200, json } = handler ? handler(body) : { status: 404, json: { error: 'no route' } };
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(typeof json === 'string' ? json : JSON.stringify(json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.OLLAMA_HOST = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.OLLAMA_MODEL = 'test-model';
  process.env.OLLAMA_EMBED_MODEL = 'test-embed';
  delete process.env.OLLAMA_VISION_MODEL;
  delete process.env.OLLAMA_NUM_CTX;
});

after(() => {
  server.close();
});

const reset = () => {
  seen = [];
  replies = {};
};

describe('ollama provider', () => {
  test('is chosen by AI_PROVIDER and needs no key', () => {
    const before = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = 'ollama';
    delete process.env.GEMINI_API_KEY;
    assert.equal(aiProviderName(), 'ollama');
    assert.equal(aiEnabled(), true);
    process.env.AI_PROVIDER = before;
    if (before === undefined) delete process.env.AI_PROVIDER;
  });

  test('says what it cannot do, so jobs hand it the text', () => {
    assert.equal(ollamaProvider.searchesStore, false);
    assert.equal(ollamaProvider.readsPdf, false);
    assert.ok(ollamaProvider.maxContextChars < 100_000);
    assert.equal(ollamaProvider.embedModel, 'ollama:test-embed');
  });

  test('generate sends the material and prompt with the schema, and a context big enough for them', async () => {
    reset();
    replies['/api/chat'] = () => ({ json: { message: { content: JSON.stringify({ questions: [{ text: 'q' }] }) } } });
    const schema = { type: 'object', properties: { questions: { type: 'array' } } };
    const text = 'x'.repeat(30_000);
    const out = await ollamaProvider.generate({ prompt: 'Write 1 question.', schema, text, request: { batch: { EASY: 1, MEDIUM: 0, HARD: 0 }, types: ['MCQ_SINGLE'] } });
    assert.deepEqual(out.json, { questions: [{ text: 'q' }] });
    assert.deepEqual(out.sources, []);
    const sent = seen[0]!.body;
    assert.equal(sent.model, 'test-model');
    assert.equal(sent.stream, false);
    assert.deepEqual(sent.format, schema);
    assert.match(sent.messages![0]!.content, /Study material:\nx{100}/);
    assert.match(sent.messages![0]!.content, /Write 1 question\.$/);
    assert.ok((sent.options?.num_ctx ?? 0) >= 10_000, `num_ctx ${sent.options?.num_ctx}`);
  });

  test('an unreadable reply is "no questions", not a crash', async () => {
    reset();
    replies['/api/chat'] = () => ({ json: { message: { content: 'not json at all' } } });
    const out = await ollamaProvider.generate({ prompt: 'p', schema: {}, text: 't', request: { batch: { EASY: 1, MEDIUM: 0, HARD: 0 }, types: ['MCQ_SINGLE'] } });
    assert.equal(out.json, null);
  });

  test('generate without any text is refused, since it cannot search for itself', async () => {
    await assert.rejects(
      ollamaProvider.generate({ prompt: 'p', schema: {}, request: { batch: { EASY: 1, MEDIUM: 0, HARD: 0 }, types: ['MCQ_SINGLE'] } }),
      AiError,
    );
  });

  test('embed returns one vector per text, and complains if the count is off', async () => {
    reset();
    replies['/api/embed'] = (body) => ({ json: { embeddings: (body.input ?? []).map((_, i) => [i, 1]) } });
    assert.deepEqual(await ollamaProvider.embed(['a', 'b']), [[0, 1], [1, 1]]);
    assert.equal(seen[0]!.body.model, 'test-embed');
    replies['/api/embed'] = () => ({ json: { embeddings: [[1]] } });
    await assert.rejects(ollamaProvider.embed(['a', 'b']), AiError);
  });

  test('a missing model says how to install it', async () => {
    reset();
    replies['/api/chat'] = () => ({ status: 404, json: { error: 'model "test-model" not found, try pulling it first' } });
    await assert.rejects(
      ollamaProvider.generate({ prompt: 'p', schema: {}, text: 't', request: { batch: { EASY: 1, MEDIUM: 0, HARD: 0 }, types: ['MCQ_SINGLE'] } }),
      (error: Error) => error instanceof AiError && /ollama pull test-model/.test(error.message),
    );
  });

  test('check returns the second reading, and an unreadable one as none', async () => {
    reset();
    replies['/api/chat'] = () => ({ json: { message: { content: JSON.stringify({ answers: [{ id: 0, canAnswer: true, choice: [2] }] }) } } });
    const item = { id: 0, passage: 'p', question: 'q', kind: 'choice' as const, options: ['a', 'b'] };
    assert.deepEqual(await ollamaProvider.check([item]), [{ id: 0, canAnswer: true, choice: [2] }]);
    replies['/api/chat'] = () => ({ json: { message: { content: '???' } } });
    assert.deepEqual(await ollamaProvider.check([item]), []);
  });

  test('scanned pages need a vision model, and photos only', async () => {
    reset();
    await assert.rejects(ollamaProvider.transcribe({ bytes: new Uint8Array([1]), mimeType: 'image/png', pages: [1] }), /OLLAMA_VISION_MODEL/);
    process.env.OLLAMA_VISION_MODEL = 'test-vision';
    try {
      await assert.rejects(ollamaProvider.transcribe({ bytes: new Uint8Array([1]), mimeType: 'application/pdf', pages: [1] }), /not scanned PDF/);
      replies['/api/chat'] = () => ({ json: { message: { content: '--- Page 1 ---\nHello' } } });
      const text = await ollamaProvider.transcribe({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', pages: [1] });
      assert.equal(text, '--- Page 1 ---\nHello');
      assert.equal(seen[0]!.body.model, 'test-vision');
      assert.deepEqual(seen[0]!.body.messages![0]!.images, [Buffer.from([1, 2, 3]).toString('base64')]);
    } finally {
      delete process.env.OLLAMA_VISION_MODEL;
    }
  });

  test('an Ollama that is not running gives a plain message', async () => {
    const saved = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = 'http://127.0.0.1:1';
    try {
      await assert.rejects(ollamaProvider.embed(['a']), (error: Error) => error instanceof AiError && /Is it running/.test(error.message));
    } finally {
      process.env.OLLAMA_HOST = saved;
    }
  });
});

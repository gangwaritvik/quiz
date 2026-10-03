import 'server-only';

import { randomBytes } from 'node:crypto';

import type { AiProvider } from '@/lib/ai/provider';
import { DIFFICULTIES } from '@/lib/ai/question-generation';

/**
 * A stand-in for Gemini used by e2e tests (AI_PROVIDER=fake). Answers instantly
 * and deterministically in shape: exactly the questions asked for, plus one
 * broken question per call so the dropping path is exercised too.
 */
const word = () => randomBytes(3).toString('hex');

export const fakeProvider: AiProvider = {
  name: 'fake',

  async createStore(displayName) {
    return `fileSearchStores/fake-${displayName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  },

  async indexDocument({ store, materialId }) {
    return `${store}/documents/fake-${materialId}`;
  },

  async deleteDocument() {},

  async transcribe({ pages }) {
    return pages
      .map((page) => `--- Page ${page} ---\nFake OCR text for page ${page}: the transport layer provides reliable delivery.`)
      .join('\n');
  },

  /** Hashed bag of words: texts sharing most words come out close, others do not. */
  async embed(texts) {
    return texts.map((text) => {
      const vector = new Array<number>(64).fill(0);
      for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        let h = 0;
        for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 64;
        vector[h]! += 1;
      }
      return vector;
    });
  },

  async generate({ request, inline }) {
    const questions: unknown[] = [];
    let n = 0;
    for (const difficulty of DIFFICULTIES) {
      for (let i = 0; i < request.batch[difficulty]; i += 1) {
        const type = request.types[n % request.types.length]!;
        const text = `Which statement best describes ${word()} ${word()} ${word()}?`;
        const common = {
          difficulty,
          bloom: 'UNDERSTAND',
          topic: 'Transport Layer',
          explanation: 'Stated in the material.',
          sourcePage: inline ? 1 : 2,
          sourceQuote: 'the transport layer provides reliable delivery',
        };
        if (type === 'TRUE_FALSE') questions.push({ ...common, type, text, answerTrue: n % 2 === 0 });
        else if (type === 'ASSERTION_REASON')
          questions.push({ ...common, type, text: '', assertion: text, reason: `Because ${word()} ${word()}.`, arAnswer: 1 });
        else if (type === 'SHORT_ANSWER')
          questions.push({ ...common, type, text, acceptedAnswers: [word()] });
        else
          questions.push({
            ...common,
            type,
            text,
            options: [
              { text: `Option ${word()}`, correct: true },
              { text: `Option ${word()}`, correct: type === 'MCQ_MULTI' },
              { text: `Option ${word()}`, correct: false },
              { text: `Option ${word()}`, correct: false },
            ],
          });
        n += 1;
      }
    }
    // Always one question the validator must reject: no correct option.
    questions.push({
      type: 'MCQ_SINGLE',
      difficulty: 'EASY',
      text: `Broken question ${word()} ${word()}?`,
      options: [
        { text: 'A', correct: false },
        { text: 'B', correct: false },
      ],
      explanation: 'x',
    });
    return { json: { questions }, sources: [] };
  },
};

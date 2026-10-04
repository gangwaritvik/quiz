import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { strToU8, zipSync } from 'fflate';

import { officeTextPages } from '@/lib/ai/office-text';
import {
  compareAnswer,
  isFlagged,
  locateQuote,
  normalizeForMatch,
  suggestAnswer,
  toCheckItem,
} from '@/lib/ai/verification';

const pages = [
  'Chapter 1. The transport layer provides process-to-process delivery between applications.',
  'TCP gives reliable, ordered delivery; UDP is connectionless and has low overhead.\nFor one feature, the QDA discriminant is $\\delta_k(x) = -\\ln \\sigma_k^2$.',
  'Congestion control uses slow start and congestion avoidance to adapt the window.',
];

describe('locateQuote', () => {
  test('finds a quote word for word, ignoring punctuation, case and line breaks', () => {
    assert.deepEqual(locateQuote('TCP gives reliable ordered delivery', pages), { page: 2, exact: true });
    assert.deepEqual(locateQuote('udp is CONNECTIONLESS and has low overhead', pages), { page: 2, exact: true });
  });

  test('finds a quote that includes maths, since symbols are ignored on both sides', () => {
    assert.equal(locateQuote('the QDA discriminant is $\\delta_k(x) = -\\ln \\sigma_k^2$', pages)?.page, 2);
  });

  test('a lightly reworded quote is a close match on the right page', () => {
    const found = locateQuote('Congestion control uses slow start and congestion avoidance to adapt the window size', pages);
    assert.equal(found?.page, 3);
    assert.equal(found?.exact, false);
  });

  test('an invented quote is not found', () => {
    assert.equal(locateQuote('Each byte of an IPv4 address ranges from 0 to 255.', pages), null);
  });

  test('a quote too short to judge is not found', () => {
    assert.equal(locateQuote('TCP', pages), null);
  });

  test('the range limits where it looks', () => {
    assert.equal(locateQuote('TCP gives reliable ordered delivery', pages, { from: 3, to: 3 }), null);
    assert.equal(locateQuote('TCP gives reliable ordered delivery', pages, { from: 2, to: 3 })?.page, 2);
  });

  test('a word split by a PDF line break still matches', () => {
    const layer = ['QDA is a supervised machine learning classifi\ncation algorithm.'];
    assert.deepEqual(locateQuote('supervised machine learning classification algorithm', layer), { page: 1, exact: true });
  });

  test('Greek letters in the file match their LaTeX names in a quote', () => {
    const layer = ['Unlike LDA, QDA allows each class its own covariance Σ1 and Σ2 here'];
    assert.equal(locateQuote('QDA allows each class its own covariance $\\Sigma_{1}$ and $\\Sigma_{2}$', layer)?.exact, true);
  });

  test('normalising drops everything but letters and digits', () => {
    assert.equal(normalizeForMatch('  A–B:  $x^2$!\n'), 'a b x 2');
  });
});

describe('compareAnswer', () => {
  const mcq = {
    type: 'MCQ_SINGLE',
    text: 'q',
    options: [
      { text: 'a', isCorrect: false },
      { text: 'b', isCorrect: true },
    ],
  };
  const multi = {
    type: 'MCQ_MULTI',
    text: 'q',
    options: [
      { text: 'a', isCorrect: true },
      { text: 'b', isCorrect: false },
      { text: 'c', isCorrect: true },
    ],
  };
  const short = { type: 'SHORT_ANSWER', text: 'q', acceptedAnswers: ['Transport Layer Security', 'TLS'] };

  test('single choice: same option agrees, another differs', () => {
    assert.equal(compareAnswer(mcq, { id: 0, canAnswer: true, choice: [2] }), 'agrees');
    assert.equal(compareAnswer(mcq, { id: 0, canAnswer: true, choice: [1] }), 'differs');
  });

  test('multiple answers need exactly the right set', () => {
    assert.equal(compareAnswer(multi, { id: 0, canAnswer: true, choice: [3, 1] }), 'agrees');
    assert.equal(compareAnswer(multi, { id: 0, canAnswer: true, choice: [1] }), 'differs');
    assert.equal(compareAnswer(multi, { id: 0, canAnswer: true, choice: [1, 2, 3] }), 'differs');
  });

  test('short answer: matches an accepted answer loosely, otherwise differs', () => {
    assert.equal(compareAnswer(short, { id: 0, canAnswer: true, text: 'tls' }), 'agrees');
    assert.equal(compareAnswer(short, { id: 0, canAnswer: true, text: 'It is Transport Layer Security.' }), 'agrees');
    assert.equal(compareAnswer(short, { id: 0, canAnswer: true, text: 'Secure Sockets Layer' }), 'differs');
  });

  test('no answer, or "cannot tell", never alarms', () => {
    assert.equal(compareAnswer(mcq, undefined), null);
    assert.equal(compareAnswer(mcq, { id: 0, canAnswer: false }), 'unclear');
    assert.equal(compareAnswer(mcq, { id: 0, canAnswer: true, choice: [] }), 'unclear');
    assert.equal(compareAnswer(short, { id: 0, canAnswer: true, text: ' ' }), 'unclear');
  });

  test('check items carry the assertion and reason, and the right kind', () => {
    const item = toCheckItem({ ...mcq, type: 'ASSERTION_REASON', assertionText: 'A1', reasonText: 'R1' }, 3, 'passage');
    assert.equal(item.kind, 'choice');
    assert.match(item.question, /Assertion \(A\): A1 Reason \(R\): R1/);
    assert.equal(toCheckItem(short, 0, 'p').kind, 'text');
    assert.equal(toCheckItem(multi, 0, 'p').kind, 'multi');
  });
});

describe('isFlagged', () => {
  test('a missing quote or a disagreeing second reading flags a draft', () => {
    assert.equal(isFlagged({ quote: 'missing' }), true);
    assert.equal(isFlagged({ check: 'differs' }), true);
    assert.equal(isFlagged({ quote: 'exact', check: 'agrees' }), false);
    assert.equal(isFlagged({ quote: 'unchecked', check: 'unclear' }), false);
    assert.equal(isFlagged(null), false);
  });
});

describe('officeTextPages', () => {
  const docx = zipSync({
    'word/document.xml': strToU8(
      '<w:document><w:body><w:p><w:r><w:t>Slow start </w:t></w:r><w:r><w:t xml:space="preserve">doubles the window &amp; more.</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>',
    ),
    'word/styles.xml': strToU8('<x/>'),
  });
  const slide = (text: string) => strToU8(`<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`);
  const pptx = zipSync({
    'ppt/slides/slide10.xml': slide('Tenth'),
    'ppt/slides/slide2.xml': slide('Second'),
    'ppt/slides/slide1.xml': slide('First'),
    'ppt/presentation.xml': strToU8('<x/>'),
  });

  test('a Word file is one page of its paragraphs, entities decoded', () => {
    assert.deepEqual(officeTextPages(docx, 'docx'), ['Slow start doubles the window & more.\nSecond paragraph']);
  });

  test('a presentation is one page per slide, in slide order', () => {
    assert.deepEqual(officeTextPages(pptx, 'pptx'), ['First', 'Second', 'Tenth']);
  });

  test('something that is not a zip throws, so callers can treat it as unreadable', () => {
    assert.throws(() => officeTextPages(new Uint8Array([1, 2, 3]), 'docx'));
  });
});

describe('suggestAnswer', () => {
  const short = { type: 'SHORT_ANSWER', text: 'q', acceptedAnswers: ['TLS'] };

  test('offers the wording the key lacks when the second reading is right', () => {
    assert.equal(suggestAnswer(short, { id: 0, canAnswer: true, text: 'Transport Layer Security (TLS)' }), 'Transport Layer Security (TLS)');
  });

  test('offers nothing when the key already lists that wording, or the reading is wrong or unsure', () => {
    assert.equal(suggestAnswer(short, { id: 0, canAnswer: true, text: 'tls.' }), null);
    assert.equal(suggestAnswer(short, { id: 0, canAnswer: true, text: 'Secure Sockets Layer' }), null);
    assert.equal(suggestAnswer(short, { id: 0, canAnswer: false }), null);
    assert.equal(suggestAnswer(short, undefined), null);
  });

  test('only short answers, and only short wordings, are suggested', () => {
    assert.equal(suggestAnswer({ ...short, type: 'MCQ_SINGLE' }, { id: 0, canAnswer: true, text: 'x TLS' }), null);
    assert.equal(suggestAnswer(short, { id: 0, canAnswer: true, text: `TLS ${'very long '.repeat(20)}` }), null);
  });
});

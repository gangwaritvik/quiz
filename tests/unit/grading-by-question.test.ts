import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  excerpt,
  labelAnswers,
  nextQuestionWithPending,
  nextUnmarked,
  summariseQuestions,
} from '@/lib/grading-by-question';

describe('excerpt', () => {
  test('collapses whitespace and leaves short text alone', () => {
    assert.equal(excerpt('  Explain\n  the   cycle '), 'Explain the cycle');
  });
  test('cuts long text on a word with an ellipsis', () => {
    const out = excerpt('alpha beta gamma delta epsilon', 15);
    assert.equal(out, 'alpha beta…');
    assert.ok(out.length <= 15);
  });
});

describe('summariseQuestions', () => {
  const row = (questionId: string, position: number, marked: boolean, marks = 5) => ({
    questionId,
    position,
    marks,
    marked,
  });

  test('counts pending and total per question', () => {
    const [q] = summariseQuestions([row('a', 1, true), row('a', 1, false), row('a', 1, false)]);
    assert.deepEqual(q, { questionId: 'a', maxMarks: 5, pending: 2, total: 3 });
  });

  test('orders by quiz order, then earliest position for pooled questions', () => {
    const rows = [row('pool-late', 9, false), row('fixed-2', 1, false), row('pool-early', 3, false), row('fixed-1', 7, false)];
    const order = new Map([
      ['fixed-1', 0],
      ['fixed-2', 1],
    ]);
    assert.deepEqual(
      summariseQuestions(rows, order).map((q) => q.questionId),
      ['fixed-1', 'fixed-2', 'pool-early', 'pool-late'],
    );
  });

  test('uses the earliest position a shuffled question was seen at', () => {
    const rows = [row('x', 8, false), row('y', 4, false), row('x', 2, false)];
    assert.deepEqual(
      summariseQuestions(rows).map((q) => q.questionId),
      ['x', 'y'],
    );
  });
});

describe('labelAnswers', () => {
  const a = (answerId: string, submittedAt: string | null) => ({ answerId, submittedAt });

  test('labels by submission time, then id, with unsubmitted last', () => {
    const out = labelAnswers([
      a('c', null),
      a('b', '2026-01-01T10:00:00.000Z'),
      a('z', '2026-01-01T09:00:00.000Z'),
      a('a', '2026-01-01T10:00:00.000Z'),
    ]);
    assert.deepEqual(
      out.map((r) => [r.answerId, r.blindLabel]),
      [
        ['z', 'Answer 1'],
        ['a', 'Answer 2'],
        ['b', 'Answer 3'],
        ['c', 'Answer 4'],
      ],
    );
  });

  test('does not mutate its input', () => {
    const input = [a('b', '2026-01-02T00:00:00.000Z'), a('a', '2026-01-01T00:00:00.000Z')];
    labelAnswers(input);
    assert.equal(input[0]?.answerId, 'b');
  });
});

describe('nextUnmarked', () => {
  const m = '2026-01-01T00:00:00.000Z';
  const items = (...marked: boolean[]) => marked.map((x) => ({ gradedAt: x ? m : null }));

  test('-1 asks for the first unmarked item', () => {
    assert.equal(nextUnmarked(items(true, true, false, false), -1), 2);
  });
  test('moves forward from the current item', () => {
    assert.equal(nextUnmarked(items(false, true, false, false), 0), 2);
  });
  test('wraps round to earlier skipped items', () => {
    assert.equal(nextUnmarked(items(false, true, true), 2), 0);
  });
  test('never returns the current item, even when it is the only one left', () => {
    assert.equal(nextUnmarked(items(true, false, true), 1), -1);
  });
  test('-1 when everything is marked or the list is empty', () => {
    assert.equal(nextUnmarked(items(true, true), 0), -1);
    assert.equal(nextUnmarked([], -1), -1);
  });
});

describe('nextQuestionWithPending', () => {
  const qs = [
    { questionId: 'a', pending: 0 },
    { questionId: 'b', pending: 2 },
    { questionId: 'c', pending: 0 },
    { questionId: 'd', pending: 1 },
  ];
  test('finds the next question with work left, wrapping', () => {
    assert.equal(nextQuestionWithPending(qs, 'b')?.questionId, 'd');
    assert.equal(nextQuestionWithPending(qs, 'd')?.questionId, 'b');
  });
  test('null when no other question has work left', () => {
    assert.equal(nextQuestionWithPending([{ questionId: 'a', pending: 3 }], 'a'), null);
    assert.equal(nextQuestionWithPending([{ questionId: 'a', pending: 0 }], 'a'), null);
  });
});

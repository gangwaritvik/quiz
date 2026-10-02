import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MIN_ATTEMPTS_FOR_DISCRIMINATION,
  analyseItems,
  type ItemQuestion,
  type ItemResponse,
} from '@/lib/item-analysis';

const mcq: ItemQuestion = {
  id: 'q1',
  text: 'Which?',
  type: 'MCQ_SINGLE',
  options: [
    { id: 'a', text: 'A', isCorrect: true },
    { id: 'b', text: 'B', isCorrect: false },
    { id: 'c', text: 'C', isCorrect: false },
  ],
};

const resp = (over: Partial<ItemResponse>): ItemResponse => ({
  attemptId: 'x',
  attemptScore: 0,
  questionId: 'q1',
  marks: 2,
  answered: true,
  awardedMarks: 2,
  selectedOptionIds: ['a'],
  ...over,
});

/** `n` attempts with ascending total scores; `right(i)` says who answered correctly. */
const cohort = (n: number, right: (i: number) => boolean): ItemResponse[] =>
  Array.from({ length: n }, (_, i) =>
    resp({
      attemptId: `a${i}`,
      attemptScore: i,
      awardedMarks: right(i) ? 2 : 0,
      selectedOptionIds: [right(i) ? 'a' : 'b'],
    }),
  );

describe('facility', () => {
  test('is the mean share of marks earned', () => {
    const [s] = analyseItems([mcq], cohort(4, (i) => i < 3));
    assert.equal(s!.facility, 0.75);
    assert.equal(s!.served, 4);
  });

  test('an unanswered question counts as zero, an unmarked one is left out', () => {
    const rows = [
      resp({ attemptId: '1' }),
      resp({ attemptId: '2', answered: false, awardedMarks: 0, selectedOptionIds: [] }),
      resp({ attemptId: '3', awardedMarks: null }),
    ];
    const [s] = analyseItems([mcq], rows);
    assert.equal(s!.facility, 0.5);
    assert.equal(s!.unanswered, 1);
    assert.equal(s!.unmarked, 1);
  });

  test('partial credit counts as a fraction, and a penalty never goes below zero', () => {
    const rows = [resp({ awardedMarks: 1 }), resp({ awardedMarks: -0.5 })];
    assert.equal(analyseItems([mcq], rows)[0]!.facility, 0.25);
  });

  test('a question nobody was served has no figures', () => {
    const [s] = analyseItems([mcq], []);
    assert.equal(s!.facility, null);
    assert.equal(s!.served, 0);
  });
});

describe('discrimination', () => {
  test('needs enough attempts', () => {
    const [s] = analyseItems([mcq], cohort(MIN_ATTEMPTS_FOR_DISCRIMINATION - 1, (i) => i > 4));
    assert.equal(s!.discrimination, null);
  });

  test('is high when strong students get it right and weak ones do not', () => {
    const [s] = analyseItems([mcq], cohort(20, (i) => i >= 10));
    assert.equal(s!.discrimination, 1);
  });

  test('is negative when weak students did better, with a note to check the key', () => {
    const [s] = analyseItems([mcq], cohort(20, (i) => i < 10));
    assert.equal(s!.discrimination, -1);
    assert.ok(s!.notes.some((n) => n.includes('answer key')));
  });

  test('is zero when everyone answers alike, with a note', () => {
    const [s] = analyseItems([mcq], cohort(20, () => true));
    assert.equal(s!.discrimination, 0);
    assert.ok(s!.notes.includes('Very easy'));
    assert.ok(s!.notes.includes('Does not separate strong from weak'));
  });
});

describe('distractors', () => {
  test('counts each option and names the most chosen wrong one', () => {
    const rows = [
      resp({ selectedOptionIds: ['a'] }),
      resp({ selectedOptionIds: ['b'], awardedMarks: 0 }),
      resp({ selectedOptionIds: ['c'], awardedMarks: 0 }),
      resp({ selectedOptionIds: ['c'], awardedMarks: 0 }),
    ];
    const [s] = analyseItems([mcq], rows);
    assert.deepEqual(
      s!.distractors.map((d) => [d.optionId, d.chosen]),
      [['a', 1], ['b', 1], ['c', 2]],
    );
    assert.equal(s!.mostChosenWrong?.optionId, 'c');
  });

  test('no wrong option picked means no most-chosen wrong option', () => {
    const [s] = analyseItems([mcq], [resp({}), resp({})]);
    assert.equal(s!.mostChosenWrong, null);
  });

  test('a multi-select counts every option a student ticked', () => {
    const multi: ItemQuestion = { ...mcq, type: 'MCQ_MULTI' };
    const [s] = analyseItems([multi], [resp({ selectedOptionIds: ['a', 'b'], awardedMarks: 0 })]);
    assert.equal(s!.distractors.find((d) => d.optionId === 'b')!.chosen, 1);
    assert.equal(s!.distractors.find((d) => d.optionId === 'a')!.chosen, 1);
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type Candidate, assemblePaper, repeats } from '@/lib/assemble-paper';

let n = 0;
const make = (difficulty: Candidate['difficulty'], topicId: string | null, extra: Partial<Candidate> = {}): Candidate => {
  n += 1;
  return { id: `q${n}`, difficulty, topicId, text: `Question number ${n} is about subject${n} words${n}${n}`, usageCount: 0, ...extra };
};
/** A fixed, repeatable "random": 0.5 shuffles identically every time. */
const fixed = () => 0.5;
const mix = (EASY: number, MEDIUM: number, HARD: number) => ({ EASY, MEDIUM, HARD });
const count = (picked: Candidate[], level: Candidate['difficulty']) => picked.filter((q) => q.difficulty === level).length;

describe('assemblePaper', () => {
  const bank = [
    ...Array.from({ length: 10 }, () => make('EASY', 'a')),
    ...Array.from({ length: 10 }, () => make('MEDIUM', 'b')),
    ...Array.from({ length: 10 }, () => make('HARD', 'c')),
  ];

  test('meets the difficulty mix exactly when the bank is rich enough', () => {
    const out = assemblePaper(bank, 10, mix(30, 50, 20), fixed);
    assert.equal(out.picked.length, 10);
    assert.deepEqual([count(out.picked, 'EASY'), count(out.picked, 'MEDIUM'), count(out.picked, 'HARD')], [3, 5, 2]);
    assert.deepEqual(out.short, { EASY: 0, MEDIUM: 0, HARD: 0 });
    assert.equal(out.filledFromOther, 0);
  });

  test('puts easy first and hard last', () => {
    const out = assemblePaper(bank, 9, mix(34, 33, 33), fixed);
    const levels = out.picked.map((q) => q.difficulty);
    assert.deepEqual(levels, [...levels].sort((a, b) => ['EASY', 'MEDIUM', 'HARD'].indexOf(a) - ['EASY', 'MEDIUM', 'HARD'].indexOf(b)));
  });

  test('spreads a difficulty over the topics instead of taking one topic whole', () => {
    const medium = [
      ...Array.from({ length: 8 }, () => make('MEDIUM', 't1')),
      ...Array.from({ length: 8 }, () => make('MEDIUM', 't2')),
      ...Array.from({ length: 8 }, () => make('MEDIUM', 't3')),
    ];
    const out = assemblePaper(medium, 6, mix(0, 100, 0), fixed);
    const perTopic = (id: string) => out.picked.filter((q) => q.topicId === id).length;
    assert.deepEqual([perTopic('t1'), perTopic('t2'), perTopic('t3')], [2, 2, 2]);
  });

  test('balances topics across difficulties too, not only within one', () => {
    const rich = ['t1', 't2'].flatMap((topic) => (['EASY', 'MEDIUM'] as const).flatMap((level) => Array.from({ length: 4 }, () => make(level, topic))));
    const out = assemblePaper(rich, 4, mix(50, 50, 0), fixed);
    assert.equal(out.picked.filter((q) => q.topicId === 't1').length, 2);
    assert.equal(out.picked.filter((q) => q.topicId === 't2').length, 2);
  });

  test('prefers the questions used least', () => {
    const used = [make('EASY', 'a', { usageCount: 9 }), make('EASY', 'a', { usageCount: 0 }), make('EASY', 'a', { usageCount: 4 })];
    const out = assemblePaper(used, 1, mix(100, 0, 0), fixed);
    assert.equal(out.picked[0]!.id, used[1]!.id);
  });

  test('never puts two questions that say the same on one paper, and counts what it left out', () => {
    const twin = 'What does the transport layer provide to applications on two hosts?';
    const dupes = [make('EASY', 'a', { text: twin }), make('EASY', 'a', { text: twin }), make('EASY', 'a'), make('EASY', 'a')];
    const out = assemblePaper(dupes, 3, mix(100, 0, 0), fixed);
    assert.equal(out.picked.filter((q) => q.text === twin).length, 1);
    assert.equal(out.picked.length, 3);
    assert.ok(out.repeatsSkipped >= 1);
  });

  test('uses meaning-vectors when it has them, but different numbers are different questions', () => {
    const a = make('EASY', 'a', { text: 'Find the delay of a 300 km link', vector: [1, 0, 0] });
    const sameMeaning = make('EASY', 'a', { text: 'Compute the delay for a link of 300 km length', vector: [0.99, 0.05, 0] });
    const otherNumbers = make('EASY', 'a', { text: 'Find the delay of a 600 km link', vector: [1, 0, 0] });
    assert.equal(repeats(a, sameMeaning), true);
    assert.equal(repeats(a, otherNumbers), false);
  });

  test('when the bank is short of one difficulty it says so and fills from the rest', () => {
    const thin = [...Array.from({ length: 2 }, () => make('HARD', 'a')), ...Array.from({ length: 10 }, () => make('MEDIUM', 'a'))];
    const out = assemblePaper(thin, 5, mix(0, 0, 100), fixed);
    assert.equal(out.picked.length, 5);
    assert.equal(out.short.HARD, 3);
    assert.equal(out.filledFromOther, 3);
    assert.equal(count(out.picked, 'HARD'), 2);
  });

  test('an empty or too-small bank gives what exists, never more than asked, and never a question twice', () => {
    assert.equal(assemblePaper([], 5, mix(30, 50, 20), fixed).picked.length, 0);
    const few = [make('EASY', 'a'), make('MEDIUM', 'a')];
    const out = assemblePaper(few, 10, mix(30, 50, 20), fixed);
    assert.equal(out.picked.length, 2);
    assert.equal(new Set(out.picked.map((q) => q.id)).size, 2);
  });

  test('different random draws give different papers when the bank is large', () => {
    let seed = 1;
    const lcg = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const first = assemblePaper(bank, 10, mix(30, 50, 20), lcg).picked.map((q) => q.id).join();
    const second = assemblePaper(bank, 10, mix(30, 50, 20), lcg).picked.map((q) => q.id).join();
    assert.notEqual(first, second);
  });
});

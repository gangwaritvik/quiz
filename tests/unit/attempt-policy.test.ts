import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_EXTRA_ATTEMPTS,
  bestPerStudent,
  canStartAnother,
  grantOne,
  revokeUnused,
} from '@/lib/attempt-policy';

describe('canStartAnother', () => {
  const single = { singleAttempt: true };

  test('a single-attempt quiz allows one attempt', () => {
    assert.equal(canStartAnother(single, 0, 0), true);
    assert.equal(canStartAnother(single, 0, 1), false);
  });

  test('a grant allows exactly that many more', () => {
    assert.equal(canStartAnother(single, 1, 1), true);
    assert.equal(canStartAnother(single, 1, 2), false);
  });

  test('a quiz that allows several attempts never runs out', () => {
    assert.equal(canStartAnother({ singleAttempt: false }, 0, 50), true);
  });
});

describe('grantOne and revokeUnused', () => {
  test('a first grant after one attempt allows one more', () => {
    assert.equal(grantOne(0, 1), 1);
  });

  test('a grant is always one beyond what has been used', () => {
    assert.equal(grantOne(1, 2), 2); // one granted and used, grant another
    assert.equal(grantOne(2, 1), 3); // two granted, none used: adds one
  });

  test('grants are capped', () => {
    assert.equal(grantOne(MAX_EXTRA_ATTEMPTS, 4), MAX_EXTRA_ATTEMPTS);
  });

  test('revoking removes only the unused grants', () => {
    assert.equal(revokeUnused(2, 1), 0);
    assert.equal(revokeUnused(2, 2), 1);
    assert.equal(revokeUnused(1, 5), 1);
  });
});

describe('bestPerStudent', () => {
  const row = (student: string, pct: number | null, id = `${student}${pct}`) => ({ student, pct, id });

  test('keeps the best attempt for each student', () => {
    const kept = bestPerStudent(
      [row('a', 40), row('b', 70), row('a', 90), row('b', 60)],
      (r) => r.student,
      (r) => r.pct,
    );
    assert.deepEqual(kept.map((r) => r.id).sort(), ['a90', 'b70']);
  });

  test('an unscored attempt never beats a scored one', () => {
    const kept = bestPerStudent([row('a', null), row('a', 0)], (r) => r.student, (r) => r.pct);
    assert.equal(kept[0]!.pct, 0);
  });

  test('on a tie the first is kept', () => {
    const kept = bestPerStudent([row('a', 50, 'first'), row('a', 50, 'second')], (r) => r.student, (r) => r.pct);
    assert.equal(kept[0]!.id, 'first');
  });
});

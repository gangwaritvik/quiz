import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ackDraft,
  clearDrafts,
  getDraft,
  loadDrafts,
  nextSeq,
  saveDraft,
  shouldApply,
  type KV,
} from '@/lib/offline-queue';

function memory(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('offline queue', () => {
  test('sequence numbers only grow, even if the clock goes back', () => {
    assert.equal(nextSeq(100, 50), 101);
    assert.equal(nextSeq(100, 500), 500);
  });

  test('a draft is stored and replaced per question', () => {
    const kv = memory();
    const a = saveDraft(kv, 'att', 'q1', { text: 'a' }, 10)!;
    const b = saveDraft(kv, 'att', 'q1', { text: 'ab' }, 10)!;
    assert.ok(b > a);
    assert.deepEqual(getDraft(kv, 'att', 'q1')?.payload, { text: 'ab' });
    assert.equal(Object.keys(loadDrafts(kv, 'att')).length, 1);
  });

  test('an acknowledgement removes only the draft that was sent', () => {
    const kv = memory();
    const first = saveDraft(kv, 'att', 'q1', 'one', 10)!;
    const second = saveDraft(kv, 'att', 'q1', 'two', 10)!; // edited while `first` was in flight
    assert.equal(ackDraft(kv, 'att', 'q1', first), false);
    assert.equal(getDraft(kv, 'att', 'q1')?.payload, 'two');
    assert.equal(ackDraft(kv, 'att', 'q1', second), true);
    assert.equal(getDraft(kv, 'att', 'q1'), undefined);
  });

  test('attempts do not share drafts, and clearing is per attempt', () => {
    const kv = memory();
    saveDraft(kv, 'a', 'q', 1);
    saveDraft(kv, 'b', 'q', 2);
    clearDrafts(kv, 'a');
    assert.deepEqual(loadDrafts(kv, 'a'), {});
    assert.equal(getDraft(kv, 'b', 'q')?.payload, 2);
  });

  test('no storage means no persistence, not an error', () => {
    assert.equal(saveDraft(null, 'a', 'q', 1), undefined);
    assert.deepEqual(loadDrafts(null, 'a'), {});
    assert.equal(ackDraft(null, 'a', 'q', 1), false);
  });

  test('corrupt or throwing storage is tolerated', () => {
    const kv = memory();
    kv.setItem('sq-drafts:a', '{not json');
    assert.deepEqual(loadDrafts(kv, 'a'), {});
    const full: KV = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    assert.doesNotThrow(() => saveDraft(full, 'a', 'q', 1));
    assert.doesNotThrow(() => clearDrafts(full, 'a'));
  });
});

describe('shouldApply (server side)', () => {
  test('applies when nothing is stored or no sequence was sent', () => {
    assert.equal(shouldApply(null, 5), true);
    assert.equal(shouldApply(undefined, 5), true);
    assert.equal(shouldApply(9n, undefined), true);
  });

  test('applies only a strictly newer sequence', () => {
    assert.equal(shouldApply(9n, 10), true);
    assert.equal(shouldApply(10n, 10), false);
    assert.equal(shouldApply(10n, 4), false);
  });
});

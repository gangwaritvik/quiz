import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  JITTER_MS,
  extensionAdded,
  extensionMessage,
  nextDeadline,
  readExtraMinutes,
} from '@/lib/timer-sync';

const NOW = 1_000_000;

describe('nextDeadline', () => {
  test('the first response sets the deadline from the server', () => {
    assert.equal(nextDeadline(null, NOW, 90_000), NOW + 90_000);
  });

  test('an increase from the server is adopted', () => {
    // 30 s left locally, faculty added 10 minutes.
    const current = NOW + 30_000;
    assert.equal(nextDeadline(current, NOW, 630_000), NOW + 630_000);
  });

  test('a decrease from the server is adopted', () => {
    const current = NOW + 300_000;
    assert.equal(nextDeadline(current, NOW, 240_000), NOW + 240_000);
  });

  test('jitter under 2 s keeps the current deadline so the display does not flicker', () => {
    const current = NOW + 60_000;
    assert.equal(nextDeadline(current, NOW, 60_000 + 400), current);
    assert.equal(nextDeadline(current, NOW, 60_000 - JITTER_MS + 1), current);
    assert.equal(nextDeadline(current, NOW, 60_000 + JITTER_MS - 1), current);
  });

  test('a gap of 2 s or more is a real change', () => {
    const current = NOW + 60_000;
    assert.equal(nextDeadline(current, NOW, 60_000 + JITTER_MS), NOW + 60_000 + JITTER_MS);
    assert.equal(nextDeadline(current, NOW, 60_000 - JITTER_MS), NOW + 60_000 - JITTER_MS);
  });

  test('a server "expired" is adopted at once, never smoothed', () => {
    const current = NOW + 1_500;
    assert.equal(nextDeadline(current, NOW, 0), NOW);
    assert.equal(nextDeadline(current, NOW, -500), NOW);
  });

  test('a local timer already at zero follows a server that still has time', () => {
    // Our clock ran fast: zero here, 1.2 s left on the server. Within the
    // jitter window, but the countdown is not running, so it must be adopted.
    assert.equal(nextDeadline(NOW, NOW, 1_200), NOW + 1_200);
    assert.equal(nextDeadline(NOW - 5_000, NOW, 1_200), NOW + 1_200);
  });

  test('never extends by itself: the result is only ever current or server-derived', () => {
    for (const serverRemaining of [0, 500, 59_000, 61_000, 5_000_000]) {
      const result = nextDeadline(NOW + 60_000, NOW, serverRemaining);
      assert.ok(result === NOW + 60_000 || result === NOW + serverRemaining);
    }
  });
});

describe('readExtraMinutes', () => {
  test('reads the field from the response or from its timer block', () => {
    assert.equal(readExtraMinutes({ extraMinutes: 15 }), 15);
    assert.equal(readExtraMinutes({ timer: { extraMinutes: 10 } }), 10);
  });

  test('a missing or invalid value is 0', () => {
    assert.equal(readExtraMinutes({}), 0);
    assert.equal(readExtraMinutes({ timer: null }), 0);
    assert.equal(readExtraMinutes({ extraMinutes: -5 }), 0);
    assert.equal(readExtraMinutes({ extraMinutes: '10' }), 0);
    assert.equal(readExtraMinutes({ extraMinutes: Number.NaN }), 0);
  });
});

describe('extensionAdded', () => {
  test('the first response sets the baseline without announcing', () => {
    assert.deepEqual(extensionAdded(null, 20), { known: 20, added: 0 });
    assert.deepEqual(extensionAdded(null, 0), { known: 0, added: 0 });
  });

  test('an increase reports the difference once, then nothing', () => {
    const first = extensionAdded(10, 25);
    assert.deepEqual(first, { known: 25, added: 15 });
    assert.deepEqual(extensionAdded(first.known, 25), { known: 25, added: 0 });
  });

  test('a lower or equal value announces nothing and lowers the baseline', () => {
    assert.deepEqual(extensionAdded(25, 25), { known: 25, added: 0 });
    assert.deepEqual(extensionAdded(25, 10), { known: 10, added: 0 });
  });
});

describe('extensionMessage', () => {
  test('names the minutes added and the new end time', () => {
    assert.equal(
      extensionMessage(15, '2:45 pm'),
      'Your faculty added 15 minutes. Your timer now ends at 2:45 pm.',
    );
    assert.equal(
      extensionMessage(1, '2:45 pm'),
      'Your faculty added 1 minute. Your timer now ends at 2:45 pm.',
    );
  });
});

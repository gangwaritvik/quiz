import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resultsVisibility } from '@/lib/exam';
import {
  MAX_TOTAL_EXTENSION_MINUTES,
  computeExpiresAt,
  effectiveEndsAt,
  extendExpiresAt,
  extensionRefusal,
  pauseAdjustedExpiresAt,
} from '@/lib/time-extension';

const MIN = 60_000;
const at = (iso: string) => new Date(iso);

const quiz = { durationMinutes: 60, endsAt: at('2026-10-05T12:00:00Z') };

describe('computeExpiresAt', () => {
  test('no extra time: duration from the start', () => {
    const start = at('2026-10-05T10:00:00Z');
    assert.equal(computeExpiresAt(start, quiz, 0).toISOString(), '2026-10-05T11:00:00.000Z');
  });

  test('extra time is added to the duration', () => {
    const start = at('2026-10-05T10:00:00Z');
    assert.equal(computeExpiresAt(start, quiz, 15).toISOString(), '2026-10-05T11:15:00.000Z');
  });

  test('a student with none is still cut off at the window end', () => {
    const start = at('2026-10-05T11:30:00Z');
    assert.equal(computeExpiresAt(start, quiz, 0).toISOString(), quiz.endsAt.toISOString());
  });

  test('a student with extra time may run past the window by exactly that extra', () => {
    const start = at('2026-10-05T11:30:00Z');
    // 60 + 20 min from 11:30 would be 12:50, but the cap is 12:00 + 20 min.
    assert.equal(computeExpiresAt(start, quiz, 20).toISOString(), '2026-10-05T12:20:00.000Z');
  });

  test('starting at the last instant gives only the extra time past the window', () => {
    const start = new Date(quiz.endsAt.getTime());
    assert.equal(computeExpiresAt(start, quiz, 30).getTime(), quiz.endsAt.getTime() + 30 * MIN);
  });
});

describe('effectiveEndsAt', () => {
  test('equals the window end when nobody has extra time', () => {
    const q = { endsAt: quiz.endsAt, maxExtensionMinutes: 0 };
    assert.equal(effectiveEndsAt(q).getTime(), quiz.endsAt.getTime());
  });

  test('adds the largest extension granted on the quiz', () => {
    const q = { endsAt: quiz.endsAt, maxExtensionMinutes: 45 };
    assert.equal(effectiveEndsAt(q).toISOString(), '2026-10-05T12:45:00.000Z');
  });
});

describe('extensionRefusal', () => {
  test('allows a grant that stays within the total cap', () => {
    assert.equal(extensionRefusal(0, 120), null);
    assert.equal(extensionRefusal(60, 120), null);
  });

  test('allows reaching the cap exactly', () => {
    assert.equal(extensionRefusal(MAX_TOTAL_EXTENSION_MINUTES - 30, 30), null);
  });

  test('refuses a grant that would pass the cap', () => {
    assert.equal(
      extensionRefusal(61, 120),
      'Total extra time on one attempt is limited to 180 minutes.',
    );
    assert.notEqual(extensionRefusal(MAX_TOTAL_EXTENSION_MINUTES, 1), null);
  });
});

describe('extendExpiresAt', () => {
  test('moves the deadline forward by whole minutes', () => {
    const deadline = at('2026-10-05T11:00:00Z');
    assert.equal(extendExpiresAt(deadline, 10).toISOString(), '2026-10-05T11:10:00.000Z');
  });

  test('does not mutate the original date', () => {
    const deadline = at('2026-10-05T11:00:00Z');
    extendExpiresAt(deadline, 10);
    assert.equal(deadline.toISOString(), '2026-10-05T11:00:00.000Z');
  });
});

describe('resultsVisibility with extensions', () => {
  const released = {
    releaseResults: true,
    releaseAnswers: true,
    endsAt: quiz.endsAt,
  };

  test('without extensions, results unlock when the window closes', () => {
    const q = { ...released, maxExtensionMinutes: 0 };
    assert.equal(resultsVisibility(q, at('2026-10-05T11:59:59Z')).results, false);
    assert.equal(resultsVisibility(q, at('2026-10-05T12:00:00Z')).results, true);
  });

  test('results stay hidden while an extended student may still be sitting', () => {
    const q = { ...released, maxExtensionMinutes: 30 };
    assert.equal(resultsVisibility(q, at('2026-10-05T12:10:00Z')).results, false);
    assert.equal(resultsVisibility(q, at('2026-10-05T12:10:00Z')).answers, false);
    assert.equal(resultsVisibility(q, at('2026-10-05T12:30:00Z')).results, true);
  });
});

describe('pauseAdjustedExpiresAt', () => {
  const deadline = at('2026-10-05T11:00:00Z');

  test('an attempt that is not paused keeps its deadline', () => {
    assert.equal(pauseAdjustedExpiresAt(deadline, null, at('2026-10-05T10:50:00Z')), deadline);
  });

  test('a paused attempt keeps the same time remaining however long the pause lasts', () => {
    const pausedAt = at('2026-10-05T10:30:00Z');
    const remainingAt = (now: string) =>
      pauseAdjustedExpiresAt(deadline, pausedAt, at(now)).getTime() - at(now).getTime();
    assert.equal(remainingAt('2026-10-05T10:30:00Z'), 30 * MIN);
    assert.equal(remainingAt('2026-10-05T10:45:00Z'), 30 * MIN);
    assert.equal(remainingAt('2026-10-05T13:00:00Z'), 30 * MIN);
  });

  test('a pause that starts in the future (clock skew) does not move the deadline backwards', () => {
    const d = pauseAdjustedExpiresAt(deadline, at('2026-10-05T10:31:00Z'), at('2026-10-05T10:30:00Z'));
    assert.equal(d.getTime(), deadline.getTime());
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  clamp,
  cn,
  formatDuration,
  formatRelativeDay,
  initials,
  pluralize,
  relativeTime,
} from '@/lib/utils';

describe('pluralize', () => {
  test('uses singular only for exactly 1', () => {
    assert.equal(pluralize(1, 'question'), '1 question');
    assert.equal(pluralize(0, 'question'), '0 questions');
    assert.equal(pluralize(2, 'question'), '2 questions');
    assert.equal(pluralize(-1, 'point'), '-1 points');
  });
  test('accepts an irregular plural', () => {
    assert.equal(pluralize(2, 'child', 'children'), '2 children');
    assert.equal(pluralize(1, 'child', 'children'), '1 child');
  });
});

describe('clamp', () => {
  test('bounds a value to the range', () => {
    assert.equal(clamp(5, 0, 3), 3);
    assert.equal(clamp(-5, 0, 3), 0);
    assert.equal(clamp(2, 0, 3), 2);
    assert.equal(clamp(0, 0, 3), 0);
    assert.equal(clamp(3, 0, 3), 3);
  });
});

describe('formatDuration', () => {
  test('formats minutes:seconds under an hour and h:mm:ss above', () => {
    assert.equal(formatDuration(0), '00:00');
    assert.equal(formatDuration(1499), '24:59');
    assert.equal(formatDuration(3599), '59:59');
    assert.equal(formatDuration(3600), '1:00:00');
    assert.equal(formatDuration(3601), '1:00:01');
  });
  test('negative input clamps to zero and fractions floor', () => {
    assert.equal(formatDuration(-30), '00:00');
    assert.equal(formatDuration(59.9), '00:59');
  });
});

describe('initials', () => {
  test('takes up to two uppercase initials and ignores extra whitespace', () => {
    assert.equal(initials('  asha   kumar  rao '), 'AK');
    assert.equal(initials('Madonna'), 'M');
    assert.equal(initials(''), '');
  });
});

describe('cn', () => {
  test('merges conflicting tailwind classes, last wins, and drops falsy values', () => {
    assert.equal(cn('p-2', false && 'hidden', 'p-4'), 'p-4');
  });
});

describe('formatRelativeDay', () => {
  const noon = () => new Date(2026, 5, 15, 12, 0, 0);
  const at = (days: number, hour = 9) => new Date(2026, 5, 15 + days, hour, 30);

  test('labels today, tomorrow and yesterday', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: noon() });
    assert.match(formatRelativeDay(at(0)), /^Today, /);
    assert.match(formatRelativeDay(at(1)), /^Tomorrow, /);
    assert.match(formatRelativeDay(at(-1)), /^Yesterday, /);
  });
  test('uses the calendar day, not a 24h distance (late night is still today)', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: noon() });
    assert.match(formatRelativeDay(at(0, 23)), /^Today, /);
    assert.match(formatRelativeDay(at(1, 0)), /^Tomorrow, /);
  });
  test('falls back to a dated label further away', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: noon() });
    const out = formatRelativeDay(at(5));
    assert.doesNotMatch(out, /^(Today|Tomorrow|Yesterday)/);
    assert.match(out, /^20 Jun, /);
  });
  test('accepts ISO strings', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: noon() });
    assert.match(formatRelativeDay(at(0).toISOString()), /^Today, /);
  });
});

describe('relativeTime', () => {
  const now = new Date(2026, 5, 15, 12, 0, 0);
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  test('under a minute (and future times) read "just now"', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now });
    assert.equal(relativeTime(ago(30)), 'just now');
    assert.equal(relativeTime(ago(-120)), 'just now');
  });
  test('picks minutes, hours and days', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now });
    assert.equal(relativeTime(ago(5 * 60)), '5 minutes ago');
    assert.equal(relativeTime(ago(3 * 3600)), '3 hours ago');
    assert.equal(relativeTime(ago(3 * 86_400)), '3 days ago');
  });
  test('a week or older falls back to a date with no relative wording', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now });
    assert.equal(relativeTime(ago(7 * 86_400)), '8 Jun');
    assert.doesNotMatch(relativeTime(ago(30 * 86_400)), /ago/);
    assert.match(relativeTime(ago(6 * 86_400 + 3600)), /days? ago$/);
  });
});

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { ApiError } from '@/lib/api';
import {
  checkRateLimit,
  enforceRateLimit,
  RATE_LIMITS,
  resetRateLimits,
  type RateLimitRule,
} from '@/lib/rate-limit';

const rule: RateLimitRule = { name: 'test:rule', limit: 3, windowMs: 10_000 };

beforeEach(() => resetRateLimits());

describe('checkRateLimit', () => {
  test('allows up to the limit with a falling remaining count, then blocks', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    assert.deepEqual(checkRateLimit(rule, 'u1'), { allowed: true, remaining: 2, retryAfterSeconds: 0 });
    assert.equal(checkRateLimit(rule, 'u1').remaining, 1);
    assert.equal(checkRateLimit(rule, 'u1').remaining, 0);
    const blocked = checkRateLimit(rule, 'u1');
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.equal(blocked.retryAfterSeconds, 10);
  });

  test('keeps blocking for the whole window and reports a shrinking retry-after (rounded up)', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    for (let i = 0; i < 3; i += 1) checkRateLimit(rule, 'u1');
    t.mock.timers.tick(4_500);
    const blocked = checkRateLimit(rule, 'u1');
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 6); // ceil(5.5)
  });

  test('allows again once the window has elapsed, with a fresh budget', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    for (let i = 0; i < 4; i += 1) checkRateLimit(rule, 'u1');
    t.mock.timers.tick(9_999);
    assert.equal(checkRateLimit(rule, 'u1').allowed, false);
    t.mock.timers.tick(1);
    const fresh = checkRateLimit(rule, 'u1');
    assert.deepEqual(fresh, { allowed: true, remaining: 2, retryAfterSeconds: 0 });
  });

  test('identifiers are independent of each other', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    for (let i = 0; i < 4; i += 1) checkRateLimit(rule, 'u1');
    assert.equal(checkRateLimit(rule, 'u1').allowed, false);
    assert.equal(checkRateLimit(rule, 'u2').allowed, true);
  });

  test('rules with different names do not share a bucket for the same identifier', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const other: RateLimitRule = { ...rule, name: 'test:other' };
    for (let i = 0; i < 4; i += 1) checkRateLimit(rule, 'u1');
    assert.equal(checkRateLimit(other, 'u1').allowed, true);
  });

  test('resetRateLimits clears all counters', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    for (let i = 0; i < 4; i += 1) checkRateLimit(rule, 'u1');
    resetRateLimits();
    assert.equal(checkRateLimit(rule, 'u1').allowed, true);
  });
});

describe('enforceRateLimit', () => {
  test('returns the result while under the limit', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    assert.equal(enforceRateLimit(rule, 'u1').remaining, 2);
  });

  test('throws a 429 RATE_LIMITED ApiError carrying retryAfterSeconds', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    for (let i = 0; i < 3; i += 1) enforceRateLimit(rule, 'u1');
    assert.throws(
      () => enforceRateLimit(rule, 'u1'),
      (err: unknown) =>
        err instanceof ApiError &&
        err.code === 'RATE_LIMITED' &&
        err.status === 429 &&
        (err.details as { retryAfterSeconds: number }).retryAfterSeconds === 10,
    );
  });
});

describe('RATE_LIMITS config', () => {
  test('OTP guessing is tightly bounded per account', () => {
    assert.ok(RATE_LIMITS.otpRequest.limit <= 5);
    assert.ok(RATE_LIMITS.otpVerify.limit <= 10);
    assert.ok(RATE_LIMITS.otpVerify.windowMs >= 10 * 60_000);
  });
  test('rule names are unique so buckets never overlap', () => {
    const names = Object.values(RATE_LIMITS).map((r) => r.name);
    assert.equal(new Set(names).size, names.length);
  });
});

import 'server-only';

import { ApiError } from '@/lib/api';

/**
 * Fixed-window counter kept in process memory.
 *
 * This is sufficient for a single-node deployment and for development. A
 * multi-instance production deployment must swap this for a shared store
 * (Redis `INCR` + `EXPIRE`) — the call sites do not change.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Opportunistic sweep so the map cannot grow without bound.
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitRule {
  /** Identifier for the protected action, e.g. `otp:request`. */
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  otpRequest: { name: 'otp:request', limit: 5, windowMs: 15 * 60_000 },
  otpVerify: { name: 'otp:verify', limit: 10, windowMs: 15 * 60_000 },
  examEvent: { name: 'exam:event', limit: 240, windowMs: 60_000 },
  answerSave: { name: 'exam:answer', limit: 300, windowMs: 60_000 },
  examStart: { name: 'exam:start', limit: 10, windowMs: 10 * 60_000 },
  adminWrite: { name: 'admin:write', limit: 120, windowMs: 60_000 },
  read: { name: 'read', limit: 600, windowMs: 60_000 },
  // Uploads are far heavier than a JSON write, so they get their own, tighter
  // budget rather than sharing the generic ones.
  upload: { name: 'media:upload', limit: 40, windowMs: 10 * 60_000 },
} satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(rule: RateLimitRule, identifier: string): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const key = `${rule.name}:${identifier}`;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const allowed = existing.count <= rule.limit;
  return {
    allowed,
    remaining: Math.max(0, rule.limit - existing.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/** Throws a 429 `ApiError` when the caller has exceeded the rule. */
export function enforceRateLimit(rule: RateLimitRule, identifier: string) {
  const result = checkRateLimit(rule, identifier);
  if (!result.allowed) {
    throw new ApiError(
      'RATE_LIMITED',
      `Too many requests. Please try again in ${result.retryAfterSeconds} seconds.`,
      { retryAfterSeconds: result.retryAfterSeconds },
    );
  }
  return result;
}

/** Test/seed helper — clears all counters. */
export function resetRateLimits() {
  buckets.clear();
}

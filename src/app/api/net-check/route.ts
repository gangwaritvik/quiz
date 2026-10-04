import { randomBytes } from 'node:crypto';

import { ApiError, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Most a single check may download. */
const MAX_BYTES = 256 * 1024;

/**
 * Bytes for the pre-exam connection test: a small reply measures delay, a
 * larger one measures speed. The body is random so it cannot be compressed
 * away, and it is never cached.
 */
export const GET = route(async (request: Request) => {
  const session = await requireStudent();
  enforceRateLimit(RATE_LIMITS.examEvent, `net-check:${session.userId}`);

  const requested = Number(new URL(request.url).searchParams.get('size') ?? 0);
  if (!Number.isFinite(requested) || requested < 0) throw new ApiError('VALIDATION', 'Bad size.');
  const size = Math.min(Math.floor(requested), MAX_BYTES);

  return new Response(new Uint8Array(randomBytes(size)), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
    },
  });
});

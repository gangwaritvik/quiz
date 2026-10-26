import 'server-only';

import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type output } from 'zod';

/** Machine-readable error codes the client maps to specific recovery UI. */
export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'SESSION_EXPIRED'
  | 'DEVICE_MISMATCH'
  | 'ATTEMPT_EXPIRED'
  | 'PAUSED'
  | 'QUIZ_UNAVAILABLE'
  | 'CSRF'
  | 'SERVER_ERROR';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  SESSION_EXPIRED: 401,
  DEVICE_MISMATCH: 403,
  ATTEMPT_EXPIRED: 410,
  PAUSED: 423,
  QUIZ_UNAVAILABLE: 403,
  CSRF: 403,
  SERVER_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, { status: 200, ...init });
}

export function fail(error: ApiError) {
  return NextResponse.json(
    { ok: false, error: { code: error.code, message: error.message, details: error.details } },
    { status: error.status },
  );
}

/**
 * Wraps a route handler so every thrown error becomes a consistent envelope and
 * internal failures never leak stack traces to the client.
 */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) return fail(error);
      if (error instanceof ZodError) {
        return fail(
          new ApiError('VALIDATION', 'The submitted data is invalid.', error.flatten().fieldErrors),
        );
      }
      console.error('[api] unhandled error', error);
      return fail(new ApiError('SERVER_ERROR', 'Something went wrong on our side.'));
    }
  };
}

/**
 * CSRF defence for cookie-authenticated mutations: reject any state-changing
 * request whose Origin is not this deployment. Combined with SameSite=Lax
 * cookies this blocks the classic cross-site form/fetch attack.
 */
export function assertSameOrigin(request: Request) {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin) {
    // A same-origin fetch always sends Origin for non-GET; a missing header is
    // characteristic of a scripted or cross-site request.
    throw new ApiError('CSRF', 'Missing origin header on a state-changing request.');
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError('CSRF', 'Malformed origin header.');
  }
  if (!host || originHost !== host) {
    throw new ApiError('CSRF', 'Cross-origin request rejected.');
  }
}

/**
 * Generic over the schema rather than its type so that transformed and
 * defaulted fields resolve to their *output* types (a defaulted `page` is a
 * `number`, not `number | undefined`).
 */
export async function parseBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<output<S>> {
  let raw: unknown;
  try {
    const text = await request.text();
    // Postgres cannot store a NUL in text; reject it here rather than as a 500.
    if (/\\u0000/i.test(text)) throw new Error('nul');
    raw = JSON.parse(text);
  } catch {
    throw new ApiError('VALIDATION', 'Request body must be valid JSON without null characters.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(
      'VALIDATION',
      'The submitted data is invalid.',
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

export function parseQuery<S extends ZodTypeAny>(request: Request, schema: S): output<S> {
  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(
      'VALIDATION',
      'Invalid query parameters.',
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

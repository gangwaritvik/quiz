'use client';

import { getDeviceId } from '@/lib/client/device';

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
  | 'SERVER_ERROR'
  | 'NETWORK';

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[]>;

  constructor(code: ApiErrorCode, message: string, status: number, details?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** True for failures that are worth retrying rather than surfacing as fatal. */
  get isTransient() {
    return this.code === 'NETWORK' || this.status >= 500;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip the automatic one-shot session refresh on 401. */
  noRefresh?: boolean;
  /** Give up after this long and report a network error, instead of waiting on a stalled link. */
  timeoutMs?: number;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Coalesces concurrent 401s into a single refresh round-trip. */
async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/session', {
      credentials: 'same-origin',
      headers: { 'x-device-id': getDeviceId() },
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs, ...rest } = options;
  if (!timeoutMs) return request<T>(path, rest);
  // The timer covers the whole exchange, body included: a response that starts
  // and then stalls is as useless to an exam as one that never starts.
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await request<T>(path, { ...rest, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const { body, noRefresh, headers, ...rest } = options;
  const method = (rest.method ?? (body ? 'POST' : 'GET')).toUpperCase();

  const run = async () => {
    return fetch(path, {
      ...rest,
      method,
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        // Read by the server to derive the device fingerprint.
        'x-device-id': getDeviceId(),
        ...(headers as Record<string, string> | undefined),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };

  let response: Response;
  try {
    response = await run();
  } catch {
    throw new ApiClientError('NETWORK', 'Connection interrupted. Retrying…', 0);
  }

  // One transparent retry after re-minting the short-lived access token.
  if (response.status === 401 && !noRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) {
      try {
        response = await run();
      } catch {
        throw new ApiClientError('NETWORK', 'Connection interrupted. Retrying…', 0);
      }
    }
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (rest.signal?.aborted) throw new ApiClientError('NETWORK', 'Connection is too slow. Retrying…', 0);
    if (!response.ok) {
      throw new ApiClientError('SERVER_ERROR', 'The server returned an unexpected response.', response.status);
    }
    throw new ApiClientError('SERVER_ERROR', 'The server returned an unreadable response.', response.status);
  }

  const envelope = payload as
    | { ok: true; data: T }
    | { ok: false; error: { code: ApiErrorCode; message: string; details?: Record<string, string[]> } };

  if (!response.ok || !envelope.ok) {
    const error = 'error' in envelope ? envelope.error : undefined;
    throw new ApiClientError(
      error?.code ?? 'SERVER_ERROR',
      error?.message ?? 'Something went wrong.',
      response.status,
      error?.details,
    );
  }

  return envelope.data;
}

/**
 * Multipart upload.
 *
 * Separate from `apiFetch` because the browser must set `Content-Type` itself:
 * it has to append the multipart boundary, and overriding the header would
 * produce a body the server cannot parse.
 */
export async function apiUpload<T>(path: string, form: FormData, timeoutMs = 120_000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await upload<T>(path, form, controller.signal);
  } finally {
    window.clearTimeout(timer);
  }
}

async function upload<T>(path: string, form: FormData, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-device-id': getDeviceId() },
      body: form,
      signal,
    });
  } catch {
    throw new ApiClientError(
      'NETWORK',
      signal.aborted ? 'The upload is taking too long. Check your connection and try again.' : 'Connection interrupted. Retrying…',
      0,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (signal.aborted) {
      throw new ApiClientError('NETWORK', 'The upload is taking too long. Check your connection and try again.', 0);
    }
    throw new ApiClientError(
      'SERVER_ERROR',
      'The server returned an unexpected response.',
      response.status,
    );
  }

  const envelope = payload as
    | { ok: true; data: T }
    | { ok: false; error: { code: ApiErrorCode; message: string } };

  if (!response.ok || !envelope.ok) {
    const error = 'error' in envelope ? envelope.error : undefined;
    throw new ApiClientError(
      error?.code ?? 'SERVER_ERROR',
      error?.message ?? 'We could not upload that file.',
      response.status,
    );
  }

  return envelope.data;
}

/**
 * Fire-and-forget POST that survives page unload — used to flush the last
 * security events when a student closes the tab mid-exam.
 */
export function apiBeacon(path: string, body: unknown): boolean {
  if (typeof navigator === 'undefined' || !('sendBeacon' in navigator)) return false;
  try {
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
    return navigator.sendBeacon(path, blob);
  } catch {
    return false;
  }
}

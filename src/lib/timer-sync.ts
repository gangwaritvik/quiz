import { pluralize } from '@/lib/utils';

/**
 * Pure arithmetic behind the exam countdown, kept out of the React hook so it
 * can be tested. Nothing here adds time by itself: every number comes from a
 * server response.
 */

/** A local/server disagreement smaller than this is jitter, not a real change. */
export const JITTER_MS = 2_000;

/**
 * Where the browser-clock deadline should sit after a server response.
 *
 * The server's remaining time wins, whether it went up (faculty added time) or
 * down (our clock ran slow). The one exception is jitter: if the countdown is
 * still running and the server agrees to within `jitterMs`, the current
 * deadline is kept so the digits do not skip. Expiry is never smoothed away —
 * a server "0", or a local timer already at zero while the server still has
 * time left, is adopted at once.
 */
export function nextDeadline(
  current: number | null,
  clientNow: number,
  serverRemainingMs: number,
  jitterMs = JITTER_MS,
): number {
  const remaining = Math.max(0, serverRemainingMs);
  const fromServer = clientNow + remaining;
  if (current === null) return fromServer;

  const bothRunning = current > clientNow && remaining > 0;
  return bothRunning && Math.abs(fromServer - current) < jitterMs ? current : fromServer;
}

/**
 * The student's total extension in minutes. The field may sit on the response
 * or inside its `timer` block; a missing, negative or non-numeric value is 0.
 */
export function readExtraMinutes(response: {
  extraMinutes?: unknown;
  timer?: { extraMinutes?: unknown } | null;
}): number {
  const raw = response.extraMinutes ?? response.timer?.extraMinutes;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * Compares a response's extension with the last known one. `known` is null
 * until the first fetch, which only sets the baseline (`added` stays 0) so a
 * page load never announces an extension the student already had.
 */
export function extensionAdded(
  known: number | null,
  reported: number,
): { known: number; added: number } {
  return { known: reported, added: known === null ? 0 : Math.max(0, reported - known) };
}

export function extensionMessage(minutes: number, endsAtLabel: string): string {
  return `Your faculty added ${pluralize(minutes, 'minute')}. Your timer now ends at ${endsAtLabel}.`;
}

'use client';

import * as React from 'react';

import { nextDeadline } from '@/lib/timer-sync';

export interface TimerSync {
  remainingMs: number;
  expiresAt: string;
  serverNow: string;
  /** This attempt's total faculty extension. Absent (older server) means none. */
  extraMinutes?: number;
}

export interface ExamTimer {
  remainingMs: number;
  remainingSeconds: number;
  /** Under five minutes. */
  warning: boolean;
  /** Under one minute. */
  critical: boolean;
  expired: boolean;
  sync: (next: TimerSync) => void;
}

/**
 * Displays the server's clock, never the browser's.
 *
 * The browser clock is used only to interpolate between syncs so the digits
 * tick smoothly. Every server response re-anchors the countdown, and clock
 * drift or a manually changed system time is corrected on the next beat.
 * The server's number is followed both ways: time faculty add arrives as a
 * larger `remainingMs` and is adopted on the next response, while the hook
 * itself never adds time. Differences under two seconds are ignored so the
 * digits do not skip (see `nextDeadline`). The warning and critical bands are
 * derived from the remaining time on every render, so a larger number moves
 * them back out of the red with no latch to clear.
 * Reaching zero here triggers submission for a tidy user experience — but the
 * server independently refuses late answers regardless of what this shows.
 * `onExpire` receives the last remaining time the server reported, so the
 * caller can confirm with the server before submitting a possibly extended
 * attempt.
 */
export function useExamTimer(
  initial: TimerSync | null,
  onExpire?: (lastServerRemainingMs: number | null) => void,
): ExamTimer {
  // The wall-clock instant, in *browser* time, at which the server's deadline
  // falls. Recomputed on every sync from the server's own remaining time.
  const deadlineRef = React.useRef<number | null>(null);
  const lastServerRemainingRef = React.useRef<number | null>(null);
  const [remainingMs, setRemainingMs] = React.useState(initial?.remainingMs ?? 0);
  const expiredRef = React.useRef(false);
  const onExpireRef = React.useRef(onExpire);

  React.useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  const sync = React.useCallback((next: TimerSync) => {
    // Remaining time is authoritative; the absolute timestamps are not used,
    // because they would trust the browser's clock.
    const now = Date.now();
    const deadline = nextDeadline(deadlineRef.current, now, next.remainingMs);
    deadlineRef.current = deadline;
    lastServerRemainingRef.current = next.remainingMs;

    const remaining = Math.max(0, deadline - now);
    setRemainingMs(remaining);
    if (remaining > 0) expiredRef.current = false;
  }, []);

  React.useEffect(() => {
    if (initial) sync(initial);
  }, [initial, sync]);

  React.useEffect(() => {
    const tick = () => {
      const deadline = deadlineRef.current;
      if (deadline === null) return;

      const next = Math.max(0, deadline - Date.now());
      setRemainingMs(next);

      if (next <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpireRef.current?.(lastServerRemainingRef.current);
      }
    };

    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, []);

  const remainingSeconds = Math.ceil(remainingMs / 1000);

  return {
    remainingMs,
    remainingSeconds,
    warning: remainingMs > 60_000 && remainingMs <= 5 * 60_000,
    critical: remainingMs > 0 && remainingMs <= 60_000,
    expired: remainingMs <= 0,
    sync,
  };
}

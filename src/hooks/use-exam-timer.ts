'use client';

import * as React from 'react';

export interface TimerSync {
  remainingMs: number;
  expiresAt: string;
  serverNow: string;
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
 * Reaching zero here triggers submission for a tidy user experience — but the
 * server independently refuses late answers regardless of what this shows.
 */
export function useExamTimer(initial: TimerSync | null, onExpire?: () => void): ExamTimer {
  // The wall-clock instant, in *browser* time, at which the server's deadline
  // falls. Recomputed on every sync from the server's own "now".
  const deadlineRef = React.useRef<number | null>(null);
  const [remainingMs, setRemainingMs] = React.useState(initial?.remainingMs ?? 0);
  const expiredRef = React.useRef(false);
  const onExpireRef = React.useRef(onExpire);

  React.useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  const sync = React.useCallback((next: TimerSync) => {
    // Anchor to the round-trip's arrival: remaining time is authoritative, the
    // absolute timestamps are only used for sanity.
    deadlineRef.current = Date.now() + next.remainingMs;
    setRemainingMs(next.remainingMs);
    if (next.remainingMs > 0) expiredRef.current = false;
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
        onExpireRef.current?.();
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

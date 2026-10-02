/*
 * Per-student time extensions: the arithmetic, kept pure so the rules that
 * decide when a student's clock stops (and when scores unlock) can be tested
 * without a database.
 *
 * The server stays the only clock. An extension moves one attempt's
 * `expiresAt`; nothing the client sends can.
 */

/** Most minutes one grant may add (live) or set (before the student starts). */
export const MAX_EXTENSION_MINUTES = 120;
/** Most extra minutes one attempt may accumulate across every grant. */
export const MAX_TOTAL_EXTENSION_MINUTES = 180;

const MINUTE_MS = 60_000;

/**
 * When a new attempt's clock stops: the quiz duration plus the student's extra
 * time, but never later than the window's end plus that same extra time. So an
 * extended student who starts near the close gets their allowance past the
 * window, and a student with none is cut off at the window as before.
 */
export function computeExpiresAt(
  startedAt: Date,
  quiz: { durationMinutes: number; endsAt: Date },
  extraMinutes: number,
): Date {
  const extraMs = extraMinutes * MINUTE_MS;
  return new Date(
    Math.min(
      startedAt.getTime() + quiz.durationMinutes * MINUTE_MS + extraMs,
      quiz.endsAt.getTime() + extraMs,
    ),
  );
}

/**
 * When the exam is really over for everyone: the window's end plus the largest
 * extension granted on the quiz. Scores stay hidden until then, otherwise an
 * early finisher could relay answers to a student still sitting on extra time.
 */
export function effectiveEndsAt(quiz: { endsAt: Date; maxExtensionMinutes: number }): Date {
  return new Date(quiz.endsAt.getTime() + quiz.maxExtensionMinutes * MINUTE_MS);
}

/** Why a live grant would be refused, or null when it is allowed. */
export function extensionRefusal(currentExtra: number, minutes: number): string | null {
  if (currentExtra + minutes > MAX_TOTAL_EXTENSION_MINUTES) {
    return `Total extra time on one attempt is limited to ${MAX_TOTAL_EXTENSION_MINUTES} minutes.`;
  }
  return null;
}

/** An attempt's deadline after adding `minutes`. */
export function extendExpiresAt(expiresAt: Date, minutes: number): Date {
  return new Date(expiresAt.getTime() + minutes * MINUTE_MS);
}

/**
 * The deadline an attempt effectively has right now. While faculty have it
 * paused the clock is frozen, so the deadline slips forward by however long it
 * has been paused; on resume that slip is written into `expiresAt` for good.
 */
export function pauseAdjustedExpiresAt(
  expiresAt: Date,
  pausedAt: Date | null | undefined,
  now = new Date(),
): Date {
  if (!pausedAt) return expiresAt;
  return new Date(expiresAt.getTime() + Math.max(0, now.getTime() - pausedAt.getTime()));
}

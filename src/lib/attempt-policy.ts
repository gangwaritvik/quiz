/*
 * How many attempts a student may make at a quiz, and which attempt counts when
 * they have made several. Pure, so the same rule is used by the start route,
 * the student pages and the faculty grant screen.
 */

/** Most extra attempts faculty can grant one student on one quiz. */
export const MAX_EXTRA_ATTEMPTS = 3;

/**
 * Whether the student may begin another attempt. A quiz that allows several
 * attempts never runs out; a single-attempt quiz allows one, plus whatever
 * faculty granted this student.
 */
export function canStartAnother(
  quiz: { singleAttempt: boolean },
  extraAttempts: number,
  attemptsMade: number,
): boolean {
  return !quiz.singleAttempt || attemptsMade < 1 + extraAttempts;
}

/**
 * The extra-attempts figure after one more is granted: always one above what
 * the student has already used, so a grant is a real, unused attempt however
 * many were granted before.
 */
export function grantOne(extraAttempts: number, attemptsMade: number): number {
  return Math.min(MAX_EXTRA_ATTEMPTS, Math.max(extraAttempts, attemptsMade - 1) + 1);
}

/** Takes back grants the student has not used yet. */
export function revokeUnused(extraAttempts: number, attemptsMade: number): number {
  return Math.min(extraAttempts, Math.max(0, attemptsMade - 1));
}

/**
 * Keeps each student's best-scoring row (the first, on a tie). Averages and
 * rankings use this so a retake does not count a student twice.
 */
export function bestPerStudent<T>(
  rows: T[],
  key: (row: T) => string,
  score: (row: T) => number | null,
): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const k = key(row);
    const current = best.get(k);
    if (!current || (score(row) ?? -Infinity) > (score(current) ?? -Infinity)) best.set(k, row);
  }
  return [...best.values()];
}

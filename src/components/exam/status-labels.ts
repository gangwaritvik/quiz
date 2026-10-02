/*
 * Student-facing wording for the exam header chip and the question grid.
 * Kept free of React and UI imports so `npm test` can import it.
 */

export interface ActivityCounters {
  tabSwitches: number;
  fullscreenExits: number;
  blurEvents: number;
  copyPasteAttempts: number;
}

export const FACULTY_REVIEW_NOTE = 'Your faculty can review recorded events after the exam';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Per-type counts of what has been recorded so far; empty when nothing has. */
export function recordedEvents(c: ActivityCounters): string[] {
  const parts: string[] = [];
  if (c.tabSwitches) parts.push(plural(c.tabSwitches, 'tab switch', 'tab switches'));
  if (c.fullscreenExits) parts.push(plural(c.fullscreenExits, 'fullscreen exit'));
  if (c.copyPasteAttempts) parts.push(plural(c.copyPasteAttempts, 'clipboard attempt'));
  if (c.blurEvents) parts.push(plural(c.blurEvents, 'focus change'));
  return parts;
}

/** Neutral monitoring copy: states what is happening, never judges or guarantees. */
export function monitoringStatus(c: ActivityCounters) {
  const parts = recordedEvents(c);
  return parts.length === 0
    ? { recorded: false, label: 'Exam monitoring is on', detail: 'Nothing recorded this session' }
    : { recorded: true, label: `${parts.join(' · ')} recorded`, detail: FACULTY_REVIEW_NOTE };
}

/**
 * Full accessible name for a question button, so answered and flagged are both
 * announced: "Question 4, answered, marked for review, current question".
 */
export function questionLabel(
  number: number,
  q: { answered: boolean; markedForReview: boolean },
  opts: { locked?: boolean; current?: boolean } = {},
): string {
  const parts = [`Question ${number}`];
  if (opts.locked) {
    parts.push('not yet accessible');
  } else {
    parts.push(q.answered ? 'answered' : 'not answered');
    if (q.markedForReview) parts.push('marked for review');
  }
  if (opts.current) parts.push('current question');
  return parts.join(', ');
}

/**
 * Pure helpers for marking one question across every student's paper.
 *
 * Free of Prisma and of `server-only` so the route that builds the lists and
 * the client that steps through them share one definition of ordering, blind
 * labels and "what is the next unmarked answer" — and so node:test can cover it.
 */

/** Most answers one question view will return; the rest are flagged `truncated`. */
export const MAX_ANSWERS = 200;

/** One line of plain text for list rows: whitespace collapsed, cut on a word. */
export function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export interface AnswerStat {
  questionId: string;
  /** Position on the student's own paper (differs per student when shuffled). */
  position: number;
  marks: number;
  marked: boolean;
}

export interface QuestionStat {
  questionId: string;
  maxMarks: number;
  pending: number;
  total: number;
}

/**
 * Collapses answer rows into one entry per question, in paper order.
 *
 * `quizOrder` is the quiz's own question order where it has one; questions
 * drawn from a pool have none, so they follow by the earliest position any
 * student saw them at. The question id breaks remaining ties, so the order
 * never changes between requests.
 */
export function summariseQuestions(
  rows: readonly AnswerStat[],
  quizOrder: ReadonlyMap<string, number> = new Map(),
): QuestionStat[] {
  const byQuestion = new Map<string, QuestionStat & { firstPosition: number }>();

  for (const row of rows) {
    const entry = byQuestion.get(row.questionId) ?? {
      questionId: row.questionId,
      maxMarks: row.marks,
      pending: 0,
      total: 0,
      firstPosition: row.position,
    };
    entry.maxMarks = Math.max(entry.maxMarks, row.marks);
    entry.firstPosition = Math.min(entry.firstPosition, row.position);
    entry.total += 1;
    if (!row.marked) entry.pending += 1;
    byQuestion.set(row.questionId, entry);
  }

  const orderOf = (id: string) => quizOrder.get(id) ?? Number.POSITIVE_INFINITY;

  return [...byQuestion.values()]
    .sort((a, b) => {
      const quiz = orderOf(a.questionId) - orderOf(b.questionId);
      // Infinity - Infinity is NaN, so compare explicitly.
      if (quiz !== 0 && !Number.isNaN(quiz)) return quiz;
      return a.firstPosition - b.firstPosition || a.questionId.localeCompare(b.questionId);
    })
    .map(({ questionId, maxMarks, pending, total }) => ({ questionId, maxMarks, pending, total }));
}

/**
 * Orders answers by submission time (then id) and names them "Answer 1…n".
 *
 * The label is a function of the whole set, never of the filter applied after
 * it, so "Answer 3" stays the same answer whether or not marked ones are shown.
 * It identifies nobody, which is the point: it is what a marker sees until
 * they choose to reveal the student.
 */
export function labelAnswers<T extends { answerId: string; submittedAt: string | null }>(
  rows: readonly T[],
): Array<T & { blindLabel: string }> {
  return [...rows]
    .sort((a, b) => {
      // ISO-8601 UTC strings sort chronologically; a missing time sorts last.
      if (a.submittedAt !== b.submittedAt) {
        if (a.submittedAt === null) return 1;
        if (b.submittedAt === null) return -1;
        return a.submittedAt < b.submittedAt ? -1 : 1;
      }
      return a.answerId.localeCompare(b.answerId);
    })
    .map((row, index) => ({ ...row, blindLabel: `Answer ${index + 1}` }));
}

/**
 * Index of the next unmarked item after `from`, wrapping round to the start;
 * -1 when there is none. `from` itself is never returned, so pass -1 to ask
 * for the first unmarked item, or the current index to ask for "another one".
 */
export function nextUnmarked(items: ReadonlyArray<{ gradedAt: string | null }>, from: number): number {
  const count = items.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (((from + step) % count) + count) % count;
    if (index !== from && items[index]?.gradedAt === null) return index;
  }
  return -1;
}

/** The next question (wrapping) that still has answers to mark, or null. */
export function nextQuestionWithPending<T extends { questionId: string; pending: number }>(
  questions: readonly T[],
  currentId: string,
): T | null {
  const from = questions.findIndex((q) => q.questionId === currentId);
  for (let step = 1; step <= questions.length; step += 1) {
    const candidate = questions[(from + step + questions.length) % questions.length];
    if (candidate && candidate.questionId !== currentId && candidate.pending > 0) return candidate;
  }
  return null;
}

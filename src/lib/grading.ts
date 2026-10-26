import type { QuestionType } from '@prisma/client';

/**
 * The grading rules, as pure functions.
 *
 * Deliberately free of Prisma and of `server-only` so the seed script and any
 * future test suite grade through exactly the same code the exam does — the
 * same reasoning that keeps `integrity-engine.ts` separate from `integrity.ts`.
 *
 * Nothing here reads or writes; callers supply the correct answers and receive
 * a verdict.
 */

/** Types whose answer is one or more options from a fixed list. */
export const OPTION_TYPES: ReadonlySet<QuestionType> = new Set<QuestionType>([
  'MCQ_SINGLE',
  'TRUE_FALSE',
  'ASSERTION_REASON',
  'MCQ_MULTI',
]);

/** Types where the student writes prose. */
export const TEXT_TYPES: ReadonlySet<QuestionType> = new Set<QuestionType>([
  'SHORT_ANSWER',
  'LONG_ANSWER',
]);

/** Types no server can mark — they go to a human. */
export const MANUAL_TYPES: ReadonlySet<QuestionType> = new Set<QuestionType>([
  'LONG_ANSWER',
  'IMAGE_ANSWER',
]);

/**
 * Types whose option order is prescribed and must never be shuffled.
 *
 * The assertion–reason answer set is a convention students are taught: "(A)"
 * always means both statements are true with R explaining A. Randomising it
 * makes every question harder to read for no security benefit — the options
 * are identical on every such question, so their order reveals nothing.
 * True/False is included for the same reason.
 */
export const FIXED_OPTION_ORDER_TYPES: ReadonlySet<QuestionType> = new Set<QuestionType>([
  'TRUE_FALSE',
  'ASSERTION_REASON',
]);

export interface GradableQuestion {
  type: QuestionType;
  /** Marks for this question *on this paper* — taken from AttemptQuestion. */
  marks: number;
  negativeMarks: number;
  partialCredit: boolean;
  acceptedAnswers: string[];
  caseSensitive: boolean;
  numericTolerance: number | null;
  correctOptionIds: string[];
}

export interface StudentResponse {
  selectedOptionId: string | null;
  selectedOptionIds: string[];
  textResponse: string | null;
  attachmentCount: number;
}

export type GradeOutcome =
  /** Nothing was submitted for this question. */
  | { state: 'UNANSWERED'; awardedMarks: number; isCorrect: null }
  /** Marked by the server. */
  | { state: 'AUTO'; awardedMarks: number; isCorrect: boolean }
  /** Answered, but only a person can mark it. */
  | { state: 'MANUAL'; awardedMarks: null; isCorrect: null };

// ---------------------------------------------------------------------------
// Free-text comparison
// ---------------------------------------------------------------------------

/**
 * Normalises a written answer before comparison: trims, collapses runs of
 * whitespace, and optionally folds case.
 *
 * Deliberately conservative — it does not strip punctuation or attempt
 * stemming. An over-eager normaliser marks wrong answers correct, which is a
 * far worse failure in an examination than asking faculty to list a couple of
 * accepted spellings.
 */
export function normalizeAnswerText(value: string, caseSensitive: boolean): string {
  const collapsed = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  return caseSensitive ? collapsed : collapsed.toLowerCase();
}

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** A whole-string number: "2abc" and "2/3" are not numbers. */
function parseNumber(text: string): number {
  const trimmed = text.trim();
  return PLAIN_NUMBER.test(trimmed) ? Number(trimmed) : Number.NaN;
}

function numericallyMatches(response: string, accepted: string, tolerance: number): boolean {
  const given = parseNumber(response);
  const expected = parseNumber(accepted);
  if (!Number.isFinite(given) || !Number.isFinite(expected)) return false;
  // 1e-9 absorbs floating-point error: 3.14 - 3.13 is 0.010000000000000231, which is not above 0.01.
  return Math.abs(given - expected) <= tolerance + 1e-9;
}

/**
 * True when the response matches any accepted answer. With a tolerance set the
 * comparison is numeric, so `3.14` can satisfy an expected `3.14159`.
 */
export function matchesAcceptedAnswer(
  response: string,
  question: Pick<GradableQuestion, 'acceptedAnswers' | 'caseSensitive' | 'numericTolerance'>,
): boolean {
  const trimmed = response.trim();
  if (trimmed.length === 0) return false;

  if (question.numericTolerance !== null && question.numericTolerance >= 0) {
    if (
      question.acceptedAnswers.some((accepted) =>
        numericallyMatches(trimmed, accepted, question.numericTolerance as number),
      )
    ) {
      return true;
    }
  }

  const normalized = normalizeAnswerText(trimmed, question.caseSensitive);
  return question.acceptedAnswers.some(
    (accepted) => normalizeAnswerText(accepted, question.caseSensitive) === normalized,
  );
}

// ---------------------------------------------------------------------------
// Response presence
// ---------------------------------------------------------------------------

/** Whether the student put anything at all against this question. */
export function hasResponse(type: QuestionType, response: StudentResponse): boolean {
  if (type === 'MCQ_MULTI') return response.selectedOptionIds.length > 0;
  if (OPTION_TYPES.has(type)) return Boolean(response.selectedOptionId);
  if (type === 'IMAGE_ANSWER') {
    return response.attachmentCount > 0 || Boolean(response.textResponse?.trim());
  }
  return Boolean(response.textResponse?.trim());
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/** Rounds to two decimals so partial credit does not produce 0.6666666667. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A deduction as a score: zero stays +0, never -0. */
function penalty(negativeMarks: number): number {
  return negativeMarks === 0 ? 0 : -negativeMarks;
}

/** A quiz-wide marking scheme; `null` leaves each question's own setting alone. */
export interface QuizMarking {
  /** Percent of a question's marks lost on a wrong answer (25 = lose a quarter). */
  negativeMarkingPct: number | null;
  /** Whether multi-select questions give credit for a correct subset. */
  multiPartialCredit: boolean | null;
}

/**
 * The negative marks and partial-credit setting a question is graded with: the
 * quiz's scheme where it has one, the question's own otherwise. The penalty is
 * a share of the marks this question carries on this paper.
 */
export function effectiveMarking(
  question: { negativeMarks: number; partialCredit: boolean },
  marks: number,
  quiz: QuizMarking,
): { negativeMarks: number; partialCredit: boolean } {
  return {
    negativeMarks:
      quiz.negativeMarkingPct === null
        ? question.negativeMarks
        : round2((marks * quiz.negativeMarkingPct) / 100),
    partialCredit: quiz.multiPartialCredit ?? question.partialCredit,
  };
}

function gradeSingleOption(
  question: GradableQuestion,
  selectedOptionId: string,
): GradeOutcome {
  const isCorrect = question.correctOptionIds.includes(selectedOptionId);
  return {
    state: 'AUTO',
    isCorrect,
    awardedMarks: isCorrect ? question.marks : penalty(question.negativeMarks),
  };
}

/**
 * Multi-select scoring.
 *
 * Selecting any incorrect option scores the negative mark outright — otherwise
 * a student could tick every box and collect partial credit on every question.
 * A subset of the correct options with no incorrect ones scores proportionally
 * when the question allows it.
 */
function gradeMultiOption(question: GradableQuestion, selected: string[]): GradeOutcome {
  const correct = new Set(question.correctOptionIds);
  const chosen = new Set(selected);

  const anyIncorrect = [...chosen].some((id) => !correct.has(id));
  if (anyIncorrect) {
    return { state: 'AUTO', isCorrect: false, awardedMarks: penalty(question.negativeMarks) };
  }

  if (correct.size > 0 && chosen.size === correct.size) {
    return { state: 'AUTO', isCorrect: true, awardedMarks: question.marks };
  }

  if (question.partialCredit && correct.size > 0) {
    return {
      state: 'AUTO',
      isCorrect: false,
      awardedMarks: round2((question.marks * chosen.size) / correct.size),
    };
  }

  return { state: 'AUTO', isCorrect: false, awardedMarks: 0 };
}

export function gradeAnswer(
  question: GradableQuestion,
  response: StudentResponse,
): GradeOutcome {
  if (!hasResponse(question.type, response)) {
    return { state: 'UNANSWERED', awardedMarks: 0, isCorrect: null };
  }

  // Answered, but the marking is a judgement call.
  if (MANUAL_TYPES.has(question.type)) {
    return { state: 'MANUAL', awardedMarks: null, isCorrect: null };
  }

  if (question.type === 'MCQ_MULTI') {
    return gradeMultiOption(question, response.selectedOptionIds);
  }

  if (OPTION_TYPES.has(question.type)) {
    return gradeSingleOption(question, response.selectedOptionId as string);
  }

  if (question.type === 'SHORT_ANSWER') {
    const isCorrect = matchesAcceptedAnswer(response.textResponse ?? '', question);
    return {
      state: 'AUTO',
      isCorrect,
      awardedMarks: isCorrect ? question.marks : penalty(question.negativeMarks),
    };
  }

  // Unreachable for known types; treated as unmarkable rather than as zero so
  // a future type cannot silently score every student nothing.
  return { state: 'MANUAL', awardedMarks: null, isCorrect: null };
}

// ---------------------------------------------------------------------------
// Standard option sets
// ---------------------------------------------------------------------------

/**
 * The conventional assertion–reason answer set, in the order examiners expect.
 * Generated as ordinary options so grading needs no special case — the type
 * only changes how the stem is presented.
 */
export const ASSERTION_REASON_OPTIONS = [
  'Both A and R are true, and R is the correct explanation of A',
  'Both A and R are true, but R is not the correct explanation of A',
  'A is true, but R is false',
  'A is false, but R is true',
  'Both A and R are false',
] as const;

export const TRUE_FALSE_OPTIONS = ['True', 'False'] as const;

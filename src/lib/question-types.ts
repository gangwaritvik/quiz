/**
 * Display metadata for question types.
 *
 * Free of `server-only` and of Prisma imports so the question bank, the
 * editor, the grading queue and the results view all name a type identically.
 */

export type QuestionTypeValue =
  | 'MCQ_SINGLE'
  | 'MCQ_MULTI'
  | 'TRUE_FALSE'
  | 'ASSERTION_REASON'
  | 'SHORT_ANSWER'
  | 'LONG_ANSWER'
  | 'IMAGE_ANSWER';

export const QUESTION_TYPE_LABEL: Record<QuestionTypeValue, string> = {
  MCQ_SINGLE: 'Multiple choice',
  MCQ_MULTI: 'Multiple select',
  TRUE_FALSE: 'True / False',
  ASSERTION_REASON: 'Assertion & Reason',
  SHORT_ANSWER: 'Short answer',
  LONG_ANSWER: 'Descriptive',
  IMAGE_ANSWER: 'Image upload',
};

/** Shown under the type picker so an author knows what they are choosing. */
export const QUESTION_TYPE_HINT: Record<QuestionTypeValue, string> = {
  MCQ_SINGLE: 'One correct option. Marked automatically.',
  MCQ_MULTI: 'Several correct options, with optional partial credit. Marked automatically.',
  TRUE_FALSE: 'A fixed two-option question. Marked automatically.',
  ASSERTION_REASON:
    'An assertion and a reason, answered with the standard five-option set. Marked automatically.',
  SHORT_ANSWER: 'A word, phrase or number matched against the answers you list. Marked automatically.',
  LONG_ANSWER: 'Written prose. You mark this yourself after the exam.',
  IMAGE_ANSWER: 'A photograph of written work. You mark this yourself after the exam.',
};

export const QUESTION_TYPE_ORDER: QuestionTypeValue[] = [
  'MCQ_SINGLE',
  'MCQ_MULTI',
  'TRUE_FALSE',
  'ASSERTION_REASON',
  'SHORT_ANSWER',
  'LONG_ANSWER',
  'IMAGE_ANSWER',
];

/** Types whose answer is chosen from a list of options. */
export const OPTION_BASED_TYPES: QuestionTypeValue[] = [
  'MCQ_SINGLE',
  'MCQ_MULTI',
  'TRUE_FALSE',
  'ASSERTION_REASON',
];

/** Types a person has to mark. */
export const MANUALLY_MARKED_TYPES: QuestionTypeValue[] = ['LONG_ANSWER', 'IMAGE_ANSWER'];

export function isOptionBased(type: QuestionTypeValue): boolean {
  return OPTION_BASED_TYPES.includes(type);
}

export function isManuallyMarked(type: QuestionTypeValue): boolean {
  return MANUALLY_MARKED_TYPES.includes(type);
}

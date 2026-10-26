// Lab 10: black-box test cases (equivalence partitioning + boundary value analysis).
// Test IDs match the table in the lab record: UT01..UT30.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ZodTypeAny } from 'zod';

import { canStartAnother, grantOne, MAX_EXTRA_ATTEMPTS } from '@/lib/attempt-policy';
import {
  effectiveMarking,
  gradeAnswer,
  TRUE_FALSE_OPTIONS,
  type GradableQuestion,
  type StudentResponse,
} from '@/lib/grading';
import { computeExpiresAt, extensionRefusal } from '@/lib/time-extension';
import { createQuestionSchema, createStudentSchema } from '@/lib/validation';

const ok = (schema: ZodTypeAny, value: unknown) => schema.safeParse(value).success;
const id = `c${'1'.padStart(24, '0')}`;

const question = (over: Partial<GradableQuestion> = {}): GradableQuestion => ({
  type: 'MCQ_SINGLE', marks: 4, negativeMarks: 1, partialCredit: false,
  acceptedAnswers: [], caseSensitive: false, numericTolerance: null, correctOptionIds: ['a'], ...over,
});
const answer = (over: Partial<StudentResponse> = {}): StudentResponse => ({
  selectedOptionId: null, selectedOptionIds: [], textResponse: null, attachmentCount: 0, ...over,
});
const mcq = (over: Record<string, unknown> = {}) => ({
  subjectId: id, text: 'Pick the prime number',
  options: [{ text: '4', isCorrect: false }, { text: '7', isCorrect: true }], ...over,
});
const options = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ text: `Option ${i + 1}`, isCorrect: i === 0 }));

describe('Automatic marking (equivalence classes of a student response)', () => {
  test('UT01 single choice, correct option -> full marks', () => {
    const g = gradeAnswer(question(), answer({ selectedOptionId: 'a' }));
    assert.deepEqual([g.isCorrect, g.awardedMarks], [true, 4]);
  });
  test('UT02 single choice, wrong option -> negative marks', () => {
    const g = gradeAnswer(question(), answer({ selectedOptionId: 'b' }));
    assert.deepEqual([g.isCorrect, g.awardedMarks], [false, -1]);
  });
  test('UT03 no response -> unanswered, 0 marks', () => {
    const g = gradeAnswer(question(), answer());
    assert.deepEqual([g.state, g.awardedMarks], ['UNANSWERED', 0]);
  });
  test('UT04 multi-select, all correct options -> full marks', () => {
    const q = question({ type: 'MCQ_MULTI', correctOptionIds: ['a', 'b'], partialCredit: true });
    assert.equal(gradeAnswer(q, answer({ selectedOptionIds: ['a', 'b'] })).awardedMarks, 4);
  });
  test('UT05 multi-select, 1 of 2 correct with partial credit -> 2 marks', () => {
    const q = question({ type: 'MCQ_MULTI', correctOptionIds: ['a', 'b'], partialCredit: true });
    assert.equal(gradeAnswer(q, answer({ selectedOptionIds: ['a'] })).awardedMarks, 2);
  });
  test('UT06 multi-select, 1 of 2 correct without partial credit -> 0 marks', () => {
    const q = question({ type: 'MCQ_MULTI', correctOptionIds: ['a', 'b'], partialCredit: false });
    assert.equal(gradeAnswer(q, answer({ selectedOptionIds: ['a'] })).awardedMarks, 0);
  });
  test('UT07 multi-select, one wrong option ticked -> negative marks', () => {
    const q = question({ type: 'MCQ_MULTI', correctOptionIds: ['a', 'b'], partialCredit: true });
    assert.equal(gradeAnswer(q, answer({ selectedOptionIds: ['a', 'c'] })).awardedMarks, -1);
  });
  test('UT08 long answer is sent to a person for marking', () => {
    const g = gradeAnswer(question({ type: 'LONG_ANSWER' }), answer({ textResponse: 'An essay' }));
    assert.equal(g.state, 'MANUAL');
  });
});

describe('Short numeric answer: boundary of the tolerance (3.14 +/- 0.01)', () => {
  const q = question({ type: 'SHORT_ANSWER', acceptedAnswers: ['3.14'], numericTolerance: 0.01 });
  const mark = (text: string) => gradeAnswer(q, answer({ textResponse: text })).isCorrect;
  test('UT09 3.14 (exact) is correct', () => assert.equal(mark('3.14'), true));
  test('UT10 3.15 (on the upper boundary) is correct', () => assert.equal(mark('3.15'), true));
  test('UT11 3.16 (just outside) is wrong', () => assert.equal(mark('3.16'), false));
  test('UT12 3.13 (on the lower boundary) is correct', () => assert.equal(mark('3.13'), true));
  test('UT13 text answers ignore case and extra spaces', () => {
    const t = question({ type: 'SHORT_ANSWER', acceptedAnswers: ['structured query language'] });
    assert.equal(gradeAnswer(t, answer({ textResponse: '  Structured   QUERY Language ' })).isCorrect, true);
  });
});

describe('Quiz-wide negative marking', () => {
  test('UT14 25% of a 4-mark question is 1 mark', () => {
    const m = effectiveMarking({ negativeMarks: 0, partialCredit: true }, 4, { negativeMarkingPct: 25, multiPartialCredit: null });
    assert.equal(m.negativeMarks, 1);
  });
  test('UT15 no quiz-wide scheme leaves the question settings alone', () => {
    const m = effectiveMarking({ negativeMarks: 0.5, partialCredit: true }, 4, { negativeMarkingPct: null, multiPartialCredit: null });
    assert.deepEqual(m, { negativeMarks: 0.5, partialCredit: true });
  });
});

describe('Question form: marks 1..20, options 2..6', () => {
  test('UT16 marks 0 rejected, 1 accepted (lower boundary)', () => {
    assert.equal(ok(createQuestionSchema, mcq({ marks: 0 })), false);
    assert.equal(ok(createQuestionSchema, mcq({ marks: 1 })), true);
  });
  test('UT17 marks 20 accepted, 21 rejected (upper boundary)', () => {
    assert.equal(ok(createQuestionSchema, mcq({ marks: 20 })), true);
    assert.equal(ok(createQuestionSchema, mcq({ marks: 21 })), false);
  });
  test('UT18 negative marks may equal the marks but not exceed them', () => {
    assert.equal(ok(createQuestionSchema, mcq({ marks: 2, negativeMarks: 2 })), true);
    assert.equal(ok(createQuestionSchema, mcq({ marks: 2, negativeMarks: 3 })), false);
  });
  test('UT19 options: 1 rejected, 2 accepted', () => {
    assert.equal(ok(createQuestionSchema, mcq({ options: options(1) })), false);
    assert.equal(ok(createQuestionSchema, mcq({ options: options(2) })), true);
  });
  test('UT20 options: 6 accepted, 7 rejected', () => {
    assert.equal(ok(createQuestionSchema, mcq({ options: options(6) })), true);
    assert.equal(ok(createQuestionSchema, mcq({ options: options(7) })), false);
  });
  test('UT21 single choice needs exactly one correct option', () => {
    const none = [{ text: 'a', isCorrect: false }, { text: 'b', isCorrect: false }];
    const two = [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }];
    assert.equal(ok(createQuestionSchema, mcq({ options: none })), false);
    assert.equal(ok(createQuestionSchema, mcq({ options: two })), false);
  });
  test('UT22 true/false must use the fixed True/False options', () => {
    const tf = TRUE_FALSE_OPTIONS.map((text, i) => ({ text, isCorrect: i === 0 }));
    assert.equal(ok(createQuestionSchema, mcq({ type: 'TRUE_FALSE', options: tf })), true);
    assert.equal(ok(createQuestionSchema, mcq({ type: 'TRUE_FALSE', options: options(3) })), false);
  });
});

describe('Student form: student ID 4..20 alphanumeric characters', () => {
  const student = (rollNumber: string) => ({
    name: 'Rahul Verma', email: 'rahul@college.edu', rollNumber, department: 'CSE', section: 'A',
  });
  test('UT23 ID length: 3 rejected, 4 accepted', () => {
    assert.equal(ok(createStudentSchema, student('A12')), false);
    assert.equal(ok(createStudentSchema, student('A123')), true);
  });
  test('UT24 ID length: 20 accepted, 21 rejected', () => {
    assert.equal(ok(createStudentSchema, student('A'.repeat(20))), true);
    assert.equal(ok(createStudentSchema, student('A'.repeat(21))), false);
  });
  test('UT25 ID with a symbol is rejected; lower case is upper-cased', () => {
    assert.equal(ok(createStudentSchema, student('23CSE-01')), false);
    assert.equal(createStudentSchema.parse(student('23cse001')).rollNumber, '23CSE001');
  });
});

describe('Exam clock and retakes', () => {
  const quiz = { durationMinutes: 60, endsAt: new Date('2026-10-01T11:00:00Z') };
  test('UT26 started 30 min before close: cut off at close, extra time added after it', () => {
    const start = new Date('2026-10-01T10:30:00Z');
    assert.equal(computeExpiresAt(start, quiz, 0).toISOString(), '2026-10-01T11:00:00.000Z');
    assert.equal(computeExpiresAt(start, quiz, 15).toISOString(), '2026-10-01T11:15:00.000Z');
  });
  test('UT27 live extension: total 180 allowed, 181 refused', () => {
    assert.equal(extensionRefusal(170, 10), null);
    assert.notEqual(extensionRefusal(170, 11), null);
  });
  test('UT28 single-attempt quiz allows one start, plus granted retakes', () => {
    const quizRule = { singleAttempt: true };
    assert.equal(canStartAnother(quizRule, 0, 0), true);
    assert.equal(canStartAnother(quizRule, 0, 1), false);
    assert.equal(canStartAnother(quizRule, 1, 1), true);
  });
  test('UT29 a retake grant is one more than the attempts used', () => {
    assert.equal(grantOne(0, 1), 1);
    assert.equal(grantOne(1, 2), 2);
  });
  test('UT30 retake grants stop at the cap', () => {
    assert.equal(grantOne(MAX_EXTRA_ATTEMPTS, MAX_EXTRA_ATTEMPTS + 1), MAX_EXTRA_ATTEMPTS);
  });
});

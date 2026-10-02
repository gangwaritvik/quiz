import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ZodTypeAny } from 'zod';

import {
  createQuestionSchema,
  createQuizSchema,
  createStudentSchema,
  examEventBatchSchema,
  examEventSchema,
  gradingQueueSchema,
  identifierSchema,
  importQuestionsSchema,
  importStudentsSchema,
  otpRequestSchema,
  otpVerifySchema,
  paginationSchema,
  saveAnswerSchema,
  startExamSchema,
  updateQuizSchema,
} from '@/lib/validation';

const accepts = (schema: ZodTypeAny, value: unknown) => schema.safeParse(value).success;
const rejects = (schema: ZodTypeAny, value: unknown) => !schema.safeParse(value).success;

const id = (n = 1) => `c${String(n).padStart(24, '0')}`; // 25-char cuid-like
const STARTS = '2026-09-10T09:00:00+05:30';
const ENDS = '2026-09-10T11:00:00+05:30';

describe('examEventSchema: metadata limits', () => {
  const withMeta = (metadata: unknown) => ({ type: 'TAB_SWITCH', metadata });
  const keys = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));

  test('accepts up to 10 flat primitive keys, rejects 11', () => {
    assert.ok(accepts(examEventSchema, withMeta(keys(10))));
    assert.ok(rejects(examEventSchema, withMeta(keys(11))));
  });
  test('string values are capped at 200 chars', () => {
    assert.ok(accepts(examEventSchema, withMeta({ a: 'x'.repeat(200) })));
    assert.ok(rejects(examEventSchema, withMeta({ a: 'x'.repeat(201) })));
  });
  test('key names are capped at 64 chars', () => {
    assert.ok(accepts(examEventSchema, withMeta({ ['k'.repeat(64)]: 1 })));
    assert.ok(rejects(examEventSchema, withMeta({ ['k'.repeat(65)]: 1 })));
  });
  test('allows string, number and boolean values only (no nesting, arrays or null)', () => {
    assert.ok(accepts(examEventSchema, withMeta({ s: 'a', n: 1.5, b: false })));
    assert.ok(rejects(examEventSchema, withMeta({ nested: { a: 1 } })));
    assert.ok(rejects(examEventSchema, withMeta({ list: [1, 2] })));
    assert.ok(rejects(examEventSchema, withMeta({ nothing: null })));
  });
  test('metadata must be an object, and is optional', () => {
    assert.ok(accepts(examEventSchema, { type: 'TAB_SWITCH' }));
    assert.ok(rejects(examEventSchema, withMeta('string')));
    assert.ok(rejects(examEventSchema, withMeta([1])));
  });
  test('a __proto__ key cannot pollute prototypes or become an own property', () => {
    const parsed = examEventSchema.safeParse(JSON.parse('{"type":"TAB_SWITCH","metadata":{"__proto__":"x","a":1}}'));
    assert.equal((({}) as Record<string, unknown>).polluted, undefined);
    if (parsed.success) {
      const meta = parsed.data.metadata as Record<string, unknown>;
      assert.equal(Object.getPrototypeOf(meta), Object.prototype);
      assert.equal(Object.hasOwn(meta, '__proto__'), false);
    }
  });
});

describe('examEventSchema: type, duration, timestamp', () => {
  test('clients cannot report server-authored event types', () => {
    for (const type of ['MULTIPLE_SESSION', 'DEVICE_MISMATCH', 'ATTEMPT_STARTED', 'ATTEMPT_SUBMITTED', 'AUTO_SUBMITTED', 'ANSWER_GRADED', 'HEARTBEAT_MISSED', 'NOPE', '']) {
      assert.ok(rejects(examEventSchema, { type }), type);
    }
  });
  test('accepts the browser-observable types', () => {
    for (const type of ['TAB_SWITCH', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', 'PASTE_ATTEMPT', 'IDLE_TIMEOUT']) {
      assert.ok(accepts(examEventSchema, { type }), type);
    }
  });
  test(
    'accepts every event type the exam client actually emits',
    () => {
      for (const type of ['MULTIPLE_DISPLAYS_DETECTED', 'SCREEN_SHARE_STOPPED', 'SCREEN_SHARE_PERMISSION_LOST']) {
        assert.ok(accepts(examEventSchema, { type }), type);
      }
    },
  );
  test('durationMs must be an integer between 0 and 6 hours', () => {
    const base = { type: 'TAB_SWITCH' };
    assert.ok(accepts(examEventSchema, { ...base, durationMs: 0 }));
    assert.ok(accepts(examEventSchema, { ...base, durationMs: 6 * 3600 * 1000 }));
    assert.ok(rejects(examEventSchema, { ...base, durationMs: 6 * 3600 * 1000 + 1 }));
    assert.ok(rejects(examEventSchema, { ...base, durationMs: -1 }));
    assert.ok(rejects(examEventSchema, { ...base, durationMs: 1.5 }));
    assert.ok(rejects(examEventSchema, { ...base, durationMs: '5' }));
  });
  test('clientTimestamp must be an ISO datetime', () => {
    assert.ok(accepts(examEventSchema, { type: 'TAB_SWITCH', clientTimestamp: '2026-09-10T09:00:00.000Z' }));
    assert.ok(rejects(examEventSchema, { type: 'TAB_SWITCH', clientTimestamp: 'yesterday' }));
  });
  test('unknown fields are dropped from the parsed output, not trusted', () => {
    const parsed = examEventSchema.parse({ type: 'TAB_SWITCH', occurredAt: '2000-01-01', severity: 'HIGH' });
    assert.deepEqual(parsed, { type: 'TAB_SWITCH' });
  });
});

describe('examEventBatchSchema', () => {
  const event = { type: 'TAB_SWITCH' };
  test('needs 1..25 events', () => {
    assert.ok(rejects(examEventBatchSchema, { events: [] }));
    assert.ok(accepts(examEventBatchSchema, { events: Array(25).fill(event) }));
    assert.ok(rejects(examEventBatchSchema, { events: Array(26).fill(event) }));
    assert.ok(rejects(examEventBatchSchema, {}));
  });
  test('one bad event rejects the whole batch', () => {
    assert.ok(rejects(examEventBatchSchema, { events: [event, { type: 'MULTIPLE_SESSION' }] }));
  });
});

describe('saveAnswerSchema', () => {
  test('requires some answer content', () => {
    assert.ok(rejects(saveAnswerSchema, { attemptQuestionId: id() }));
    assert.ok(accepts(saveAnswerSchema, { attemptQuestionId: id(), markedForReview: true }));
    assert.ok(accepts(saveAnswerSchema, { attemptQuestionId: id(), selectedOptionId: id(2) }));
    assert.ok(accepts(saveAnswerSchema, { attemptQuestionId: id(), selectedOptionId: null }));
    assert.ok(accepts(saveAnswerSchema, { attemptQuestionId: id(), textResponse: '' }));
  });
  test('text is capped at 20,000 chars', () => {
    assert.ok(accepts(saveAnswerSchema, { attemptQuestionId: id(), textResponse: 'a'.repeat(20_000) }));
    assert.ok(rejects(saveAnswerSchema, { attemptQuestionId: id(), textResponse: 'a'.repeat(20_001) }));
  });
  test('selected option list is capped at 10 valid ids', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => id(i));
    assert.ok(accepts(saveAnswerSchema, { attemptQuestionId: id(), selectedOptionIds: ids(10) }));
    assert.ok(rejects(saveAnswerSchema, { attemptQuestionId: id(), selectedOptionIds: ids(11) }));
    assert.ok(rejects(saveAnswerSchema, { attemptQuestionId: id(), selectedOptionIds: ['nope'] }));
  });
  test('identifiers must look like cuids (length, charset)', () => {
    for (const bad of ['', 'short', 'a'.repeat(41), `${id()}'; DROP TABLE x;--`, `${'a'.repeat(24)}-`, 42]) {
      assert.ok(rejects(saveAnswerSchema, { attemptQuestionId: bad, markedForReview: true }), String(bad));
    }
  });
  test('unknown fields are stripped', () => {
    const parsed = saveAnswerSchema.parse({ attemptQuestionId: id(), markedForReview: true, awardedMarks: 99 });
    assert.deepEqual(parsed, { attemptQuestionId: id(), markedForReview: true });
  });
});

describe('startExamSchema', () => {
  test('requires acknowledgedRules to be literally true', () => {
    assert.ok(accepts(startExamSchema, { quizId: id(), acknowledgedRules: true }));
    for (const v of [false, 'true', 1, undefined]) {
      assert.ok(rejects(startExamSchema, { quizId: id(), acknowledgedRules: v }));
    }
  });
});

describe('OTP schemas', () => {
  test('identifier accepts emails and alphanumeric roll numbers, trimming whitespace', () => {
    assert.equal(identifierSchema.parse('  23CSE041 '), '23CSE041');
    assert.ok(accepts(identifierSchema, 'first.last+tag@college.edu.in'));
  });
  test('identifier rejects too short, too long, spaces and injection-style input', () => {
    for (const bad of ['', 'ab', 'abc', 'a'.repeat(21), `${'a'.repeat(120)}@x.com`, 'a b c d', "x'; DROP TABLE users;--", '23CSE-041', '@college.edu', 'a@b', '<script>1</script>']) {
      assert.ok(rejects(identifierSchema, bad), bad);
    }
  });
  test('request needs an identifier and ignores extras', () => {
    assert.ok(rejects(otpRequestSchema, {}));
    assert.ok(rejects(otpRequestSchema, { identifier: 12345678 }));
    assert.deepEqual(otpRequestSchema.parse({ identifier: '23CSE041', role: 'ADMIN' }), { identifier: '23CSE041' });
  });
  test('verify requires exactly 6 ASCII digits (trimmed)', () => {
    assert.deepEqual(otpVerifySchema.parse({ identifier: '23CSE041', code: ' 012345 ' }), {
      identifier: '23CSE041',
      code: '012345',
    });
    for (const code of ['12345', '1234567', '12345a', '12 456', '', '١٢٣٤٥٦', '1e5555', 123456]) {
      assert.ok(rejects(otpVerifySchema, { identifier: '23CSE041', code }), String(code));
    }
    assert.ok(rejects(otpVerifySchema, { code: '123456' }));
  });
});

describe('createQuizSchema', () => {
  const valid = () => ({
    title: 'Midterm',
    subjectId: id(),
    durationMinutes: 60,
    startsAt: STARTS,
    endsAt: ENDS,
    security: {},
  });

  test('accepts a minimal pooled quiz and applies defaults', () => {
    const out = createQuizSchema.parse(valid());
    assert.equal(out.sourceMode, 'POOL');
    assert.equal(out.status, 'DRAFT');
    assert.equal(out.security.singleAttempt, true);
    assert.equal(out.security.cameraMonitoring, false);
  });
  test('end must be strictly after start', () => {
    assert.ok(rejects(createQuizSchema, { ...valid(), endsAt: STARTS }));
    assert.ok(rejects(createQuizSchema, { ...valid(), endsAt: '2026-09-10T08:00:00+05:30' }));
  });
  test('end-after-start compares instants, not strings, across offsets', () => {
    // 11:00+05:30 is 05:30Z; 06:00Z is later even though "06:00" < "11:00" as text.
    assert.ok(accepts(createQuizSchema, { ...valid(), endsAt: '2026-09-10T06:00:00Z' }));
  });
  test('dates must be ISO datetimes with an offset', () => {
    assert.ok(rejects(createQuizSchema, { ...valid(), startsAt: '2026-09-10T09:00:00' }));
    assert.ok(rejects(createQuizSchema, { ...valid(), startsAt: 'tomorrow' }));
  });
  test('duration is bounded 1..360 minutes', () => {
    assert.ok(rejects(createQuizSchema, { ...valid(), durationMinutes: 0 }));
    assert.ok(rejects(createQuizSchema, { ...valid(), durationMinutes: 361 }));
    assert.ok(accepts(createQuizSchema, { ...valid(), durationMinutes: 360 }));
    assert.ok(rejects(createQuizSchema, { ...valid(), durationMinutes: 1.5 }));
  });
  test('title length and subject id are enforced', () => {
    assert.ok(rejects(createQuizSchema, { ...valid(), title: 'ab' }));
    assert.ok(rejects(createQuizSchema, { ...valid(), title: 'x'.repeat(121) }));
    assert.ok(rejects(createQuizSchema, { ...valid(), subjectId: 'bad' }));
  });
  test('pooled difficulty mix must total 100', () => {
    assert.ok(rejects(createQuizSchema, { ...valid(), easyPct: 50, mediumPct: 50, hardPct: 50 }));
    assert.ok(accepts(createQuizSchema, { ...valid(), easyPct: 20, mediumPct: 30, hardPct: 50 }));
  });
  test('fixed mode needs questions; pooled mode must not carry them', () => {
    const question = {
      text: 'What is 2 + 2?',
      options: [{ text: '4', isCorrect: true }, { text: '5', isCorrect: false }],
    };
    assert.ok(rejects(createQuizSchema, { ...valid(), sourceMode: 'FIXED' }));
    assert.ok(accepts(createQuizSchema, { ...valid(), sourceMode: 'FIXED', questions: [question] }));
    assert.ok(rejects(createQuizSchema, { ...valid(), questions: [question] }));
  });
  test('fixed mode ignores the difficulty mix', () => {
    const question = { text: 'What is 2 + 2?', options: [{ text: '4', isCorrect: true }, { text: '5', isCorrect: false }] };
    assert.ok(accepts(createQuizSchema, { ...valid(), sourceMode: 'FIXED', questions: [question], easyPct: 1, mediumPct: 1, hardPct: 1 }));
  });
  test('status cannot be set to ARCHIVED on creation', () => {
    assert.ok(rejects(createQuizSchema, { ...valid(), status: 'ARCHIVED' }));
  });
});

describe('updateQuizSchema (patch)', () => {
  test('an empty patch is valid', () => {
    assert.ok(accepts(updateQuizSchema, {}));
  });
  test('end must be after start only when both are supplied', () => {
    assert.ok(accepts(updateQuizSchema, { endsAt: ENDS }));
    assert.ok(rejects(updateQuizSchema, { startsAt: ENDS, endsAt: STARTS }));
  });
  test('difficulty mix is all-or-nothing and must total 100', () => {
    assert.ok(accepts(updateQuizSchema, { easyPct: 30, mediumPct: 50, hardPct: 20 }));
    assert.ok(rejects(updateQuizSchema, { easyPct: 30 }));
    assert.ok(rejects(updateQuizSchema, { easyPct: 30, mediumPct: 50, hardPct: 30 }));
  });
  test('bounds on duration and status values', () => {
    assert.ok(rejects(updateQuizSchema, { durationMinutes: 0 }));
    assert.ok(rejects(updateQuizSchema, { status: 'DELETED' }));
    assert.ok(accepts(updateQuizSchema, { status: 'ARCHIVED' }));
  });
  test('security can be patched partially but only with booleans', () => {
    assert.ok(accepts(updateQuizSchema, { security: { requireFullscreen: false } }));
    assert.ok(rejects(updateQuizSchema, { security: { requireFullscreen: 'no' } }));
  });
});

describe('createQuestionSchema', () => {
  const mcq = (over: Record<string, unknown> = {}) => ({
    subjectId: id(),
    text: 'Pick the prime number',
    options: [
      { text: '4', isCorrect: false },
      { text: '7', isCorrect: true },
    ],
    ...over,
  });

  test('accepts a valid single-choice question with default marks', () => {
    const out = createQuestionSchema.parse(mcq());
    assert.equal(out.marks, 1);
    assert.equal(out.negativeMarks, 0);
    assert.equal(out.type, 'MCQ_SINGLE');
  });
  test('marks must be a positive integer up to 20; negative marks 0..10', () => {
    assert.ok(rejects(createQuestionSchema, mcq({ marks: 0 })));
    assert.ok(rejects(createQuestionSchema, mcq({ marks: -2 })));
    assert.ok(rejects(createQuestionSchema, mcq({ marks: 21 })));
    assert.ok(rejects(createQuestionSchema, mcq({ marks: 1.5 })));
    assert.ok(accepts(createQuestionSchema, mcq({ marks: 20, negativeMarks: 10 })));
    assert.ok(rejects(createQuestionSchema, mcq({ negativeMarks: -1 })));
    assert.ok(rejects(createQuestionSchema, mcq({ negativeMarks: 11 })));
  });
  test('single-choice types need exactly one correct option', () => {
    const two = [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }];
    const none = [{ text: 'a', isCorrect: false }, { text: 'b', isCorrect: false }];
    assert.ok(rejects(createQuestionSchema, mcq({ options: two })));
    assert.ok(rejects(createQuestionSchema, mcq({ options: none })));
  });
  test('needs at least two options, at most six, each with text or an image', () => {
    assert.ok(rejects(createQuestionSchema, mcq({ options: [{ text: 'a', isCorrect: true }] })));
    const seven = Array.from({ length: 7 }, (_, i) => ({ text: `o${i}`, isCorrect: i === 0 }));
    assert.ok(rejects(createQuestionSchema, mcq({ options: seven })));
    assert.ok(rejects(createQuestionSchema, mcq({ options: [{ text: '', isCorrect: true }, { text: 'b', isCorrect: false }] })));
    assert.ok(accepts(createQuestionSchema, mcq({ options: [{ text: '', imageAssetId: id(9), isCorrect: true }, { text: 'b', isCorrect: false }] })));
  });
  test('multi-select needs at least two correct options', () => {
    const opts = (n: number) => [0, 1, 2].map((i) => ({ text: `o${i}`, isCorrect: i < n }));
    assert.ok(rejects(createQuestionSchema, mcq({ type: 'MCQ_MULTI', options: opts(1) })));
    assert.ok(accepts(createQuestionSchema, mcq({ type: 'MCQ_MULTI', options: opts(2) })));
  });
  test('short answer needs accepted answers and no options', () => {
    const short = { subjectId: id(), text: 'Capital of France?', type: 'SHORT_ANSWER' };
    assert.ok(rejects(createQuestionSchema, short));
    assert.ok(accepts(createQuestionSchema, { ...short, acceptedAnswers: ['Paris'] }));
    assert.ok(rejects(createQuestionSchema, { ...short, acceptedAnswers: ['Paris'], options: mcq().options }));
    assert.ok(rejects(createQuestionSchema, { ...short, acceptedAnswers: [''] }));
  });
  test('written answers cannot carry options', () => {
    assert.ok(rejects(createQuestionSchema, mcq({ type: 'LONG_ANSWER' })));
    assert.ok(accepts(createQuestionSchema, { subjectId: id(), text: 'Explain TCP.', type: 'LONG_ANSWER' }));
  });
  test('assertion-reason needs both statements', () => {
    const ar = mcq({ type: 'ASSERTION_REASON' });
    assert.ok(rejects(createQuestionSchema, ar));
    assert.ok(accepts(createQuestionSchema, { ...ar, assertionText: 'A', reasonText: 'R' }));
  });
  test('unknown question types and short text are rejected', () => {
    assert.ok(rejects(createQuestionSchema, mcq({ type: 'ESSAY' })));
    assert.ok(rejects(createQuestionSchema, mcq({ text: 'hey' })));
  });
});

describe('CSV import and student schemas', () => {
  test('import payloads need 10..500,000 chars of csv', () => {
    for (const schema of [importStudentsSchema, importQuestionsSchema]) {
      const extra = schema === importQuestionsSchema ? { subjectId: id() } : {};
      assert.ok(rejects(schema, { ...extra, csv: 'a,b' }));
      assert.ok(accepts(schema, { ...extra, csv: 'x'.repeat(500_000) }));
      assert.ok(rejects(schema, { ...extra, csv: 'x'.repeat(500_001) }));
      assert.ok(rejects(schema, { ...extra, csv: 123456789012 }));
    }
    assert.ok(rejects(importQuestionsSchema, { csv: 'x'.repeat(50) }));
  });
  test('student roll number is upper-cased and must be alphanumeric', () => {
    const base = { name: 'Asha Rao', email: 'asha@college.edu', rollNumber: '23cse041', department: 'CSE', section: 'A' };
    const out = createStudentSchema.parse(base);
    assert.equal(out.rollNumber, '23CSE041');
    assert.equal(out.semester, 1);
    assert.ok(rejects(createStudentSchema, { ...base, rollNumber: '23-CSE' }));
    assert.ok(rejects(createStudentSchema, { ...base, rollNumber: 'abc' }));
    assert.ok(rejects(createStudentSchema, { ...base, email: 'not-an-email' }));
    assert.ok(rejects(createStudentSchema, { ...base, semester: 13 }));
  });
});

describe('query-param schemas', () => {
  test('pagination coerces strings and bounds page size', () => {
    assert.deepEqual(paginationSchema.parse({ page: '2', pageSize: '50' }), { page: 2, pageSize: 50 });
    assert.deepEqual(paginationSchema.parse({}), { page: 1, pageSize: 20 });
    assert.ok(rejects(paginationSchema, { pageSize: '101' }));
    assert.ok(rejects(paginationSchema, { page: '0' }));
  });
  test(
    'includeCompleted=false in a query string parses as false',
    () => {
      assert.equal(gradingQueueSchema.parse({ includeCompleted: 'false' }).includeCompleted, false);
    },
  );
});

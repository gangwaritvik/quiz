import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  effectiveMarking,
  gradeAnswer,
  hasResponse,
  matchesAcceptedAnswer,
  normalizeAnswerText,
  type GradableQuestion,
  type StudentResponse,
} from '@/lib/grading';

const q = (over: Partial<GradableQuestion> = {}): GradableQuestion => ({
  type: 'MCQ_SINGLE',
  marks: 4,
  negativeMarks: 1,
  partialCredit: false,
  acceptedAnswers: [],
  caseSensitive: false,
  numericTolerance: null,
  correctOptionIds: ['a'],
  ...over,
});

const r = (over: Partial<StudentResponse> = {}): StudentResponse => ({
  selectedOptionId: null,
  selectedOptionIds: [],
  textResponse: null,
  attachmentCount: 0,
  ...over,
});

describe('normalizeAnswerText', () => {
  test('trims, collapses whitespace runs (tabs/newlines) and folds case', () => {
    assert.equal(normalizeAnswerText('  Hello \t\n  World !  ', false), 'hello world !');
  });
  test('keeps case when case sensitive', () => {
    assert.equal(normalizeAnswerText('  NaCl ', true), 'NaCl');
  });
  test('does not strip punctuation', () => {
    assert.equal(normalizeAnswerText('H2O.', false), 'h2o.');
  });
  test('folds non-ASCII case and treats NBSP as whitespace', () => {
    assert.equal(normalizeAnswerText('ÉCOLE  Normale', false), 'école normale');
  });
});

describe('matchesAcceptedAnswer', () => {
  const base = { acceptedAnswers: ['Paris', 'City of Light'], caseSensitive: false, numericTolerance: null };

  test('matches any accepted answer ignoring case and extra spaces', () => {
    assert.equal(matchesAcceptedAnswer('  pARIS ', base), true);
    assert.equal(matchesAcceptedAnswer('city   of light', base), true);
  });
  test('rejects wrong and empty/whitespace responses', () => {
    assert.equal(matchesAcceptedAnswer('London', base), false);
    assert.equal(matchesAcceptedAnswer('', base), false);
    assert.equal(matchesAcceptedAnswer('   \n', base), false);
  });
  test('empty response never matches even an empty accepted answer', () => {
    assert.equal(matchesAcceptedAnswer('', { ...base, acceptedAnswers: [''] }), false);
  });
  test('case sensitivity is honoured', () => {
    const cs = { ...base, caseSensitive: true };
    assert.equal(matchesAcceptedAnswer('paris', cs), false);
    assert.equal(matchesAcceptedAnswer('Paris', cs), true);
  });
  test('no accepted answers matches nothing', () => {
    assert.equal(matchesAcceptedAnswer('anything', { ...base, acceptedAnswers: [] }), false);
  });
  test('numeric tolerance accepts values within range, inclusive', () => {
    const num = { acceptedAnswers: ['3.14159'], caseSensitive: false, numericTolerance: 0.01 };
    assert.equal(matchesAcceptedAnswer('3.14', num), true);
    assert.equal(matchesAcceptedAnswer('3.15', num), true);
    assert.equal(matchesAcceptedAnswer('3.2', num), false);
    assert.equal(matchesAcceptedAnswer('-3.14', num), false);
  });
  test('numeric tolerance 0 means exact numeric equality', () => {
    const num = { acceptedAnswers: ['3'], caseSensitive: false, numericTolerance: 0 };
    assert.equal(matchesAcceptedAnswer('3.0', num), true);
    assert.equal(matchesAcceptedAnswer('3.01', num), false);
  });
  test('non-numeric response with a tolerance falls back to text comparison', () => {
    const num = { acceptedAnswers: ['pi'], caseSensitive: false, numericTolerance: 0.1 };
    assert.equal(matchesAcceptedAnswer('PI', num), true);
    assert.equal(matchesAcceptedAnswer('tau', num), false);
  });
  test('without a tolerance numbers are compared as text only', () => {
    const num = { acceptedAnswers: ['3'], caseSensitive: false, numericTolerance: null };
    assert.equal(matchesAcceptedAnswer('3.0', num), false);
  });
  test('negative tolerance is ignored (text comparison only)', () => {
    const num = { acceptedAnswers: ['3'], caseSensitive: false, numericTolerance: -1 };
    assert.equal(matchesAcceptedAnswer('3.5', num), false);
    assert.equal(matchesAcceptedAnswer('3', num), true);
  });
  test(
    'trailing junk after a number is not accepted as the number',
    () => {
      const num = { acceptedAnswers: ['2'], caseSensitive: false, numericTolerance: 0 };
      assert.equal(matchesAcceptedAnswer('2/3', num), false);
      assert.equal(matchesAcceptedAnswer('2abc', num), false);
    },
  );
  test(
    'canonically equivalent Unicode (NFC vs NFD) matches',
    () => {
      const accepted = { acceptedAnswers: ['café'], caseSensitive: false, numericTolerance: null };
      assert.equal(matchesAcceptedAnswer('café', accepted), true);
    },
  );
});

describe('hasResponse', () => {
  test('single option types need a selected id', () => {
    for (const t of ['MCQ_SINGLE', 'TRUE_FALSE', 'ASSERTION_REASON'] as const) {
      assert.equal(hasResponse(t, r()), false, t);
      assert.equal(hasResponse(t, r({ selectedOptionId: 'a' })), true, t);
    }
  });
  test('MCQ_MULTI looks at the array, not the single id', () => {
    assert.equal(hasResponse('MCQ_MULTI', r({ selectedOptionId: 'a' })), false);
    assert.equal(hasResponse('MCQ_MULTI', r({ selectedOptionIds: ['a'] })), true);
  });
  test('text types ignore whitespace-only text', () => {
    assert.equal(hasResponse('SHORT_ANSWER', r({ textResponse: '  \n ' })), false);
    assert.equal(hasResponse('LONG_ANSWER', r({ textResponse: null })), false);
    assert.equal(hasResponse('LONG_ANSWER', r({ textResponse: 'x' })), true);
  });
  test('IMAGE_ANSWER counts attachments or text', () => {
    assert.equal(hasResponse('IMAGE_ANSWER', r()), false);
    assert.equal(hasResponse('IMAGE_ANSWER', r({ attachmentCount: 1 })), true);
    assert.equal(hasResponse('IMAGE_ANSWER', r({ textResponse: 'note' })), true);
  });
});

describe('gradeAnswer: single option', () => {
  test('correct answer earns full marks', () => {
    assert.deepEqual(gradeAnswer(q(), r({ selectedOptionId: 'a' })), {
      state: 'AUTO',
      isCorrect: true,
      awardedMarks: 4,
    });
  });
  test('wrong answer deducts negative marks', () => {
    assert.deepEqual(gradeAnswer(q(), r({ selectedOptionId: 'b' })), {
      state: 'AUTO',
      isCorrect: false,
      awardedMarks: -1,
    });
  });
  test('unanswered is zero, never negative', () => {
    assert.deepEqual(gradeAnswer(q(), r()), { state: 'UNANSWERED', awardedMarks: 0, isCorrect: null });
  });
  test('true/false and assertion-reason grade like single choice', () => {
    for (const type of ['TRUE_FALSE', 'ASSERTION_REASON'] as const) {
      assert.equal(gradeAnswer(q({ type }), r({ selectedOptionId: 'a' })).awardedMarks, 4);
      assert.equal(gradeAnswer(q({ type }), r({ selectedOptionId: 'z' })).awardedMarks, -1);
    }
  });
  test('wrong answer with no negative marking scores zero', () => {
    const out = gradeAnswer(q({ negativeMarks: 0 }), r({ selectedOptionId: 'b' }));
    assert.equal(out.awardedMarks === 0, true); // === treats -0 as 0
  });
  test(
    'wrong answer with no negative marking is +0, not -0',
    () => {
      const out = gradeAnswer(q({ negativeMarks: 0 }), r({ selectedOptionId: 'b' }));
      assert.ok(Object.is(out.awardedMarks, 0));
    },
  );
  test('a response against an empty correct set is simply wrong', () => {
    const out = gradeAnswer(q({ correctOptionIds: [] }), r({ selectedOptionId: 'a' }));
    assert.equal(out.isCorrect, false);
  });
});

describe('gradeAnswer: multi select', () => {
  const multi = (over: Partial<GradableQuestion> = {}) =>
    q({ type: 'MCQ_MULTI', correctOptionIds: ['a', 'b', 'c'], ...over });

  test('all correct options earn full marks', () => {
    const out = gradeAnswer(multi(), r({ selectedOptionIds: ['c', 'a', 'b'] }));
    assert.deepEqual(out, { state: 'AUTO', isCorrect: true, awardedMarks: 4 });
  });
  test('any incorrect option scores the negative mark, even with all correct ticked', () => {
    const out = gradeAnswer(multi({ partialCredit: true }), r({ selectedOptionIds: ['a', 'b', 'c', 'x'] }));
    assert.deepEqual(out, { state: 'AUTO', isCorrect: false, awardedMarks: -1 });
  });
  test('proper subset earns proportional partial credit when allowed', () => {
    const out = gradeAnswer(multi({ partialCredit: true, marks: 3 }), r({ selectedOptionIds: ['a'] }));
    assert.deepEqual(out, { state: 'AUTO', isCorrect: false, awardedMarks: 1 });
  });
  test('partial credit is rounded to two decimals and stays below full marks', () => {
    const out = gradeAnswer(multi({ partialCredit: true, marks: 1 }), r({ selectedOptionIds: ['a', 'b'] }));
    assert.equal(out.awardedMarks, 0.67);
  });
  test('proper subset scores zero when partial credit is off', () => {
    const out = gradeAnswer(multi({ partialCredit: false }), r({ selectedOptionIds: ['a', 'b'] }));
    assert.deepEqual(out, { state: 'AUTO', isCorrect: false, awardedMarks: 0 });
  });
  test('duplicate ids cannot inflate partial credit', () => {
    const out = gradeAnswer(multi({ partialCredit: true, marks: 3 }), r({ selectedOptionIds: ['a', 'a', 'a'] }));
    assert.equal(out.awardedMarks, 1);
  });
  test('empty selection is unanswered', () => {
    assert.equal(gradeAnswer(multi(), r()).state, 'UNANSWERED');
  });
  test('awarded marks stay within 0..marks for any subset of the correct options', () => {
    for (const selectedOptionIds of [['a'], ['a', 'b'], ['a', 'b', 'c'], ['b', 'c']]) {
      const out = gradeAnswer(multi({ partialCredit: true }), r({ selectedOptionIds }));
      assert.ok((out.awardedMarks as number) <= 4 && (out.awardedMarks as number) >= 0);
    }
  });
});

describe('gradeAnswer: text and manual types', () => {
  const short = (over: Partial<GradableQuestion> = {}) =>
    q({ type: 'SHORT_ANSWER', acceptedAnswers: ['Mitochondria'], ...over });

  test('short answer correct / wrong / blank', () => {
    assert.equal(gradeAnswer(short(), r({ textResponse: ' mitochondria ' })).awardedMarks, 4);
    assert.equal(gradeAnswer(short(), r({ textResponse: 'nucleus' })).awardedMarks, -1);
    assert.equal(gradeAnswer(short(), r({ textResponse: '   ' })).state, 'UNANSWERED');
  });
  test('short answer respects case sensitivity', () => {
    const out = gradeAnswer(short({ caseSensitive: true }), r({ textResponse: 'mitochondria' }));
    assert.equal(out.isCorrect, false);
  });
  test('short answer numeric tolerance end to end', () => {
    const out = gradeAnswer(
      short({ acceptedAnswers: ['9.81'], numericTolerance: 0.05 }),
      r({ textResponse: '9.8' }),
    );
    assert.equal(out.isCorrect, true);
  });
  test('long answer and image answer go to a human with no marks yet', () => {
    assert.deepEqual(gradeAnswer(q({ type: 'LONG_ANSWER' }), r({ textResponse: 'essay' })), {
      state: 'MANUAL',
      awardedMarks: null,
      isCorrect: null,
    });
    assert.equal(gradeAnswer(q({ type: 'IMAGE_ANSWER' }), r({ attachmentCount: 2 })).state, 'MANUAL');
  });
  test('blank manual answers are unanswered rather than pending', () => {
    assert.equal(gradeAnswer(q({ type: 'LONG_ANSWER' }), r({ textResponse: '  ' })).state, 'UNANSWERED');
    assert.equal(gradeAnswer(q({ type: 'IMAGE_ANSWER' }), r()).state, 'UNANSWERED');
  });
});

describe('effectiveMarking (quiz-wide scheme)', () => {
  const question = { negativeMarks: 1, partialCredit: false };
  const none = { negativeMarkingPct: null, multiPartialCredit: null };

  test('with no quiz scheme each question keeps its own settings', () => {
    assert.deepEqual(effectiveMarking(question, 4, none), { negativeMarks: 1, partialCredit: false });
  });

  test('the quiz penalty is a share of the marks the question carries', () => {
    assert.equal(effectiveMarking(question, 4, { ...none, negativeMarkingPct: 25 }).negativeMarks, 1);
    assert.equal(effectiveMarking(question, 2, { ...none, negativeMarkingPct: 25 }).negativeMarks, 0.5);
    assert.equal(effectiveMarking(question, 3, { ...none, negativeMarkingPct: 33 }).negativeMarks, 0.99);
  });

  test('0% switches negative marking off even where a question asks for it', () => {
    assert.equal(effectiveMarking(question, 4, { ...none, negativeMarkingPct: 0 }).negativeMarks, 0);
  });

  test('the quiz can force partial credit on or off', () => {
    assert.equal(effectiveMarking(question, 4, { ...none, multiPartialCredit: true }).partialCredit, true);
    assert.equal(
      effectiveMarking({ ...question, partialCredit: true }, 4, { ...none, multiPartialCredit: false })
        .partialCredit,
      false,
    );
  });

  test('graded with the scheme: a wrong single answer loses a quarter of its marks', () => {
    const marking = effectiveMarking(question, 4, { ...none, negativeMarkingPct: 25 });
    const out = gradeAnswer(q({ marks: 4, ...marking }), r({ selectedOptionId: 'b' }));
    assert.equal(out.awardedMarks, -1);
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  FACULTY_REVIEW_NOTE,
  monitoringStatus,
  questionLabel,
  type ActivityCounters,
} from '@/components/exam/status-labels';

const none: ActivityCounters = { tabSwitches: 0, fullscreenExits: 0, blurEvents: 0, copyPasteAttempts: 0 };

describe('questionLabel', () => {
  test('flagged question still says whether it is answered', () => {
    assert.equal(
      questionLabel(4, { answered: true, markedForReview: true }),
      'Question 4, answered, marked for review',
    );
    assert.equal(
      questionLabel(4, { answered: false, markedForReview: true }),
      'Question 4, not answered, marked for review',
    );
  });

  test('plain, current and locked states', () => {
    assert.equal(questionLabel(1, { answered: false, markedForReview: false }), 'Question 1, not answered');
    assert.equal(
      questionLabel(2, { answered: true, markedForReview: false }, { current: true }),
      'Question 2, answered, current question',
    );
    assert.equal(
      questionLabel(9, { answered: false, markedForReview: false }, { locked: true }),
      'Question 9, not yet accessible',
    );
  });
});

describe('monitoringStatus', () => {
  test('nothing recorded reads as a neutral statement, not a guarantee', () => {
    const s = monitoringStatus(none);
    assert.equal(s.recorded, false);
    assert.equal(s.label, 'Exam monitoring is on');
  });

  test('recorded events are counted per type with correct plurals', () => {
    const s = monitoringStatus({ ...none, tabSwitches: 1, copyPasteAttempts: 2 });
    assert.equal(s.recorded, true);
    assert.equal(s.label, '1 tab switch · 2 clipboard attempts recorded');
    assert.equal(s.detail, FACULTY_REVIEW_NOTE);
    assert.equal(monitoringStatus({ ...none, tabSwitches: 3 }).label, '3 tab switches recorded');
  });

  test('a focus change alone counts as recorded', () => {
    assert.equal(monitoringStatus({ ...none, blurEvents: 1 }).label, '1 focus change recorded');
  });

  test('copy never accuses', () => {
    const all = JSON.stringify([
      monitoringStatus(none),
      monitoringStatus({ tabSwitches: 2, fullscreenExits: 1, blurEvents: 4, copyPasteAttempts: 1 }),
    ]);
    assert.doesNotMatch(all, /suspicious|violation|cheat/i);
  });
});

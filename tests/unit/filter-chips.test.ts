import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildFilterChips } from '@/lib/filter-chips';

describe('buildFilterChips', () => {
  test('no active filters means no chips', () => {
    const chips = buildFilterChips([
      { key: 'subject', label: 'Subject', value: 'ALL' },
      { key: 'search', label: 'Search', value: '' },
    ]);
    assert.deepEqual(chips, []);
  });

  test('chip text is "Label: display" and keeps the field order', () => {
    const chips = buildFilterChips([
      { key: 'subject', label: 'Subject', value: 'sub_1', display: 'Database Systems' },
      { key: 'topic', label: 'Topic', value: 'ALL' },
      { key: 'difficulty', label: 'Difficulty', value: 'HARD', display: 'Hard' },
    ]);
    assert.deepEqual(chips, [
      { key: 'subject', text: 'Subject: Database Systems' },
      { key: 'difficulty', text: 'Difficulty: Hard' },
    ]);
  });

  test('falls back to the raw value when there is no display text', () => {
    const chips = buildFilterChips([{ key: 'type', label: 'Type', value: 'MCQ_SINGLE', display: '' }]);
    assert.deepEqual(chips, [{ key: 'type', text: 'Type: MCQ_SINGLE' }]);
  });

  test('a custom unset sentinel is honoured', () => {
    const fields = [{ key: 'level', label: 'Level', value: 'any' }];
    assert.equal(buildFilterChips(fields, 'any').length, 0);
    assert.equal(buildFilterChips(fields).length, 1);
  });
});

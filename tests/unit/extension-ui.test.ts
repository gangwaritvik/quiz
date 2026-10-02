import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ADD_TIME_PRESETS,
  PRESTART_PRESETS,
  checkMinutes,
  clampMinutes,
  extraBadge,
  formatClock,
  initialPicker,
  matchesStudentQuery,
  maxAddable,
  newEndTime,
  pickerFor,
  resolvePicker,
} from '@/lib/extension-ui';

describe('checkMinutes', () => {
  test('accepts whole numbers inside the range, including the edges', () => {
    assert.deepEqual(checkMinutes('1', 1, 120), { ok: true, minutes: 1 });
    assert.deepEqual(checkMinutes(' 45 ', 1, 120), { ok: true, minutes: 45 });
    assert.deepEqual(checkMinutes('120', 1, 120), { ok: true, minutes: 120 });
  });

  test('rejects empty, zero, too large, negative and fractional input', () => {
    for (const raw of ['', '   ', '0', '121', '-5', '1.5', '1e2', 'abc']) {
      assert.equal(checkMinutes(raw, 1, 120).ok, false, `"${raw}" should be rejected`);
    }
    assert.deepEqual(checkMinutes('0', 1, 120), { ok: false, message: 'Enter 1 to 120 minutes.' });
    assert.deepEqual(checkMinutes('1.5', 1, 120), {
      ok: false,
      message: 'Enter a whole number of minutes.',
    });
  });

  test('a ceiling below the minimum means nothing can be added', () => {
    assert.deepEqual(checkMinutes('5', 1, 0), { ok: false, message: 'No more time can be added.' });
  });
});

describe('maxAddable', () => {
  test('is 120 until the 180-minute total gets in the way', () => {
    assert.equal(maxAddable(0), 120);
    assert.equal(maxAddable(60), 120);
    assert.equal(maxAddable(100), 80);
    assert.equal(maxAddable(180), 0);
  });

  test('never goes negative or counts negative extra time', () => {
    assert.equal(maxAddable(500), 0);
    assert.equal(maxAddable(-10), 120);
  });
});

describe('clampMinutes', () => {
  test('pulls values into range and truncates', () => {
    assert.equal(clampMinutes(500, 1, 120), 120);
    assert.equal(clampMinutes(-3, 1, 120), 1);
    assert.equal(clampMinutes(14.9, 1, 120), 14);
  });

  test('unusable numbers fall back to the minimum', () => {
    assert.equal(clampMinutes(Number.NaN, 1, 120), 1);
    assert.equal(clampMinutes(Number.POSITIVE_INFINITY, 1, 120), 1);
  });
});

describe('newEndTime', () => {
  const end = '2026-10-01T06:10:00.000Z';

  test('adds minutes to the current end time', () => {
    assert.equal(newEndTime(end, 15)?.toISOString(), '2026-10-01T06:25:00.000Z');
    assert.equal(newEndTime(new Date(end), 60)?.toISOString(), '2026-10-01T07:10:00.000Z');
  });

  test('clamps to the per-request limit so the preview matches what the server allows', () => {
    assert.equal(newEndTime(end, 999)?.toISOString(), '2026-10-01T08:10:00.000Z');
    assert.equal(newEndTime(end, -20)?.toISOString(), end);
    assert.equal(newEndTime(end, 90, 30)?.toISOString(), '2026-10-01T06:40:00.000Z');
  });

  test('an unreadable end time gives null, not a crash', () => {
    assert.equal(newEndTime('not a date', 15), null);
    assert.equal(newEndTime('', 15), null);
  });
});

describe('formatClock', () => {
  test('formats a time of day without a date', () => {
    assert.match(formatClock('2026-10-01T06:10:00.000Z'), /^\d{1,2}:\d{2}\s?(am|pm)$/i);
  });

  test('unreadable or missing values become an em dash', () => {
    assert.equal(formatClock('nope'), '—');
    assert.equal(formatClock(null), '—');
    assert.equal(formatClock(undefined), '—');
  });
});

describe('picker state', () => {
  test('15 minutes is preselected for live additions', () => {
    assert.deepEqual(initialPicker(ADD_TIME_PRESETS, 15, 120), { choice: '15', custom: '' });
  });

  test('falls back to the largest preset that still fits, then to Custom', () => {
    assert.deepEqual(initialPicker(ADD_TIME_PRESETS, 15, 10), { choice: '10', custom: '' });
    assert.deepEqual(initialPicker(ADD_TIME_PRESETS, 15, 3), { choice: 'custom', custom: '' });
    assert.deepEqual(initialPicker(ADD_TIME_PRESETS, 15, 0), { choice: 'custom', custom: '' });
  });

  test('an existing value maps to its preset, or to Custom holding the number', () => {
    assert.deepEqual(pickerFor(PRESTART_PRESETS, 30), { choice: '30', custom: '' });
    assert.deepEqual(pickerFor(PRESTART_PRESETS, 0), { choice: '0', custom: '' });
    assert.deepEqual(pickerFor(PRESTART_PRESETS, 25), { choice: 'custom', custom: '25' });
  });

  test('resolvePicker reads a preset directly and validates Custom text', () => {
    assert.deepEqual(resolvePicker({ choice: '30', custom: '' }, 1, 120), { ok: true, minutes: 30 });
    assert.deepEqual(resolvePicker({ choice: '0', custom: '' }, 1, 120), { ok: true, minutes: 0 });
    assert.deepEqual(resolvePicker({ choice: 'custom', custom: '45' }, 1, 120), {
      ok: true,
      minutes: 45,
    });
    assert.equal(resolvePicker({ choice: 'custom', custom: '' }, 1, 120).ok, false);
    assert.equal(resolvePicker({ choice: 'custom', custom: '200' }, 1, 120).ok, false);
  });

  test('a preset above the current ceiling is refused', () => {
    assert.equal(resolvePicker({ choice: '60', custom: '' }, 1, 30).ok, false);
  });
});

describe('extraBadge', () => {
  test('reads as "+15 min"', () => {
    assert.equal(extraBadge(15), '+15 min');
  });
});

describe('matchesStudentQuery', () => {
  const student = { name: 'Aarav Sharma', rollNumber: 'CS2024-017', section: 'B' };

  test('matches name, roll number and section, ignoring case and padding', () => {
    assert.equal(matchesStudentQuery(student, 'aarav'), true);
    assert.equal(matchesStudentQuery(student, ' cs2024-017 '), true);
    assert.equal(matchesStudentQuery(student, 'b'), true);
  });

  test('an empty query matches everyone; a miss matches no one', () => {
    assert.equal(matchesStudentQuery(student, ''), true);
    assert.equal(matchesStudentQuery(student, '   '), true);
    assert.equal(matchesStudentQuery(student, 'zzz'), false);
  });
});

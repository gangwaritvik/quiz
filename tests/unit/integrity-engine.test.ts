import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ExamEventType } from '@prisma/client';

import {
  computeIntegrity,
  INTEGRITY_THRESHOLDS,
  severityForEvent,
  statusForScore,
} from '@/lib/integrity-engine';

type Ev = Parameters<typeof computeIntegrity>[0][number];
const ev = (type: ExamEventType, extra: Partial<Ev> = {}): Ev => ({ type, ...extra });
const times = (n: number, type: ExamEventType, extra: Partial<Ev> = {}) =>
  Array.from({ length: n }, () => ev(type, extra));

describe('computeIntegrity: scoring', () => {
  test('no events is a perfect, normal score with every headline signal reported clean', () => {
    const out = computeIntegrity([]);
    assert.equal(out.score, 100);
    assert.equal(out.status, 'NORMAL');
    assert.deepEqual(out.breakdown, []);
    assert.equal(out.eventCount, 0);
    assert.equal(out.clean.length, 5);
  });

  test('first occurrence costs base, each repeat costs the repeat rate', () => {
    assert.equal(computeIntegrity(times(1, 'TAB_SWITCH')).score, 92); // 8
    assert.equal(computeIntegrity(times(2, 'TAB_SWITCH')).score, 86); // 8 + 6
    assert.equal(computeIntegrity(times(3, 'TAB_SWITCH')).score, 80); // 8 + 6 + 6
  });

  test('a signal is capped no matter how often it repeats', () => {
    const out = computeIntegrity(times(50, 'TAB_SWITCH'));
    assert.equal(out.breakdown[0]!.penalty, 32);
    assert.equal(out.score, 68);
  });

  test('penalties from different signals add up', () => {
    const out = computeIntegrity([ev('PASTE_ATTEMPT'), ev('PRINT_ATTEMPT')]); // 10 + 12
    assert.equal(out.score, 78);
    assert.equal(out.status, 'REVIEW_RECOMMENDED');
  });

  test('score never drops below zero and ends HIGH_RISK', () => {
    const everything: ExamEventType[] = [
      'MULTIPLE_SESSION', 'DEVICE_MISMATCH', 'MULTIPLE_FACES', 'PRINT_ATTEMPT',
      'PASTE_ATTEMPT', 'TAB_SWITCH', 'SCREEN_SHARE_STOPPED',
    ];
    const out = computeIntegrity(everything.flatMap((t) => times(20, t)));
    assert.equal(out.score, 0);
    assert.equal(out.status, 'HIGH_RISK');
  });

  test('score is always an integer in 0..100', () => {
    for (let n = 0; n < 12; n += 1) {
      const { score } = computeIntegrity([...times(n, 'FULLSCREEN_EXIT'), ...times(n, 'COPY_ATTEMPT')]);
      assert.ok(Number.isInteger(score) && score >= 0 && score <= 100);
    }
  });

  test('breakdown reports count, penalty and summed duration (null durations count as 0)', () => {
    const out = computeIntegrity([
      ev('FULLSCREEN_EXIT', { durationMs: 1500 }),
      ev('FULLSCREEN_EXIT', { durationMs: null }),
      ev('FULLSCREEN_EXIT', { durationMs: 500 }),
    ]);
    assert.deepEqual(out.breakdown, [
      { type: 'FULLSCREEN_EXIT', label: 'Fullscreen exited', count: 3, penalty: 16, totalDurationMs: 2000 },
    ]);
  });

  test('breakdown is ordered by penalty, highest first', () => {
    const out = computeIntegrity([ev('IDLE_TIMEOUT'), ev('IDLE_TIMEOUT'), ev('PRINT_ATTEMPT'), ev('COPY_ATTEMPT')]);
    assert.deepEqual(out.breakdown.map((b) => b.type), ['PRINT_ATTEMPT', 'COPY_ATTEMPT', 'IDLE_TIMEOUT']);
  });

  test('clean list omits headline signals that occurred', () => {
    const out = computeIntegrity([ev('TAB_SWITCH'), ev('PASTE_ATTEMPT')]);
    assert.equal(out.clean.length, 3);
    assert.ok(!out.clean.some((c) => /tab switch|paste attempt/i.test(c)));
    assert.ok(out.clean.includes('No copy attempt recorded'));
  });

  test('eventCount counts every input event, scored or not', () => {
    assert.equal(computeIntegrity([ev('ANSWER_SAVED'), ev('TAB_SWITCH')]).eventCount, 2);
  });
});

describe('computeIntegrity: tolerance and neutral events', () => {
  test('neutral/informational events are never penalised', () => {
    const neutral: ExamEventType[] = [
      'ATTEMPT_STARTED', 'ATTEMPT_SUBMITTED', 'AUTO_SUBMITTED', 'ANSWER_SAVED',
      'WINDOW_FOCUS', 'FULLSCREEN_ENTER', 'NETWORK_ONLINE', 'ATTACHMENT_UPLOADED', 'ANSWER_GRADED',
    ];
    const out = computeIntegrity(neutral.flatMap((t) => times(30, t)));
    assert.equal(out.score, 100);
    assert.deepEqual(out.breakdown, []);
  });

  test('first window blur is tolerated; the second starts costing', () => {
    assert.equal(computeIntegrity(times(1, 'WINDOW_BLUR')).score, 100);
    assert.equal(computeIntegrity(times(2, 'WINDOW_BLUR')).score, 97); // 1 scored -> base 3
    assert.equal(computeIntegrity(times(3, 'WINDOW_BLUR')).score, 95); // base 3 + repeat 2
  });

  test('a tolerated signal still appears in the breakdown with zero penalty', () => {
    const out = computeIntegrity(times(1, 'WINDOW_BLUR'));
    assert.deepEqual(out.breakdown.map((b) => [b.type, b.count, b.penalty]), [['WINDOW_BLUR', 1, 0]]);
  });

  test('face-not-detected tolerates two occurrences', () => {
    assert.equal(computeIntegrity(times(2, 'FACE_NOT_DETECTED')).score, 100);
    assert.equal(computeIntegrity(times(3, 'FACE_NOT_DETECTED')).score, 96);
  });

  test('a fullscreen exit caused by a file picker is not scored, an ordinary one still is', () => {
    const picker = computeIntegrity(times(5, 'FULLSCREEN_EXIT', { metadata: { context: 'file-picker' } }));
    assert.equal(picker.score, 100);
    assert.deepEqual(picker.breakdown, []);
    assert.ok(computeIntegrity(times(1, 'FULLSCREEN_EXIT')).score < 100);
  });

  test('file-picker tags beyond the server allowance are scored like ordinary events', () => {
    const tagged = times(6, 'FULLSCREEN_EXIT', { metadata: { context: 'file-picker' } });
    assert.equal(computeIntegrity(tagged, 6).score, 100);
    assert.ok(computeIntegrity(tagged, 2).score < 100);
    assert.ok(computeIntegrity(tagged, 0).score < 100);
  });

  test('blur while a file picker is open is not scored and not counted in the breakdown', () => {
    const out = computeIntegrity(times(10, 'WINDOW_BLUR', { metadata: { context: 'file-picker' } }));
    assert.equal(out.score, 100);
    assert.deepEqual(out.breakdown, []);
    assert.equal(out.eventCount, 10);
  });

  test('file-picker blur does not use up the tolerance of ordinary blurs', () => {
    const events = [
      ...times(5, 'WINDOW_BLUR', { metadata: { context: 'file-picker' } }),
      ev('WINDOW_BLUR'),
    ];
    assert.equal(computeIntegrity(events).score, 100); // only 1 real blur -> tolerated
  });

  test('only WINDOW_BLUR gets the file-picker exemption', () => {
    const out = computeIntegrity([ev('TAB_SWITCH', { metadata: { context: 'file-picker' } })]);
    assert.equal(out.score, 92);
  });

  test('blur with other, missing or malformed metadata is still scored', () => {
    for (const metadata of [{ context: 'other' }, {}, null, 'file-picker', ['file-picker'], undefined]) {
      const out = computeIntegrity(times(2, 'WINDOW_BLUR', { metadata }));
      assert.equal(out.score, 97, JSON.stringify(metadata));
    }
  });

  test('event types without a rule are ignored rather than crashing', () => {
    const out = computeIntegrity([ev('NOT_A_REAL_EVENT' as ExamEventType)]);
    assert.equal(out.score, 100);
    assert.deepEqual(out.breakdown, []);
  });
});

describe('computeIntegrity: determinism', () => {
  const events: Ev[] = [
    ev('TAB_SWITCH', { durationMs: 900 }),
    ev('PASTE_ATTEMPT'),
    ev('WINDOW_BLUR'),
    ev('WINDOW_BLUR'),
    ev('FULLSCREEN_EXIT', { durationMs: 100 }),
    ev('TAB_SWITCH'),
    ev('WINDOW_BLUR', { metadata: { context: 'file-picker' } }),
    ev('ANSWER_SAVED'),
  ];

  test('same events in any order give the same score, status and counts', () => {
    const forward = computeIntegrity(events);
    for (const permuted of [[...events].reverse(), [...events.slice(3), ...events.slice(0, 3)]]) {
      const out = computeIntegrity(permuted);
      assert.equal(out.score, forward.score);
      assert.equal(out.status, forward.status);
      assert.deepEqual(out.breakdown, forward.breakdown);
    }
  });

  test('repeated calls do not mutate the input', () => {
    const copy = structuredClone(events);
    computeIntegrity(events);
    assert.deepEqual(events, copy);
  });

  test(
    'breakdown order is independent of event order when penalties tie',
    () => {
      const a = computeIntegrity([ev('COPY_ATTEMPT'), ev('CUT_ATTEMPT')]);
      const b = computeIntegrity([ev('CUT_ATTEMPT'), ev('COPY_ATTEMPT')]);
      assert.deepEqual(a.breakdown.map((x) => x.type), b.breakdown.map((x) => x.type));
    },
  );
});

describe('statusForScore', () => {
  test('boundaries: 85 and above NORMAL, 60-84 REVIEW_RECOMMENDED, below 60 HIGH_RISK', () => {
    assert.equal(INTEGRITY_THRESHOLDS.normal, 85);
    assert.equal(INTEGRITY_THRESHOLDS.review, 60);
    assert.equal(statusForScore(100), 'NORMAL');
    assert.equal(statusForScore(85), 'NORMAL');
    assert.equal(statusForScore(84), 'REVIEW_RECOMMENDED');
    assert.equal(statusForScore(60), 'REVIEW_RECOMMENDED');
    assert.equal(statusForScore(59), 'HIGH_RISK');
    assert.equal(statusForScore(0), 'HIGH_RISK');
  });
});

describe('severityForEvent', () => {
  test('maps rule base weight to HIGH (>=12), MEDIUM (>=6), LOW', () => {
    assert.equal(severityForEvent('PRINT_ATTEMPT'), 'HIGH');
    assert.equal(severityForEvent('MULTIPLE_SESSION'), 'HIGH');
    assert.equal(severityForEvent('TAB_SWITCH'), 'MEDIUM');
    assert.equal(severityForEvent('CONTEXT_MENU'), 'LOW');
  });
  test('neutral events are INFO', () => {
    assert.equal(severityForEvent('ANSWER_SAVED'), 'INFO');
    assert.equal(severityForEvent('FULLSCREEN_ENTER'), 'INFO');
  });
});

describe('computeIntegrity: network trouble is not misconduct', () => {
  test('dropped connections and missed heartbeats never lower the score', () => {
    const out = computeIntegrity([...times(20, 'NETWORK_OFFLINE'), ...times(20, 'HEARTBEAT_MISSED'), ev('NETWORK_ONLINE')]);
    assert.equal(out.score, 100);
    assert.equal(out.status, 'NORMAL');
    assert.deepEqual(out.breakdown, []);
  });

  test('they sit alongside a real signal without adding to it', () => {
    assert.equal(computeIntegrity([ev('TAB_SWITCH'), ...times(5, 'NETWORK_OFFLINE')]).score, 92);
  });
});

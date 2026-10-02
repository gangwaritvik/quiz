import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatSpan, groupIncidents, INCIDENT_GAP_MS, type IncidentEvent } from '@/lib/event-incidents';

const BASE = Date.parse('2026-10-01T09:00:00.000Z');

interface Ev extends IncidentEvent {
  id: string;
}

let seq = 0;
/** `at` is seconds after the attempt started, in server time. */
const ev = (type: string, at: number, extra: Partial<Ev> = {}): Ev => ({
  id: `e${seq++}`,
  type,
  occurredAt: new Date(BASE + at * 1000).toISOString(),
  durationMs: null,
  metadata: null,
  ...extra,
});

const ids = (list: Ev[]) => list.map((e) => e.id);

describe('groupIncidents: grouping rules', () => {
  test('no events, no incidents', () => {
    assert.deepEqual(groupIncidents([]), []);
  });

  test('blur + tab switch + focus is one incident, duration from the focus event', () => {
    const events = [
      ev('WINDOW_BLUR', 100),
      ev('TAB_SWITCH', 100),
      ev('WINDOW_FOCUS', 102, { durationMs: 23_000 }),
    ];
    const [incident, ...rest] = groupIncidents(events);
    assert.equal(rest.length, 0);
    assert.equal(incident!.kind, 'left-window');
    assert.equal(incident!.title, 'Left the exam window for 23 s');
    assert.equal(incident!.durationMs, 23_000);
    assert.equal(incident!.startedAt, events[0]!.occurredAt);
    assert.equal(incident!.endedAt, events[2]!.occurredAt);
    assert.deepEqual(ids(incident!.events), ids(events));
    assert.equal(incident!.routine, false);
  });

  test('without a reported duration the server-time span is used', () => {
    const [incident] = groupIncidents([ev('WINDOW_BLUR', 10), ev('WINDOW_FOCUS', 16)]);
    assert.equal(incident!.durationMs, 6000);
    assert.equal(incident!.title, 'Left the exam window for 6 s');
  });

  test('a focus event batched later still closes the episode when its duration reaches back', () => {
    // Blur/switch flushed at +8 s, focus flushed at +24 s: 16 s apart on the server clock.
    const events = [
      ev('WINDOW_BLUR', 108),
      ev('TAB_SWITCH', 108),
      ev('WINDOW_FOCUS', 124, { durationMs: 23_000 }),
    ];
    const out = groupIncidents(events);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.title, 'Left the exam window for 23 s');
  });

  test('alt-tab shortcut joins the open window episode but never starts one', () => {
    const events = [
      ev('TAB_SWITCH', 50, { metadata: { source: 'alt-tab-keydown' } }),
      ev('SHORTCUT_BLOCKED', 50, { metadata: { shortcut: 'Alt+Tab' } }),
      ev('WINDOW_BLUR', 51),
      ev('WINDOW_FOCUS', 55, { durationMs: 5000 }),
      ev('SHORTCUT_BLOCKED', 200, { metadata: { shortcut: 'Alt+Tab' } }),
      ev('SHORTCUT_BLOCKED', 300, { metadata: { shortcut: 'F12' } }),
    ];
    const out = groupIncidents(events);
    assert.deepEqual(
      out.map((i) => [i.kind, i.events.length]),
      [
        ['left-window', 4],
        ['event:SHORTCUT_BLOCKED', 1],
        ['event:SHORTCUT_BLOCKED', 1],
      ],
    );
  });

  test('fullscreen exit followed by enter is one incident', () => {
    const events = [ev('FULLSCREEN_EXIT', 30), ev('FULLSCREEN_ENTER', 34, { durationMs: 4000 })];
    const [incident] = groupIncidents(events);
    assert.equal(incident!.kind, 'left-fullscreen');
    assert.equal(incident!.title, 'Left full screen for 4 s');
    assert.equal(incident!.events.length, 2);
  });

  test('offline then online is one incident', () => {
    const events = [ev('NETWORK_OFFLINE', 300), ev('NETWORK_ONLINE', 300, { durationMs: 75_000 })];
    const [incident] = groupIncidents(events);
    assert.equal(incident!.kind, 'connection-lost');
    assert.equal(incident!.title, 'Connection lost for 1 min 15 s');
  });

  test('camera events close together fold into one; a lone one stays itself', () => {
    const folded = groupIncidents([
      ev('CAMERA_PERMISSION_LOST', 400),
      ev('CAMERA_STREAM_STOPPED', 402),
    ]);
    assert.equal(folded.length, 1);
    assert.equal(folded[0]!.kind, 'camera-lost');
    assert.equal(folded[0]!.durationMs, null);

    const lone = groupIncidents([ev('CAMERA_STREAM_STOPPED', 400)]);
    assert.equal(lone[0]!.kind, 'event:CAMERA_STREAM_STOPPED');
    assert.equal(lone[0]!.title, 'Camera stream stopped');
  });

  test('a start with no end stays one honest incident (blur at the end of the attempt)', () => {
    const events = [ev('ATTEMPT_STARTED', 0), ev('WINDOW_BLUR', 600), ev('ATTEMPT_SUBMITTED', 640)];
    const out = groupIncidents(events);
    assert.deepEqual(
      out.map((i) => i.kind),
      ['event:ATTEMPT_STARTED', 'left-window', 'event:ATTEMPT_SUBMITTED'],
    );
    assert.equal(out[1]!.title, 'Left the exam window (no return recorded)');
    assert.equal(out[1]!.durationMs, null);
    assert.deepEqual([out[0]!.routine, out[1]!.routine, out[2]!.routine], [true, false, true]);
  });

  test('a focus with no start stays a single event', () => {
    const [incident] = groupIncidents([ev('WINDOW_FOCUS', 20, { durationMs: 3000 })]);
    assert.equal(incident!.kind, 'event:WINDOW_FOCUS');
    assert.equal(incident!.title, 'Window regained focus');
    assert.equal(incident!.durationMs, 3000);
  });

  test('a gap larger than the limit splits the episode', () => {
    const gap = INCIDENT_GAP_MS / 1000 + 2;
    // Opening events too far apart.
    const split = groupIncidents([ev('WINDOW_BLUR', 0), ev('TAB_SWITCH', gap)]);
    assert.equal(split.length, 2);
    // Closing event too far from the opener, with no duration to vouch for it.
    const orphan = groupIncidents([ev('WINDOW_BLUR', 0), ev('WINDOW_FOCUS', gap)]);
    assert.deepEqual(
      orphan.map((i) => i.kind),
      ['left-window', 'event:WINDOW_FOCUS'],
    );
    // A reported duration that does not reach back to the opener does not vouch either.
    const unvouched = groupIncidents([ev('WINDOW_BLUR', 0), ev('WINDOW_FOCUS', 60, { durationMs: 2000 })]);
    assert.equal(unvouched.length, 2);
  });

  test('a gap exactly at the limit still groups', () => {
    const out = groupIncidents([ev('WINDOW_BLUR', 0), ev('WINDOW_FOCUS', INCIDENT_GAP_MS / 1000)]);
    assert.equal(out.length, 1);
  });

  test('two back-to-back episodes stay two incidents', () => {
    const out = groupIncidents([
      ev('WINDOW_BLUR', 10),
      ev('TAB_SWITCH', 10),
      ev('WINDOW_FOCUS', 14, { durationMs: 4000 }),
      ev('WINDOW_BLUR', 16),
      ev('TAB_SWITCH', 16),
      ev('WINDOW_FOCUS', 20, { durationMs: 4000 }),
    ]);
    assert.deepEqual(
      out.map((i) => i.events.length),
      [3, 3],
    );
  });

  test('unrelated events in the middle do not break an episode and stay separate', () => {
    const events = [
      ev('WINDOW_BLUR', 100),
      ev('COPY_ATTEMPT', 101),
      ev('NETWORK_OFFLINE', 102),
      ev('WINDOW_FOCUS', 104, { durationMs: 4000 }),
      ev('NETWORK_ONLINE', 106, { durationMs: 4000 }),
    ];
    const out = groupIncidents(events);
    assert.deepEqual(
      out.map((i) => [i.kind, ids(i.events)]),
      [
        ['left-window', [events[0]!.id, events[3]!.id]],
        ['event:COPY_ATTEMPT', [events[1]!.id]],
        ['connection-lost', [events[2]!.id, events[4]!.id]],
      ],
    );
  });
});

describe('groupIncidents: ordering and invariants', () => {
  test('incidents come out in time order of their first event, whatever the input order', () => {
    const a = ev('COPY_ATTEMPT', 5);
    const b = ev('PASTE_ATTEMPT', 50);
    const c = ev('CONTEXT_MENU', 500);
    const out = groupIncidents([c, a, b]);
    assert.deepEqual(
      out.map((i) => ids(i.events)[0]),
      [a.id, b.id, c.id],
    );
  });

  test('events with the same server timestamp keep their input order, and the client clock breaks ties', () => {
    const first = ev('COPY_ATTEMPT', 5);
    const second = ev('CUT_ATTEMPT', 5);
    assert.deepEqual(
      groupIncidents([first, second]).map((i) => i.events[0]!.id),
      [first.id, second.id],
    );

    // Same batch, delivered focus-first: the client timestamps restore the order.
    const blur = ev('WINDOW_BLUR', 5, { metadata: { clientTs: '2026-10-01T09:00:01.000Z' } });
    const focus = ev('WINDOW_FOCUS', 5, {
      durationMs: 3000,
      metadata: { clientTs: '2026-10-01T09:00:04.000Z' },
    });
    const out = groupIncidents([focus, blur]);
    assert.equal(out.length, 1);
    assert.deepEqual(ids(out[0]!.events), [blur.id, focus.id]);
  });

  test('is deterministic and does not mutate its input', () => {
    const events = [ev('WINDOW_FOCUS', 9, { durationMs: 5000 }), ev('WINDOW_BLUR', 4), ev('COPY_ATTEMPT', 6)];
    const snapshot = JSON.stringify(events);
    assert.deepEqual(groupIncidents(events), groupIncidents(events));
    assert.equal(JSON.stringify(events), snapshot);
  });

  test('every raw event lands in exactly one incident and ids are unique', () => {
    const events: Ev[] = [
      ev('ATTEMPT_STARTED', 0),
      ev('WINDOW_BLUR', 20),
      ev('TAB_SWITCH', 20),
      ev('FULLSCREEN_EXIT', 21),
      ev('WINDOW_FOCUS', 30, { durationMs: 10_000 }),
      ev('FULLSCREEN_ENTER', 31, { durationMs: 10_000 }),
      ev('PASTE_ATTEMPT', 40),
      ev('NETWORK_OFFLINE', 50),
      ev('CAMERA_STREAM_STOPPED', 52),
      ev('CAMERA_PERMISSION_LOST', 53),
      ev('WINDOW_BLUR', 90),
      ev('SHORTCUT_BLOCKED', 91, { metadata: { shortcut: 'Alt+Tab' } }),
      ev('FULLSCREEN_EXIT', 700),
      ev('MULTIPLE_FACES', 710),
      ev('ATTEMPT_SUBMITTED', 720),
    ];
    const out = groupIncidents(events, [{ type: 'PASTE_ATTEMPT', penalty: 10 }]);
    const flat = out.flatMap((i) => i.events);
    assert.equal(flat.length, events.length);
    assert.deepEqual(new Set(flat), new Set(events));
    assert.equal(new Set(out.map((i) => i.id)).size, out.length);
    for (const incident of out) assert.ok(incident.events.length > 0);
  });
});

describe('groupIncidents: scored hint', () => {
  const events = [
    ev('WINDOW_BLUR', 10),
    ev('TAB_SWITCH', 10),
    ev('WINDOW_FOCUS', 12, { durationMs: 2000 }),
    ev('NETWORK_OFFLINE', 100),
    ev('NETWORK_ONLINE', 101, { durationMs: 1000 }),
    ev('ATTEMPT_SUBMITTED', 200),
  ];

  test('omitted without a breakdown', () => {
    for (const incident of groupIncidents(events)) assert.equal('scored' in incident, false);
  });

  test('derived from penalised types in the breakdown', () => {
    const out = groupIncidents(events, [
      { type: 'TAB_SWITCH', penalty: 8 },
      { type: 'NETWORK_OFFLINE', penalty: 0 },
    ]);
    assert.deepEqual(
      out.map((i) => i.scored),
      [true, false, false],
    );
  });

  test('a file-picker blur is never reported as scored', () => {
    const [incident] = groupIncidents([ev('WINDOW_BLUR', 1, { metadata: { context: 'file-picker' } })], [
      { type: 'WINDOW_BLUR', penalty: 3 },
    ]);
    assert.equal(incident!.scored, false);
  });
});

describe('formatSpan', () => {
  test('reads naturally at each scale', () => {
    assert.equal(formatSpan(400), 'under 1 s');
    assert.equal(formatSpan(23_000), '23 s');
    assert.equal(formatSpan(60_000), '1 min');
    assert.equal(formatSpan(65_000), '1 min 5 s');
    assert.equal(formatSpan(3_720_000), '1 h 2 min');
  });
});

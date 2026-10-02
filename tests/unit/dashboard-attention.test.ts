import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildAttention,
  insightsSummary,
  quizStatusWord,
  sortQuizzesByRelevance,
  startsInLabel,
  waitingLabel,
  type AttentionInput,
} from '@/lib/dashboard-attention';

const H = 3_600_000;
const D = 24 * H;
const now = new Date('2026-10-01T12:00:00Z');
const at = (ms: number) => new Date(now.getTime() + ms);

type Q = { id: string; status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; startsAt: Date; endsAt: Date };
const quiz = (id: string, status: Q['status'], startsIn: number, endsIn: number): Q => ({
  id,
  status,
  startsAt: at(startsIn),
  endsAt: at(endsIn),
});

describe('quizStatusWord', () => {
  test('the four words, from status and dates', () => {
    assert.equal(quizStatusWord(quiz('a', 'DRAFT', -D, D), now), 'Draft');
    assert.equal(quizStatusWord(quiz('a', 'PUBLISHED', H, 2 * H), now), 'Scheduled');
    assert.equal(quizStatusWord(quiz('a', 'PUBLISHED', -H, H), now), 'Live');
    assert.equal(quizStatusWord(quiz('a', 'PUBLISHED', -2 * H, -H), now), 'Closed');
  });

  test('a draft is a draft whatever its dates say', () => {
    assert.equal(quizStatusWord(quiz('a', 'DRAFT', -2 * H, -H), now), 'Draft');
  });

  test('window edges: opening instant is live, closing instant is still live', () => {
    assert.equal(quizStatusWord(quiz('a', 'PUBLISHED', 0, H), now), 'Live');
    assert.equal(quizStatusWord(quiz('a', 'PUBLISHED', -H, 0), now), 'Live');
  });
});

describe('sortQuizzesByRelevance', () => {
  test('live, then upcoming, then drafts, then closed', () => {
    const sorted = sortQuizzesByRelevance(
      [
        quiz('closed', 'PUBLISHED', -3 * D, -2 * D),
        quiz('draft', 'DRAFT', D, 2 * D),
        quiz('later', 'PUBLISHED', 5 * D, 6 * D),
        quiz('live', 'PUBLISHED', -H, H),
        quiz('soon', 'PUBLISHED', 2 * H, 3 * H),
      ],
      now,
    );
    assert.deepEqual(
      sorted.map((q) => q.id),
      ['live', 'soon', 'later', 'draft', 'closed'],
    );
  });

  test('within a status: live closes soonest first, closed most recent first', () => {
    const sorted = sortQuizzesByRelevance(
      [
        quiz('live-late', 'PUBLISHED', -H, 5 * H),
        quiz('live-soon', 'PUBLISHED', -H, H),
        quiz('old', 'PUBLISHED', -9 * D, -8 * D),
        quiz('recent', 'PUBLISHED', -3 * D, -2 * D),
      ],
      now,
    );
    assert.deepEqual(
      sorted.map((q) => q.id),
      ['live-soon', 'live-late', 'recent', 'old'],
    );
  });

  test('drafts keep the order they were given, and the input is not mutated', () => {
    const input = [quiz('d1', 'DRAFT', 0, H), quiz('d2', 'DRAFT', 0, H), quiz('d3', 'DRAFT', 0, H)];
    const sorted = sortQuizzesByRelevance(input, now);
    assert.deepEqual(
      sorted.map((q) => q.id),
      ['d1', 'd2', 'd3'],
    );
    assert.notEqual(sorted, input);
  });
});

describe('waitingLabel / startsInLabel', () => {
  test('waiting reads in days, then hours, then under an hour', () => {
    assert.equal(waitingLabel(at(-20 * D), now), 'waiting 20 days');
    assert.equal(waitingLabel(at(-D), now), 'waiting 1 day');
    assert.equal(waitingLabel(at(-3 * H), now), 'waiting 3 hours');
    assert.equal(waitingLabel(at(-H), now), 'waiting 1 hour');
    assert.equal(waitingLabel(at(-10 * 60_000), now), 'waiting under an hour');
  });

  test('a wait in the future (clock skew) does not go negative', () => {
    assert.equal(waitingLabel(at(H), now), 'waiting under an hour');
  });

  test('starts in minutes below an hour, hours above', () => {
    assert.equal(startsInLabel(at(40 * 60_000), now), 'in 40 minutes');
    assert.equal(startsInLabel(at(60_000), now), 'in 1 minute');
    assert.equal(startsInLabel(at(3 * H), now), 'in 3 hours');
    assert.equal(startsInLabel(at(1000), now), 'in 1 minute');
  });
});

const empty: AttentionInput = {
  now,
  marking: [],
  flagged: 0,
  live: { students: 0, exams: 0, title: null },
  upcoming: [],
};

describe('buildAttention', () => {
  test('nothing that exists, no rows', () => {
    assert.deepEqual(buildAttention(empty), []);
  });

  test('marking: one row per quiz with the oldest wait and a by-question link', () => {
    const [row] = buildAttention({
      ...empty,
      marking: [
        { quizId: 'q 1', title: 'Physics', papers: 6, answers: 14, waitingSince: at(-20 * D) },
      ],
    });
    assert.equal(row.kind, 'MARKING');
    assert.equal(row.count, 14);
    assert.equal(row.text, 'answers waiting to be marked in Physics');
    assert.equal(row.detail, 'Oldest waiting 20 days · 6 papers');
    assert.equal(row.href, '/admin/grading/questions?quizId=q%201');
    assert.equal(row.action, 'Mark by question');
  });

  test('marking: singular wording, no wait when none is recorded, empty groups skipped', () => {
    const rows = buildAttention({
      ...empty,
      marking: [
        { quizId: 'a', title: 'A', papers: 1, answers: 1, waitingSince: null },
        { quizId: 'b', title: 'B', papers: 0, answers: 0, waitingSince: at(-D) },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, 'answer waiting to be marked in A');
    assert.equal(rows[0].detail, '1 paper');
  });

  test('flagged: links to the unreviewed needs-review queue', () => {
    const [row] = buildAttention({ ...empty, flagged: 3 });
    assert.equal(row.kind, 'FLAGGED');
    assert.equal(row.count, 3);
    assert.equal(row.href, '/admin/integrity?status=needs-review&reviewed=unreviewed');
    assert.match(row.text, /^attempts flagged/);
    assert.match(buildAttention({ ...empty, flagged: 1 })[0].text, /^attempt flagged/);
  });

  test('live: names the exam when there is one, counts exams when there are several', () => {
    const one = buildAttention({ ...empty, live: { students: 12, exams: 1, title: 'Chem' } })[0];
    assert.equal(one.href, '/admin/live');
    assert.equal(one.count, 12);
    assert.equal(one.text, 'students are sitting Chem right now');

    const many = buildAttention({ ...empty, live: { students: 1, exams: 2, title: null } })[0];
    assert.equal(many.text, 'student is sitting 2 exams right now');

    const unnamed = buildAttention({ ...empty, live: { students: 4, exams: 1, title: null } })[0];
    assert.equal(unnamed.text, 'students are sitting a live exam right now');
  });

  test('starting: only quizzes opening within 24 hours, soonest first', () => {
    const rows = buildAttention({
      ...empty,
      upcoming: [
        { id: 'far', title: 'Far', startsAt: at(25 * H), assigned: 9 },
        { id: 'late', title: 'Late', startsAt: at(10 * H), assigned: 30 },
        { id: 'soon', title: 'Soon', startsAt: at(3 * H), assigned: 42 },
        { id: 'past', title: 'Past', startsAt: at(-H), assigned: 5 },
      ],
    });
    assert.deepEqual(
      rows.map((r) => r.id),
      ['starting-soon', 'starting-late'],
    );
    assert.equal(rows[0].count, 42);
    assert.equal(rows[0].text, 'students assigned to Soon, which starts in 3 hours');
    assert.equal(rows[0].href, '/admin/quizzes/soon');
    assert.equal(rows[0].detail, null);
  });

  test('starting: exactly 24 hours ahead is included; zero assigned says so', () => {
    const [row] = buildAttention({
      ...empty,
      upcoming: [{ id: 'x', title: 'X', startsAt: at(24 * H), assigned: 0 }],
    });
    assert.equal(row.count, 0);
    assert.match(row.detail ?? '', /Nobody can sit it/);
  });

  test('starting: no more than three rows', () => {
    const upcoming = Array.from({ length: 5 }, (_, i) => ({
      id: `q${i}`,
      title: `Q${i}`,
      startsAt: at((i + 1) * H),
      assigned: 1,
    }));
    assert.equal(buildAttention({ ...empty, upcoming }).length, 3);
  });

  test('order is by time-criticality: live, starting, flagged, marking', () => {
    const rows = buildAttention({
      now,
      marking: [{ quizId: 'm', title: 'M', papers: 1, answers: 2, waitingSince: at(-D) }],
      flagged: 1,
      live: { students: 5, exams: 1, title: 'L' },
      upcoming: [{ id: 'u', title: 'U', startsAt: at(H), assigned: 3 }],
    });
    assert.deepEqual(
      rows.map((r) => r.kind),
      ['LIVE', 'STARTING', 'FLAGGED', 'MARKING'],
    );
  });
});

describe('insightsSummary', () => {
  test('average and participation on one line', () => {
    assert.equal(
      insightsSummary({
        averageScore: 57.9,
        scoredAttempts: 18,
        participation: [
          { assigned: 10, attempted: 5 },
          { assigned: 10, attempted: 8 },
        ],
      }),
      'Average 57.9% across 18 attempts · 65% participation',
    );
  });

  test('singular attempt, and parts that have no data are left out', () => {
    assert.equal(
      insightsSummary({ averageScore: 80, scoredAttempts: 1, participation: [] }),
      'Average 80% across 1 attempt',
    );
    assert.equal(
      insightsSummary({
        averageScore: null,
        scoredAttempts: 0,
        participation: [{ assigned: 4, attempted: 1 }],
      }),
      '25% participation',
    );
  });

  test('nothing at all', () => {
    assert.equal(
      insightsSummary({ averageScore: null, scoredAttempts: 0, participation: [] }),
      'No results yet',
    );
  });
});

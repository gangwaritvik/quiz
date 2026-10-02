/**
 * Pure logic behind the faculty home: what needs attention, which quizzes to
 * show first, and the status word for each. No I/O, so it is unit-tested and
 * shared by the overview route.
 */

export type QuizWord = 'Draft' | 'Scheduled' | 'Live' | 'Closed';

interface QuizDates {
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  startsAt: Date;
  endsAt: Date;
}

/**
 * The four words the quizzes list uses. Archived quizzes are shown there as
 * "Archived" but never reach the dashboard; they read as Closed if one does.
 */
export function quizStatusWord(quiz: QuizDates, now: Date): QuizWord {
  if (quiz.status === 'DRAFT') return 'Draft';
  if (quiz.status === 'ARCHIVED') return 'Closed';
  if (now < quiz.startsAt) return 'Scheduled';
  if (now <= quiz.endsAt) return 'Live';
  return 'Closed';
}

const RELEVANCE: Record<QuizWord, number> = { Live: 0, Scheduled: 1, Draft: 2, Closed: 3 };

/**
 * Live first (closing soonest), then upcoming (opening soonest), then drafts
 * in the order given, then closed (most recently closed first).
 */
export function sortQuizzesByRelevance<T extends QuizDates>(quizzes: T[], now: Date): T[] {
  return quizzes
    .map((quiz) => ({ quiz, word: quizStatusWord(quiz, now) }))
    .sort((a, b) => {
      if (a.word !== b.word) return RELEVANCE[a.word] - RELEVANCE[b.word];
      if (a.word === 'Live') return a.quiz.endsAt.getTime() - b.quiz.endsAt.getTime();
      if (a.word === 'Scheduled') return a.quiz.startsAt.getTime() - b.quiz.startsAt.getTime();
      if (a.word === 'Closed') return b.quiz.endsAt.getTime() - a.quiz.endsAt.getTime();
      return 0; // Draft: keep the caller's order (most recently edited first)
    })
    .map((entry) => entry.quiz);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How far ahead the "starting soon" rows look. */
export const STARTING_WINDOW_MS = DAY;

const plural = (n: number, singular: string, many = `${singular}s`) => (n === 1 ? singular : many);

/** "waiting 20 days", "waiting 3 hours", "waiting under an hour". */
export function waitingLabel(since: Date, now: Date): string {
  const ms = now.getTime() - since.getTime();
  if (ms >= DAY) {
    const days = Math.floor(ms / DAY);
    return `waiting ${days} ${plural(days, 'day')}`;
  }
  if (ms >= HOUR) {
    const hours = Math.floor(ms / HOUR);
    return `waiting ${hours} ${plural(hours, 'hour')}`;
  }
  return 'waiting under an hour';
}

/** "in 40 minutes", "in 3 hours". */
export function startsInLabel(startsAt: Date, now: Date): string {
  const minutes = Math.max(1, Math.ceil((startsAt.getTime() - now.getTime()) / MINUTE));
  if (minutes < 60) return `in ${minutes} ${plural(minutes, 'minute')}`;
  const hours = Math.round(minutes / 60);
  return `in ${hours} ${plural(hours, 'hour')}`;
}

export interface AttentionItem {
  id: string;
  kind: 'LIVE' | 'STARTING' | 'FLAGGED' | 'MARKING';
  /** The figure that leads the row. */
  count: number;
  /** What the count is of, as the rest of one plain sentence. */
  text: string;
  detail: string | null;
  href: string;
  /** Link text. */
  action: string;
}

export interface AttentionInput {
  now: Date;
  /** Answers waiting for a person, one entry per quiz, longest wait first. */
  marking: Array<{
    quizId: string;
    title: string;
    papers: number;
    answers: number;
    waitingSince: Date | null;
  }>;
  flagged: number;
  live: { students: number; exams: number; title: string | null };
  /** Published quizzes that have not opened yet. */
  upcoming: Array<{ id: string; title: string; startsAt: Date; assigned: number }>;
}

const MAX_STARTING_ROWS = 3;

/**
 * Things that exist and want a person, most time-critical first: students in
 * an exam now, an exam about to open, flagged attempts, then the marking
 * backlog. Anything that does not exist produces no row.
 */
export function buildAttention({
  now,
  marking,
  flagged,
  live,
  upcoming,
}: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (live.students > 0) {
    const where =
      live.exams === 1
        ? (live.title ?? 'a live exam')
        : `${live.exams} ${plural(live.exams, 'exam')}`;
    items.push({
      id: 'live',
      kind: 'LIVE',
      count: live.students,
      text: `${plural(live.students, 'student is', 'students are')} sitting ${where} right now`,
      detail: null,
      href: '/admin/live',
      action: 'Open live monitoring',
    });
  }

  upcoming
    .filter((quiz) => {
      const ahead = quiz.startsAt.getTime() - now.getTime();
      return ahead > 0 && ahead <= STARTING_WINDOW_MS;
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, MAX_STARTING_ROWS)
    .forEach((quiz) => {
      items.push({
        id: `starting-${quiz.id}`,
        kind: 'STARTING',
        count: quiz.assigned,
        text: `${plural(quiz.assigned, 'student')} assigned to ${quiz.title}, which starts ${startsInLabel(quiz.startsAt, now)}`,
        detail: quiz.assigned === 0 ? 'Nobody can sit it until students are assigned.' : null,
        href: `/admin/quizzes/${encodeURIComponent(quiz.id)}`,
        action: 'Open quiz',
      });
    });

  if (flagged > 0) {
    items.push({
      id: 'flagged',
      kind: 'FLAGGED',
      count: flagged,
      text: `${plural(flagged, 'attempt')} flagged for integrity review and not yet reviewed`,
      detail: null,
      href: '/admin/integrity?status=needs-review&reviewed=unreviewed',
      action: 'Review flagged attempts',
    });
  }

  for (const group of marking) {
    if (group.answers <= 0) continue;
    const papers = `${group.papers} ${plural(group.papers, 'paper')}`;
    items.push({
      id: `marking-${group.quizId}`,
      kind: 'MARKING',
      count: group.answers,
      text: `${plural(group.answers, 'answer')} waiting to be marked in ${group.title}`,
      detail: group.waitingSince
        ? `Oldest ${waitingLabel(group.waitingSince, now)} · ${papers}`
        : papers,
      href: `/admin/grading/questions?quizId=${encodeURIComponent(group.quizId)}`,
      action: 'Mark by question',
    });
  }

  return items;
}

/** One line for the collapsed Insights summary. */
export function insightsSummary(input: {
  averageScore: number | null;
  scoredAttempts: number;
  participation: Array<{ assigned: number; attempted: number }>;
}): string {
  const parts: string[] = [];

  if (input.averageScore !== null && input.scoredAttempts > 0) {
    parts.push(
      `Average ${input.averageScore}% across ${input.scoredAttempts} ${plural(input.scoredAttempts, 'attempt')}`,
    );
  }

  const assigned = input.participation.reduce((sum, row) => sum + row.assigned, 0);
  if (assigned > 0) {
    const attempted = input.participation.reduce((sum, row) => sum + row.attempted, 0);
    parts.push(`${Math.round((attempted / assigned) * 100)}% participation`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'No results yet';
}

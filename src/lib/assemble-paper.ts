import {
  DIFFICULTIES,
  type Difficulty,
  type DifficultyCounts,
  SEMANTIC_DUPLICATE,
  cosine,
  isNearDuplicate,
  sameNumbers,
  splitByMix,
} from '@/lib/ai/question-generation';

/*
 * Picks a fixed paper from the question bank: the difficulty mix asked for,
 * spread evenly over the topics, newest-used questions last, and never two
 * questions that mean the same. Pure, so the choices can be tested exactly.
 */

export interface Candidate {
  id: string;
  difficulty: Difficulty;
  topicId: string | null;
  /** What the question says, for comparing two questions. */
  text: string;
  usageCount: number;
  /** A cached meaning-vector, when the bank has one for this question. */
  vector?: number[] | null;
}

export interface Assembly {
  /** In paper order: easy first, then medium, then hard. */
  picked: Candidate[];
  /** Per difficulty, how many fewer than asked were found at that difficulty. */
  short: DifficultyCounts;
  /** Places filled with another difficulty because the bank had too few. */
  filledFromOther: number;
  /** Candidates left out because they repeat one already on the paper. */
  repeatsSkipped: number;
}

const NO_TOPIC = '__none__';

/** Two questions are the same if their words overlap, or their meaning-vectors are close, with the same numbers. */
export function repeats(a: Candidate, b: Candidate): boolean {
  if (isNearDuplicate(a.text, b.text)) return true;
  return Boolean(
    a.vector && b.vector && cosine(a.vector, b.vector) >= SEMANTIC_DUPLICATE && sameNumbers(a.text, b.text),
  );
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function assemblePaper(
  candidates: Candidate[],
  count: number,
  mix: DifficultyCounts,
  random: () => number = Math.random,
): Assembly {
  const targets = splitByMix(count, mix);
  // Random order, then the least-used first: ties are shuffled, not always the same questions.
  const pool = shuffled(candidates, random).sort((a, b) => a.usageCount - b.usageCount);

  const picked: Candidate[] = [];
  const pickedByTopic = new Map<string, number>();
  const taken = new Set<string>();
  let repeatsSkipped = 0;

  /** Takes up to `want` from `from`, always from the topic with the fewest picks so far. */
  const take = (from: Candidate[], want: number): Candidate[] => {
    const byTopic = new Map<string, Candidate[]>();
    for (const candidate of from) {
      const key = candidate.topicId ?? NO_TOPIC;
      byTopic.set(key, [...(byTopic.get(key) ?? []), candidate]);
    }
    const got: Candidate[] = [];
    while (got.length < want) {
      const open = [...byTopic].filter(([, list]) => list.length > 0);
      if (open.length === 0) break;
      open.sort(([a], [b]) => (pickedByTopic.get(a) ?? 0) - (pickedByTopic.get(b) ?? 0));
      const [topic, list] = open[0]!;
      const next = list.shift()!;
      if (taken.has(next.id)) continue;
      if (picked.some((chosen) => repeats(chosen, next)) || got.some((chosen) => repeats(chosen, next))) {
        repeatsSkipped += 1;
        continue;
      }
      got.push(next);
      pickedByTopic.set(topic, (pickedByTopic.get(topic) ?? 0) + 1);
    }
    for (const candidate of got) taken.add(candidate.id);
    return got;
  };

  const short = { EASY: 0, MEDIUM: 0, HARD: 0 } as DifficultyCounts;
  for (const level of DIFFICULTIES) {
    const got = take(pool.filter((candidate) => candidate.difficulty === level), targets[level]);
    picked.push(...got);
    short[level] = targets[level] - got.length;
  }

  // Still short: fill from whatever is left, rather than hand back a smaller paper.
  const missing = count - picked.length;
  let filledFromOther = 0;
  if (missing > 0) {
    const extra = take(pool.filter((candidate) => !taken.has(candidate.id)), missing);
    picked.push(...extra);
    filledFromOther = extra.length;
  }

  const order = (level: Difficulty) => DIFFICULTIES.indexOf(level);
  picked.sort((a, b) => order(a.difficulty) - order(b.difficulty));
  return { picked, short, filledFromOther, repeatsSkipped };
}

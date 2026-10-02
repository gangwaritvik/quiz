/*
 * Item analysis: how each question behaved across a quiz's submitted attempts.
 *
 * Pure so the maths can be tested without a database. Two classical measures:
 *  - facility: the share of the question's marks students earned on average
 *    (1 = everyone got it right, 0 = nobody did);
 *  - discrimination: facility among the top scorers minus facility among the
 *    bottom scorers, by total score (27% of attempts each end). A good question
 *    is answered better by strong students; near zero or negative means it does
 *    not separate them, and a negative value often means a wrong answer key.
 */

/** Fewer attempts than this and the top/bottom split is noise. */
export const MIN_ATTEMPTS_FOR_DISCRIMINATION = 10;
const TAIL_SHARE = 0.27;

export interface ItemQuestion {
  id: string;
  text: string;
  type: string;
  options: Array<{ id: string; text: string; isCorrect: boolean }>;
}

export interface ItemResponse {
  attemptId: string;
  /** The student's total score on that attempt. */
  attemptScore: number;
  questionId: string;
  /** Marks this question carried on this paper. */
  marks: number;
  answered: boolean;
  /** Marks awarded; null while a human has still to mark it. */
  awardedMarks: number | null;
  selectedOptionIds: string[];
}

export interface DistractorCount {
  optionId: string;
  text: string;
  correct: boolean;
  chosen: number;
}

export interface ItemStats {
  questionId: string;
  text: string;
  type: string;
  /** Submitted attempts whose paper contained this question. */
  served: number;
  answered: number;
  unanswered: number;
  /** Answers still waiting for a marker; left out of the averages. */
  unmarked: number;
  /** Mean share of the marks earned, 0..1; null when nothing could be measured. */
  facility: number | null;
  /** Top minus bottom group facility, -1..1; null when there are too few attempts. */
  discrimination: number | null;
  distractors: DistractorCount[];
  /** The wrong option picked most often, if any wrong option was picked. */
  mostChosenWrong: DistractorCount | null;
  notes: string[];
}

const ratio = (r: ItemResponse): number | null => {
  if (r.awardedMarks === null) return null;
  if (!r.answered) return 0;
  return r.marks > 0 ? Math.min(1, Math.max(0, r.awardedMarks / r.marks)) : 0;
};

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

/** Top and bottom groups of `rows` by attempt score. */
function tails(rows: ItemResponse[]): { upper: ItemResponse[]; lower: ItemResponse[] } {
  const sorted = [...rows].sort((a, b) => b.attemptScore - a.attemptScore);
  const k = Math.max(1, Math.ceil(sorted.length * TAIL_SHARE));
  return { upper: sorted.slice(0, k), lower: sorted.slice(-k) };
}

export function analyseItems(questions: ItemQuestion[], responses: ItemResponse[]): ItemStats[] {
  const byQuestion = new Map<string, ItemResponse[]>();
  for (const response of responses) {
    const list = byQuestion.get(response.questionId) ?? [];
    list.push(response);
    byQuestion.set(response.questionId, list);
  }

  return questions.map((question) => {
    const rows = byQuestion.get(question.id) ?? [];
    const answered = rows.filter((r) => r.answered).length;
    const unmarked = rows.filter((r) => r.awardedMarks === null).length;

    const measurable = rows.filter((r) => ratio(r) !== null);
    const facility = mean(measurable.map((r) => ratio(r)!));

    let discrimination: number | null = null;
    if (measurable.length >= MIN_ATTEMPTS_FOR_DISCRIMINATION) {
      const { upper, lower } = tails(measurable);
      const high = mean(upper.map((r) => ratio(r)!));
      const low = mean(lower.map((r) => ratio(r)!));
      if (high !== null && low !== null) discrimination = high - low;
    }

    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const id of new Set(row.selectedOptionIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const distractors = question.options.map((option) => ({
      optionId: option.id,
      text: option.text,
      correct: option.isCorrect,
      chosen: counts.get(option.id) ?? 0,
    }));
    const wrong = distractors.filter((d) => !d.correct && d.chosen > 0);
    const mostChosenWrong =
      wrong.length === 0 ? null : wrong.reduce((best, d) => (d.chosen > best.chosen ? d : best));

    const notes: string[] = [];
    if (facility !== null && measurable.length >= MIN_ATTEMPTS_FOR_DISCRIMINATION) {
      if (facility >= 0.9) notes.push('Very easy');
      if (facility <= 0.2) notes.push('Very hard');
    }
    if (discrimination !== null) {
      if (discrimination < 0) notes.push('Weaker students did better: check the answer key');
      else if (discrimination < 0.2) notes.push('Does not separate strong from weak');
    }

    return {
      questionId: question.id,
      text: question.text,
      type: question.type,
      served: rows.length,
      answered,
      unanswered: rows.length - answered,
      unmarked,
      facility,
      discrimination,
      distractors,
      mostChosenWrong,
      notes,
    };
  });
}

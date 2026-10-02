'use client';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** A quiz-wide marking scheme; null leaves each question's own setting in charge. */
export interface QuizMarkingValue {
  negativeMarkingPct: number | null;
  multiPartialCredit: boolean | null;
}

export const DEFAULT_MARKING: QuizMarkingValue = {
  negativeMarkingPct: null,
  multiPartialCredit: null,
};

const PER_QUESTION = 'question';

const PENALTY_OPTIONS = [
  { value: PER_QUESTION, label: 'As set on each question' },
  { value: '0', label: 'None' },
  { value: '25', label: 'Lose ¼ of the marks (25%)' },
  { value: '33', label: 'Lose ⅓ of the marks (33%)' },
  { value: '50', label: 'Lose ½ of the marks (50%)' },
] as const;

const PARTIAL_OPTIONS = [
  { value: PER_QUESTION, label: 'As set on each question' },
  { value: 'yes', label: 'Give credit for a correct subset' },
  { value: 'no', label: 'All or nothing' },
] as const;

/**
 * Marking rules for the whole quiz. They replace the per-question settings in
 * the question editor when chosen, and apply to attempts submitted after the
 * change; results already marked are not recalculated.
 */
export function MarkingSettings({
  value,
  onChange,
}: {
  value: QuizMarkingValue;
  onChange: (next: QuizMarkingValue) => void;
}) {
  const penalty = value.negativeMarkingPct === null ? PER_QUESTION : String(value.negativeMarkingPct);
  const partial =
    value.multiPartialCredit === null ? PER_QUESTION : value.multiPartialCredit ? 'yes' : 'no';

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="marking-penalty">Wrong answers</Label>
        <Select
          value={penalty}
          onValueChange={(next) =>
            onChange({
              ...value,
              negativeMarkingPct: next === PER_QUESTION ? null : Number(next),
            })
          }
        >
          <SelectTrigger id="marking-penalty" aria-label="Negative marking">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PENALTY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          A share of that question&apos;s own marks is deducted for a wrong answer. Unanswered
          questions never lose marks.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="marking-partial">Multiple-answer questions</Label>
        <Select
          value={partial}
          onValueChange={(next) =>
            onChange({
              ...value,
              multiPartialCredit: next === PER_QUESTION ? null : next === 'yes',
            })
          }
        >
          <SelectTrigger id="marking-partial" aria-label="Partial credit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PARTIAL_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Ticking any wrong option always scores the penalty, so ticking everything cannot earn
          credit.
        </p>
      </div>
    </div>
  );
}

/** One line for read-only places such as the quiz detail page. */
export function describeMarking(value: QuizMarkingValue): string[] {
  const lines: string[] = [];
  lines.push(
    value.negativeMarkingPct === null
      ? 'Negative marking: as set on each question'
      : value.negativeMarkingPct === 0
        ? 'Negative marking: none'
        : `Negative marking: lose ${value.negativeMarkingPct}% of a question's marks`,
  );
  lines.push(
    value.multiPartialCredit === null
      ? 'Multiple answers: as set on each question'
      : value.multiPartialCredit
        ? 'Multiple answers: partial credit'
        : 'Multiple answers: all or nothing',
  );
  return lines;
}

'use client';

import { BarChart3 } from 'lucide-react';

import { ErrorState } from '@/components/shared/error-state';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/use-api';
import { cn } from '@/lib/utils';

interface Distractor {
  optionId: string;
  text: string;
  correct: boolean;
  chosen: number;
}

interface ItemRow {
  questionId: string;
  text: string;
  type: string;
  served: number;
  answered: number;
  unanswered: number;
  unmarked: number;
  facility: number | null;
  discrimination: number | null;
  distractors: Distractor[];
  mostChosenWrong: Distractor | null;
  notes: string[];
}

interface ItemAnalysisData {
  attempts: number;
  truncated: boolean;
  minAttemptsForDiscrimination: number;
  questions: ItemRow[];
}

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

/** Discrimination as a signed two-decimal figure, or an em dash. */
const signed = (value: number | null) =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}`;

const GRID =
  'lg:grid lg:grid-cols-[2.5rem_minmax(0,1fr)_6rem_6rem_7rem] lg:items-start lg:gap-x-5';

/**
 * How each question performed across the submitted attempts: what share of the
 * marks students earned, whether strong students did better than weak ones,
 * and which wrong option drew the most picks. A guide for improving the next
 * paper, not a verdict on any student.
 */
export function ItemAnalysis({ quizId }: { quizId: string }) {
  const { data, error, initialLoading, refetch } = useApi<ItemAnalysisData>(
    `/api/admin/quizzes/${quizId}/item-analysis`,
  );

  if (error && !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (initialLoading || !data) {
    return (
      <div aria-busy="true">
        <SkeletonRows rows={5} />
      </div>
    );
  }
  if (data.attempts === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No submitted attempts yet"
        description="Once students submit, you will see how each question performed."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="max-w-2xl space-y-1.5 text-sm leading-relaxed text-muted-foreground">
        <p>
          Based on {data.attempts} submitted {data.attempts === 1 ? 'attempt' : 'attempts'}.{' '}
          <span className="font-medium text-foreground">Share earned</span> is the average share of
          the marks students got on the question.{' '}
          <span className="font-medium text-foreground">Separation</span> compares the top and bottom
          27% of scorers: close to +1 means strong students did much better; near zero or below
          means the question does not tell them apart.
        </p>
        {data.attempts < data.minAttemptsForDiscrimination ? (
          <p>
            Separation needs at least {data.minAttemptsForDiscrimination} attempts to mean
            anything, so it is not shown yet.
          </p>
        ) : null}
        {data.truncated ? <p>Showing the first {data.attempts} attempts only.</p> : null}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div
          className={cn(
            'hidden border-b border-border px-4 py-2.5 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground',
            GRID,
          )}
          aria-hidden
        >
          <span>#</span>
          <span>Question</span>
          <span>Share earned</span>
          <span>Separation</span>
          <span>Answered</span>
        </div>

        <ol className="divide-y divide-border">
          {data.questions.map((item, index) => (
            <li key={item.questionId} className={cn('grid gap-2 px-4 py-4', GRID)}>
              <span className="tabular text-sm text-muted-foreground">Q{index + 1}</span>

              <div className="min-w-0">
                <p className="line-clamp-2 break-words text-sm font-medium">{item.text}</p>

                {item.notes.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {item.notes.map((note) => (
                      <Badge key={note} variant="warning">
                        {note}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {item.distractors.length > 0 ? (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-primary underline-offset-4 hover:underline">
                      {item.mostChosenWrong
                        ? `Most chosen wrong option: ${item.mostChosenWrong.chosen} ${
                            item.mostChosenWrong.chosen === 1 ? 'pick' : 'picks'
                          }`
                        : 'Option picks'}
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {item.distractors.map((option) => (
                        <li key={option.optionId} className="flex items-baseline gap-2">
                          <span className="tabular w-8 shrink-0 text-right text-muted-foreground">
                            {option.chosen}
                          </span>
                          <span
                            className={cn(
                              'min-w-0 break-words',
                              option.correct && 'font-medium text-success',
                            )}
                          >
                            {option.text}
                            {option.correct ? (
                              <span className="sr-only"> (correct answer)</span>
                            ) : null}
                          </span>
                          {option.correct ? (
                            <Badge variant="success" className="shrink-0" aria-hidden>
                              Correct
                            </Badge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>

              <p className="tabular text-sm">
                <span className="text-xs text-muted-foreground lg:hidden">Share earned </span>
                <span className="font-semibold">{percent(item.facility)}</span>
              </p>
              <p className="tabular text-sm">
                <span className="text-xs text-muted-foreground lg:hidden">Separation </span>
                <span className="font-semibold">{signed(item.discrimination)}</span>
              </p>
              <p className="tabular text-sm text-muted-foreground">
                {item.answered}/{item.served}
                {item.unmarked > 0 ? <span className="block text-xs">{item.unmarked} to mark</span> : null}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

'use client';

import { Check, Flag, Lock } from 'lucide-react';
import * as React from 'react';

import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export interface NavigatorQuestion {
  attemptQuestionId: string;
  position: number;
  answered: boolean;
  markedForReview: boolean;
}

interface QuestionNavigatorProps {
  questions: NavigatorQuestion[];
  currentIndex: number;
  onSelect: (index: number) => void;
  /**
   * When true, students can only navigate to the current question or any
   * question they have already visited (index <= highestVisited). They cannot
   * jump ahead, and — because this mirrors linear exam convention — they also
   * cannot go back once they move forward.
   */
  lockNavigation?: boolean;
  /**
   * The highest question index the student has reached so far. Used to
   * determine which questions are accessible when lockNavigation is true.
   */
  highestVisited?: number;
}

/*
 * One style per status, shared by the grid and its legend so the key always
 * matches. No transitions: the "current" marker must jump, not glide.
 */
const STATUS_CLASSES = {
  unanswered: 'border-input bg-card text-foreground',
  answered: 'border-primary/50 bg-accent text-accent-foreground',
  flagged: 'border-warning/60 bg-warning-subtle text-warning',
  locked: 'border-dashed border-border bg-muted text-muted-foreground',
} as const;

/**
 * The question grid.
 *
 * Status is encoded three ways — fill colour, icon, and an off-screen text
 * label — so it is legible without colour perception and to a screen reader.
 * The current question gets an inset ink border and an underlined number,
 * kept distinct from the focus outline (which sits outside the cell).
 */
export function QuestionNavigator({
  questions,
  currentIndex,
  onSelect,
  lockNavigation = false,
  highestVisited = 0,
}: QuestionNavigatorProps) {
  const answered = questions.filter((q) => q.answered).length;
  const flagged = questions.filter((q) => q.markedForReview).length;
  const progress = questions.length > 0 ? (answered / questions.length) * 100 : 0;

  return (
    <div className="flex h-full flex-col gap-0">
      {/* Header row */}
      <div className="flex items-baseline justify-between">
        <h2 className="font-sans text-sm font-semibold">Questions</h2>
        <p className="tabular text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{answered}</span>
          <span className="mx-0.5">/</span>
          {questions.length} answered
        </p>
      </div>

      {/* Progress bar */}
      <Progress
        value={progress}
        className="mt-2.5 h-1.5"
        indicatorClassName="transition-none"
        aria-label={`${answered} of ${questions.length} questions answered`}
      />

      {/* Navigation hint for locked exams */}
      {lockNavigation ? (
        <p className="mt-3 flex items-center gap-1.5 rounded-sm bg-warning-subtle px-2 py-1.5 text-xs font-medium text-warning">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          Linear order — you cannot go back
        </p>
      ) : null}

      {/* Question grid */}
      <div
        role="group"
        aria-label="Question navigation"
        className="mt-4 grid auto-rows-max grid-cols-5 gap-1.5"
      >
        {questions.map((question, index) => {
          const isCurrent = index === currentIndex;
          const isLocked = lockNavigation && index > highestVisited && !isCurrent;
          const status = question.markedForReview
            ? 'flagged'
            : question.answered
              ? 'answered'
              : 'unanswered';

          return (
            <button
              key={question.attemptQuestionId}
              type="button"
              onClick={() => !isLocked && onSelect(index)}
              disabled={isLocked}
              aria-current={isCurrent ? 'true' : undefined}
              aria-disabled={isLocked}
              title={
                isLocked
                  ? 'This question is not yet accessible'
                  : status === 'flagged'
                    ? `Q${index + 1} — marked for review`
                    : status === 'answered'
                      ? `Q${index + 1} — answered`
                      : `Q${index + 1} — not answered`
              }
              className={cn(
                'tabular relative flex aspect-square min-h-11 items-center justify-center rounded-md border text-sm font-semibold',
                STATUS_CLASSES[isLocked ? 'locked' : status],
                isLocked
                  ? 'cursor-not-allowed'
                  : status === 'unanswered'
                    ? 'hover:bg-muted'
                    : 'hover:border-foreground/40',
                isCurrent && 'shadow-[inset_0_0_0_2px_hsl(var(--foreground))]',
              )}
            >
              <span className={cn('leading-none', isCurrent && 'underline underline-offset-4')}>
                {index + 1}
              </span>

              {/* Status marks — answered and flagged can both show. */}
              {isLocked ? (
                <Lock className="absolute bottom-1 right-1 size-2.5" aria-hidden />
              ) : (
                <>
                  {question.answered ? (
                    <Check
                      className="absolute bottom-1 right-1 size-2.5 text-primary"
                      strokeWidth={3.5}
                      aria-hidden
                    />
                  ) : null}
                  {question.markedForReview ? (
                    <Flag
                      className="absolute right-1 top-1 size-2.5 fill-warning text-warning"
                      aria-hidden
                    />
                  ) : null}
                </>
              )}

              <span className="sr-only">
                {`, ${
                  isLocked
                    ? 'locked'
                    : status === 'flagged'
                      ? 'marked for review'
                      : status === 'answered'
                        ? 'answered'
                        : 'not answered'
                }${isCurrent ? ', current question' : ''}`}
              </span>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <dl className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
        <LegendRow
          swatch={<span className={cn('block size-4 rounded-sm border', STATUS_CLASSES.unanswered)} />}
          label="Not answered"
          count={questions.filter((q) => !q.answered && !q.markedForReview).length}
        />
        <LegendRow
          swatch={
            <span className={cn('flex size-4 items-center justify-center rounded-sm border', STATUS_CLASSES.answered)}>
              <Check className="size-2.5 text-primary" strokeWidth={3.5} />
            </span>
          }
          label="Answered"
          count={answered}
        />
        <LegendRow
          swatch={
            <span className={cn('flex size-4 items-center justify-center rounded-sm border', STATUS_CLASSES.flagged)}>
              <Flag className="size-2.5 fill-warning text-warning" />
            </span>
          }
          label="Marked for review"
          count={flagged}
        />
        {lockNavigation ? (
          <LegendRow
            swatch={
              <span className={cn('flex size-4 items-center justify-center rounded-sm border', STATUS_CLASSES.locked)}>
                <Lock className="size-2.5" />
              </span>
            }
            label="Not yet accessible"
            count={questions.length - Math.min(highestVisited + 1, questions.length)}
          />
        ) : null}
      </dl>
    </div>
  );
}

function LegendRow({
  swatch,
  label,
  count,
}: {
  swatch: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <dt className="flex flex-1 items-center gap-2 text-muted-foreground">
        <span className="shrink-0" aria-hidden>
          {swatch}
        </span>
        {label}
      </dt>
      <dd className="tabular font-medium text-foreground">{count}</dd>
    </div>
  );
}

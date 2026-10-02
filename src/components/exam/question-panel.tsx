'use client';

import { ArrowLeft, ArrowRight, Check, Flag, Loader2 } from 'lucide-react';
import * as React from 'react';

import {
  AssertionReasonStem,
  ImageAnswerInput,
  LongAnswerInput,
  MultipleChoiceInput,
  ShortAnswerInput,
  SingleChoiceInput,
  type ExamAttachment,
  type ExamOption,
} from '@/components/exam/answer-inputs';
import { MathText } from '@/components/shared/math-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, pluralize } from '@/lib/utils';

export type ExamQuestionType =
  | 'MCQ_SINGLE'
  | 'MCQ_MULTI'
  | 'TRUE_FALSE'
  | 'ASSERTION_REASON'
  | 'SHORT_ANSWER'
  | 'LONG_ANSWER'
  | 'IMAGE_ANSWER';

export interface ExamQuestion {
  attemptQuestionId: string;
  position: number;
  text: string;
  type: ExamQuestionType;
  marks: number;
  topic: string | null;
  assertionText: string | null;
  reasonText: string | null;
  imageUrl: string | null;
  options: ExamOption[];
  maxWords: number | null;
  maxAttachments: number;
  selectedOptionId: string | null;
  selectedOptionIds: string[];
  textResponse: string | null;
  attachments: ExamAttachment[];
  markedForReview: boolean;
  /** Computed by the server — "answered" means different things per type. */
  answered: boolean;
}

/** What the student changed. The panel does not know how answers are persisted. */
export type AnswerChange =
  | { kind: 'option'; selectedOptionId: string }
  | { kind: 'options'; selectedOptionIds: string[] }
  | { kind: 'text'; textResponse: string };

const TYPE_HINT: Record<ExamQuestionType, string | null> = {
  MCQ_SINGLE: 'Choose one option',
  MCQ_MULTI: 'Select all correct options',
  TRUE_FALSE: 'Choose one option',
  ASSERTION_REASON: 'Read both statements, then choose the option that describes them',
  SHORT_ANSWER: 'Type your answer',
  LONG_ANSWER: 'Write your answer',
  IMAGE_ANSWER: 'Upload a photograph of your written work',
};

interface QuestionPanelProps {
  question: ExamQuestion;
  index: number;
  total: number;
  saving: boolean;
  /** Epoch ms of the last successful save of this question, if known. */
  savedAt?: number;
  /** True while a change is queued locally (save failed, will retry). */
  unsaved?: boolean;
  uploading: boolean;
  onAnswerChange: (change: AnswerChange) => void;
  onUploadAttachment: (file: File) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onPickerOpen: () => void;
  onToggleReview: () => void;
  /** When undefined the Previous button is hidden (e.g. lockQuestionNavigation mode). */
  onPrevious?: () => void;
  onNext: () => void;
  onOpenSubmit: () => void;
}

/**
 * The question itself — a sheet of paper.
 *
 * Deliberately still: no entrance animations or transitions, because
 * re-animating on every navigation is a distraction in a timed exam. Prose is
 * held to a ~70-character measure so long stems read comfortably for an hour,
 * and the footer stays in reach (sticky) however long the question runs.
 */
export function QuestionPanel({
  question,
  index,
  total,
  saving,
  savedAt,
  unsaved,
  uploading,
  onAnswerChange,
  onUploadAttachment,
  onRemoveAttachment,
  onPickerOpen,
  onToggleReview,
  onPrevious,
  onNext,
  onOpenSubmit,
}: QuestionPanelProps) {
  const isLast = index === total - 1;
  const hint = TYPE_HINT[question.type];

  return (
    <section
      aria-labelledby="question-heading"
      className="flex h-full flex-col rounded-lg border border-border bg-card"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-5 py-3 sm:px-8">
        <h2 id="question-heading" className="tabular text-xl">
          Question {index + 1}
          <span className="font-sans text-sm font-normal text-muted-foreground"> / {total}</span>
        </h2>
        {question.topic ? (
          <Badge variant="outline" className="hidden sm:inline-flex">
            {question.topic}
          </Badge>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
            {saving ? (
              <>
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Saving...
              </>
            ) : question.answered && !unsaved ? (
              <>
                <Check className="size-3" aria-hidden />
                Saved
                {/* Time is aria-hidden so the live region only speaks on status change. */}
                {savedAt ? (
                  <span className="tabular" aria-hidden>
                    {' '}
                    {new Date(savedAt).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                ) : null}
              </>
            ) : null}
          </span>
          {question.markedForReview ? (
            <Badge variant="warning">
              <Flag className="fill-current" aria-hidden />
              Marked
            </Badge>
          ) : null}
          <Badge variant="secondary" className="tabular">
            {pluralize(question.marks, 'mark')}
          </Badge>
        </div>
      </header>

      <div className="flex-1 px-5 py-7 sm:px-8 sm:py-10">
        <div className="mx-auto w-full max-w-[42rem] break-words">
          <MathText
            as="p"
            text={question.text}
            className="font-serif text-lg leading-[1.75] text-foreground sm:text-[1.1875rem]"
          />

          {question.imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- served from
               an authorised route, so Next's image optimiser cannot fetch it. */
            <img
              src={question.imageUrl}
              alt="Diagram accompanying this question"
              // White backing keeps transparent diagrams legible in dark mode.
              className="mt-6 block h-auto max-h-[28rem] w-auto max-w-full rounded-md border border-border bg-white object-contain"
            />
          ) : null}

          {question.type === 'ASSERTION_REASON' &&
          question.assertionText &&
          question.reasonText ? (
            <AssertionReasonStem
              assertion={question.assertionText}
              reason={question.reasonText}
            />
          ) : null}

          {hint ? <p className="mt-8 text-sm font-medium text-muted-foreground">{hint}</p> : null}

          <div className={hint ? 'mt-3' : 'mt-8'}>
            <AnswerArea
              question={question}
              index={index}
              uploading={uploading}
              onAnswerChange={onAnswerChange}
              onUploadAttachment={onUploadAttachment}
              onRemoveAttachment={onRemoveAttachment}
              onPickerOpen={onPickerOpen}
            />
          </div>
        </div>
      </div>

      <footer className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-b-lg border-t border-border bg-card px-5 py-3 sm:px-8">
        {onPrevious !== undefined ? (
          <Button variant="outline" size="lg" onClick={onPrevious} disabled={index === 0}>
            <ArrowLeft aria-hidden />
            <span className="hidden sm:inline">Previous</span>
            <span className="sm:hidden">Prev</span>
          </Button>
        ) : null}

        <Button
          variant="outline"
          size="lg"
          onClick={onToggleReview}
          aria-pressed={question.markedForReview}
          className={cn(
            question.markedForReview &&
              'border-warning/40 bg-warning-subtle text-warning hover:bg-warning-subtle hover:text-warning',
          )}
        >
          <Flag className={cn(question.markedForReview && 'fill-current')} aria-hidden />
          <span className="hidden sm:inline">
            {question.markedForReview ? 'Unmark' : 'Mark for review'}
          </span>
          <span className="sm:hidden">{question.markedForReview ? 'Unmark' : 'Mark'}</span>
        </Button>

        <div className="ml-auto">
          {isLast ? (
            <Button size="lg" onClick={onOpenSubmit}>
              Review &amp; submit
              <ArrowRight aria-hidden />
            </Button>
          ) : (
            <Button size="lg" onClick={onNext}>
              Save &amp; next
              <ArrowRight aria-hidden />
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
}

/** Picks the input for this question's type. */
function AnswerArea({
  question,
  index,
  uploading,
  onAnswerChange,
  onUploadAttachment,
  onRemoveAttachment,
  onPickerOpen,
}: {
  question: ExamQuestion;
  index: number;
  uploading: boolean;
  onAnswerChange: (change: AnswerChange) => void;
  onUploadAttachment: (file: File) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onPickerOpen: () => void;
}) {
  const questionNumber = index + 1;

  switch (question.type) {
    case 'MCQ_MULTI':
      return (
        <MultipleChoiceInput
          options={question.options}
          selectedOptionIds={question.selectedOptionIds}
          questionNumber={questionNumber}
          onChange={(selectedOptionIds) => onAnswerChange({ kind: 'options', selectedOptionIds })}
        />
      );

    case 'SHORT_ANSWER':
      return (
        <ShortAnswerInput
          value={question.textResponse ?? ''}
          questionNumber={questionNumber}
          onChange={(textResponse) => onAnswerChange({ kind: 'text', textResponse })}
        />
      );

    case 'LONG_ANSWER':
      return (
        <LongAnswerInput
          value={question.textResponse ?? ''}
          questionNumber={questionNumber}
          maxWords={question.maxWords}
          onChange={(textResponse) => onAnswerChange({ kind: 'text', textResponse })}
        />
      );

    case 'IMAGE_ANSWER':
      return (
        <ImageAnswerInput
          attachments={question.attachments}
          maxAttachments={question.maxAttachments}
          uploading={uploading}
          onUpload={onUploadAttachment}
          onRemove={onRemoveAttachment}
          onPickerOpen={onPickerOpen}
        />
      );

    default:
      return (
        <SingleChoiceInput
          options={question.options}
          selectedOptionId={question.selectedOptionId}
          questionNumber={questionNumber}
          onSelect={(selectedOptionId) => onAnswerChange({ kind: 'option', selectedOptionId })}
        />
      );
  }
}

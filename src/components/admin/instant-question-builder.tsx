'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowDown, ArrowUp, Check, Copy, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';

import { ImageUploadField } from '@/components/admin/image-upload-field';
import { MathText } from '@/components/shared/math-text';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ASSERTION_REASON_OPTIONS, TRUE_FALSE_OPTIONS } from '@/lib/grading';
import { cn } from '@/lib/utils';

/** Every question type, writable inline. */
export type InstantQuestionType =
  | 'MCQ_SINGLE'
  | 'MCQ_MULTI'
  | 'TRUE_FALSE'
  | 'ASSERTION_REASON'
  | 'SHORT_ANSWER'
  | 'LONG_ANSWER'
  | 'IMAGE_ANSWER';

const TYPE_LABELS: Record<InstantQuestionType, string> = {
  MCQ_SINGLE: 'Multiple choice — one answer',
  MCQ_MULTI: 'Multiple choice — several answers',
  TRUE_FALSE: 'True or false',
  ASSERTION_REASON: 'Assertion and reason',
  SHORT_ANSWER: 'Short written answer',
  LONG_ANSWER: 'Long written answer',
  IMAGE_ANSWER: 'Photograph of written work',
};

/** Types whose options the teacher writes; the rest are graded another way. */
const OPTION_TYPES: ReadonlySet<InstantQuestionType> = new Set<InstantQuestionType>([
  'MCQ_SINGLE',
  'MCQ_MULTI',
  'TRUE_FALSE',
  'ASSERTION_REASON',
]);

/**
 * Types whose option set is prescribed. Students are taught to rely on the
 * wording and the order, so neither is the teacher's to edit — and the exam
 * engine refuses to shuffle them for the same reason.
 */
const FIXED_OPTION_TYPES: ReadonlySet<InstantQuestionType> = new Set<InstantQuestionType>([
  'TRUE_FALSE',
  'ASSERTION_REASON',
]);

/** Hand-marked types: no answer key exists, so a rubric replaces one. */
const MANUAL_TYPES: ReadonlySet<InstantQuestionType> = new Set<InstantQuestionType>([
  'LONG_ANSWER',
  'IMAGE_ANSWER',
]);

export interface InstantOption {
  /** Local only — React keys and nothing else. */
  key: string;
  text: string;
  isCorrect: boolean;
}

export interface InstantQuestion {
  key: string;
  text: string;
  type: InstantQuestionType;
  marks: number;
  options: InstantOption[];
  /** SHORT_ANSWER: any one of these scores full marks. */
  acceptedAnswers: string;
  /** LONG_ANSWER / IMAGE_ANSWER: rubric for whoever marks it. Faculty-only. */
  modelAnswer: string;
  /** ASSERTION_REASON: the two statements. */
  assertionText: string;
  reasonText: string;
  /** IMAGE_ANSWER: how many photographs a student may attach. */
  maxAttachments: number;
  /** An optional diagram shown above the answer area. */
  imageAssetId: string | null;
}

let sequence = 0;
const nextKey = () => `q${++sequence}`;

function blankOption(text = ''): InstantOption {
  return { key: nextKey(), text, isCorrect: false };
}

export function blankQuestion(): InstantQuestion {
  return {
    key: nextKey(),
    text: '',
    type: 'MCQ_SINGLE',
    marks: 1,
    options: [blankOption(), blankOption()],
    acceptedAnswers: '',
    modelAnswer: '',
    assertionText: '',
    reasonText: '',
    maxAttachments: 3,
    imageAssetId: null,
  };
}

/** The prescribed option set for a type that has one, first choice correct. */
function fixedOptions(texts: readonly string[]): InstantOption[] {
  return texts.map((text, index) => ({ key: nextKey(), text, isCorrect: index === 0 }));
}

/** One question as the quiz detail route returns it. */
export interface SavedQuestion {
  id?: string;
  /** False for a question that belongs to this quiz alone. */
  inBank?: boolean;
  text: string;
  type: string;
  marks: number;
  assertionText: string | null;
  reasonText: string | null;
  acceptedAnswers: string[];
  modelAnswer: string | null;
  maxAttachments: number;
  imageAssetId: string | null;
  options: Array<{ text: string; isCorrect: boolean }>;
}

/** Loads a saved paper back into the builder for editing. */
export function fromSavedQuestion(saved: SavedQuestion): InstantQuestion {
  return {
    key: nextKey(),
    text: saved.text,
    type: saved.type as InstantQuestionType,
    marks: saved.marks,
    options: saved.options.map((option) => ({
      key: nextKey(),
      text: option.text,
      isCorrect: option.isCorrect,
    })),
    acceptedAnswers: saved.acceptedAnswers.join('\n'),
    modelAnswer: saved.modelAnswer ?? '',
    assertionText: saved.assertionText ?? '',
    reasonText: saved.reasonText ?? '',
    maxAttachments: saved.maxAttachments,
    imageAssetId: saved.imageAssetId,
  };
}

/**
 * Converts the form's shape into the API's. Kept here so the wire format lives
 * next to the editor that produces it.
 */
export function toApiQuestion(question: InstantQuestion) {
  const optionBased = OPTION_TYPES.has(question.type);
  const isAssertion = question.type === 'ASSERTION_REASON';
  return {
    text: question.text.trim(),
    type: question.type,
    marks: question.marks,
    difficulty: 'MEDIUM' as const,
    imageAssetId: question.imageAssetId,
    options: optionBased
      ? question.options.map((option) => ({
          text: option.text.trim(),
          isCorrect: option.isCorrect,
        }))
      : [],
    acceptedAnswers:
      question.type === 'SHORT_ANSWER'
        ? question.acceptedAnswers
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
        : [],
    modelAnswer: MANUAL_TYPES.has(question.type) ? question.modelAnswer.trim() : '',
    assertionText: isAssertion ? question.assertionText.trim() : '',
    reasonText: isAssertion ? question.reasonText.trim() : '',
    maxAttachments: question.type === 'IMAGE_ANSWER' ? question.maxAttachments : 3,
  };
}

/**
 * Client-side check mirroring the server's rules, so a teacher sees a problem
 * while writing rather than on submit. The server still re-validates.
 */
export function validateQuestion(question: InstantQuestion): string | null {
  if (question.text.trim().length < 5) return 'Write the question.';

  if (OPTION_TYPES.has(question.type)) {
    if (question.options.some((option) => option.text.trim().length === 0)) {
      return 'Every option needs text.';
    }
    const correct = question.options.filter((option) => option.isCorrect).length;
    if (question.type === 'MCQ_MULTI') {
      if (correct < 2) return 'Mark at least two options correct.';
    } else if (correct !== 1) {
      return 'Mark exactly one option correct.';
    }
  }

  if (question.type === 'ASSERTION_REASON') {
    if (question.assertionText.trim().length === 0) return 'Enter the assertion (A).';
    if (question.reasonText.trim().length === 0) return 'Enter the reason (R).';
  }

  if (question.type === 'SHORT_ANSWER' && question.acceptedAnswers.trim().length === 0) {
    return 'List at least one accepted answer.';
  }

  return null;
}

interface BuilderProps {
  questions: InstantQuestion[];
  onChange: (questions: InstantQuestion[]) => void;
  /** Set once the teacher has tried to publish, so errors are not premature. */
  showErrors?: boolean;
}

export function InstantQuestionBuilder({ questions, onChange, showErrors }: BuilderProps) {
  const update = (key: string, patch: Partial<InstantQuestion>) => {
    onChange(questions.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 0), 0);

  return (
    <div className="space-y-4">
      <AnimatePresence initial={false}>
        {questions.map((question, index) => (
          <motion.div
            key={question.key}
            layout
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <QuestionCard
              question={question}
              index={index}
              total={questions.length}
              error={showErrors ? validateQuestion(question) : null}
              onChange={(patch) => update(question.key, patch)}
              onRemove={() => onChange(questions.filter((q) => q.key !== question.key))}
              onDuplicate={() => {
                const copy: InstantQuestion = {
                  ...question,
                  key: nextKey(),
                  options: question.options.map((option) => ({ ...option, key: nextKey() })),
                };
                const next = [...questions];
                next.splice(index + 1, 0, copy);
                onChange(next);
              }}
              onMove={(direction) => move(index, direction)}
            />
          </motion.div>
        ))}
      </AnimatePresence>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange([...questions, blankQuestion()])}
        >
          <Plus aria-hidden />
          Add question
        </Button>

        <p className="text-sm text-muted-foreground">
          <span className="tabular font-medium text-foreground">{questions.length}</span> question
          {questions.length === 1 ? '' : 's'} ·{' '}
          <span className="tabular font-medium text-foreground">{totalMarks}</span> mark
          {totalMarks === 1 ? '' : 's'} total
        </p>
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  index,
  total,
  error,
  onChange,
  onRemove,
  onDuplicate,
  onMove,
}: {
  question: InstantQuestion;
  index: number;
  total: number;
  error: string | null;
  onChange: (patch: Partial<InstantQuestion>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const optionBased = OPTION_TYPES.has(question.type);
  const fixedOptionSet = FIXED_OPTION_TYPES.has(question.type);
  const isAssertion = question.type === 'ASSERTION_REASON';

  const changeType = (type: InstantQuestionType) => {
    if (type === 'TRUE_FALSE') {
      onChange({ type, options: fixedOptions(TRUE_FALSE_OPTIONS) });
      return;
    }
    if (type === 'ASSERTION_REASON') {
      onChange({ type, options: fixedOptions(ASSERTION_REASON_OPTIONS) });
      return;
    }
    // Leaving a prescribed set behind would strand its wording on a type that
    // does not use it, so editable options are restored instead.
    const options =
      FIXED_OPTION_TYPES.has(question.type) || question.options.length < 2
        ? [blankOption(), blankOption()]
        : question.options;
    onChange({ type, options });
  };

  const setCorrect = (optionKey: string, checked: boolean) => {
    onChange({
      options: question.options.map((option) => {
        if (question.type === 'MCQ_MULTI') {
          return option.key === optionKey ? { ...option, isCorrect: checked } : option;
        }
        // Single-answer: choosing one clears the rest.
        return { ...option, isCorrect: option.key === optionKey };
      }),
    });
  };

  return (
    <section
      className={cn(
        'rounded-lg border bg-card transition-colors duration-fast ease-standard',
        error ? 'border-danger/50' : 'border-border',
      )}
      aria-label={`Question ${index + 1}`}
    >
      {/* Header: where this question sits, and what can be done to it. */}
      <div className="flex items-center gap-2 border-b border-border py-1.5 pl-4 pr-1.5 sm:pl-5">
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="text-base font-semibold text-foreground">
            Question <span className="tabular">{index + 1}</span>
          </span>
          <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
            {TYPE_LABELS[question.type]} ·{' '}
            <span className="tabular">{question.marks}</span> mark{question.marks === 1 ? '' : 's'}
          </span>
        </p>

        <div className="flex shrink-0 items-center">
          <IconAction
            label={`Move question ${index + 1} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp />
          </IconAction>
          <IconAction
            label={`Move question ${index + 1} down`}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </IconAction>
          <IconAction label={`Duplicate question ${index + 1}`} onClick={onDuplicate}>
            <Copy />
          </IconAction>
          <IconAction
            label={`Remove question ${index + 1}`}
            disabled={total === 1}
            onClick={onRemove}
            destructive
          >
            <Trash2 />
          </IconAction>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        <div className="space-y-2">
          <Label htmlFor={`text-${question.key}`}>Question</Label>
          <Textarea
            id={`text-${question.key}`}
            value={question.text}
            onChange={(event) => onChange({ text: event.target.value })}
            placeholder="Type your question. Use $x^2$ for maths."
            rows={2}
            aria-label={`Question ${index + 1} text`}
            className="text-[0.9375rem]"
          />
        </div>

        {question.text.includes('$') ? (
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="type-eyebrow">Preview</p>
            <MathText text={question.text} className="mt-1.5 block break-words text-sm leading-relaxed" />
          </div>
        ) : null}

        <ImageUploadField
          assetId={question.imageAssetId}
          onChange={(imageAssetId) => onChange({ imageAssetId })}
          kind="QUESTION_IMAGE"
          label="Add a diagram"
          compact
        />

        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <div className="space-y-2">
            <Label htmlFor={`type-${question.key}`}>Answer type</Label>
            <Select
              value={question.type}
              onValueChange={(value) => changeType(value as InstantQuestionType)}
            >
              <SelectTrigger id={`type-${question.key}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`marks-${question.key}`}>Marks</Label>
            <Input
              id={`marks-${question.key}`}
              type="number"
              min={1}
              max={20}
              value={question.marks}
              onChange={(event) =>
                onChange({ marks: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })
              }
              className="tabular"
            />
          </div>
        </div>

        {/* The answer: every type gets the same frame, so papers scan alike. */}
        <div className="space-y-4 border-t border-border pt-5">
          <p className="type-eyebrow">Answer</p>

          {isAssertion ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`assertion-${question.key}`}>Assertion (A)</Label>
                <Textarea
                  id={`assertion-${question.key}`}
                  value={question.assertionText}
                  onChange={(event) => onChange({ assertionText: event.target.value })}
                  placeholder="Water boils at 100 °C at sea level."
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`reason-${question.key}`}>Reason (R)</Label>
                <Textarea
                  id={`reason-${question.key}`}
                  value={question.reasonText}
                  onChange={(event) => onChange({ reasonText: event.target.value })}
                  placeholder="Atmospheric pressure at sea level is 1 atm."
                  rows={2}
                />
              </div>
            </div>
          ) : null}

          {optionBased ? (
            <div className="space-y-1.5">
              {question.options.map((option, optionIndex) => (
                <div
                  key={option.key}
                  className={cn(
                    'flex items-center gap-1 rounded-md pr-1 transition-colors duration-fast ease-standard',
                    option.isCorrect && 'bg-success-subtle/60',
                  )}
                >
                  {/* 40px hit area; the drawn mark inside stays small. */}
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={option.isCorrect}
                    aria-label={`Mark option ${optionIndex + 1} correct`}
                    onClick={() => setCorrect(option.key, !option.isCorrect)}
                    className="group/mark flex size-10 shrink-0 items-center justify-center rounded-md"
                  >
                    <span
                      className={cn(
                        'flex size-5 items-center justify-center border transition-colors duration-fast ease-standard',
                        question.type === 'MCQ_MULTI' ? 'rounded-sm' : 'rounded-full',
                        option.isCorrect
                          ? 'border-success bg-success text-success-foreground'
                          : 'border-input bg-card group-hover/mark:border-success',
                      )}
                    >
                      {option.isCorrect ? (
                        <Check className="size-3" strokeWidth={3} aria-hidden />
                      ) : null}
                    </span>
                  </button>

                  <Input
                    value={option.text}
                    readOnly={fixedOptionSet}
                    onChange={(event) =>
                      onChange({
                        options: question.options.map((current) =>
                          current.key === option.key
                            ? { ...current, text: event.target.value }
                            : current,
                        ),
                      })
                    }
                    placeholder={`Option ${optionIndex + 1}`}
                    aria-label={`Option ${optionIndex + 1}`}
                    className={cn('min-w-0 flex-1', fixedOptionSet && 'bg-muted/60')}
                  />

                  {option.isCorrect ? (
                    <span className="hidden shrink-0 items-center gap-1 px-2 text-xs font-medium text-success sm:inline-flex">
                      <Check className="size-3.5" aria-hidden />
                      Correct
                    </span>
                  ) : null}

                  {!fixedOptionSet && question.options.length > 2 ? (
                    <IconAction
                      label={`Remove option ${optionIndex + 1}`}
                      destructive
                      onClick={() =>
                        onChange({
                          options: question.options.filter((current) => current.key !== option.key),
                        })
                      }
                    >
                      <Trash2 />
                    </IconAction>
                  ) : null}
                </div>
              ))}

              {!fixedOptionSet && question.options.length < 6 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-10 text-primary"
                  onClick={() => onChange({ options: [...question.options, blankOption()] })}
                >
                  <Plus aria-hidden />
                  Add option
                </Button>
              ) : null}

              <p className="ml-10 pt-1 text-xs text-muted-foreground">
                {question.type === 'MCQ_MULTI'
                  ? 'Tick every correct option. Partial credit applies unless a wrong option is chosen.'
                  : fixedOptionSet
                    ? 'Tick the correct option. The wording and order are standard, so they are not editable.'
                    : 'Tick the one correct option.'}
              </p>
            </div>
          ) : null}

          {question.type === 'SHORT_ANSWER' ? (
            <div className="space-y-2">
              <Label htmlFor={`accepted-${question.key}`}>Accepted answers — one per line</Label>
              <Textarea
                id={`accepted-${question.key}`}
                value={question.acceptedAnswers}
                onChange={(event) => onChange({ acceptedAnswers: event.target.value })}
                placeholder={'photosynthesis\nphoto synthesis'}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Marked automatically. Case and surrounding spaces are ignored.
              </p>
            </div>
          ) : null}

          {MANUAL_TYPES.has(question.type) ? (
            <div className="space-y-4">
              {question.type === 'IMAGE_ANSWER' ? (
                <div className="w-40 space-y-2">
                  <Label htmlFor={`attachments-${question.key}`}>Photographs allowed</Label>
                  <Input
                    id={`attachments-${question.key}`}
                    type="number"
                    min={1}
                    max={10}
                    value={question.maxAttachments}
                    onChange={(event) =>
                      onChange({
                        maxAttachments: Math.max(
                          1,
                          Math.min(10, Number(event.target.value) || 1),
                        ),
                      })
                    }
                    className="tabular"
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor={`model-${question.key}`}>Model answer (optional)</Label>
                <Textarea
                  id={`model-${question.key}`}
                  value={question.modelAnswer}
                  onChange={(event) => onChange({ modelAnswer: event.target.value })}
                  placeholder="What a full-marks answer covers."
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  {question.type === 'IMAGE_ANSWER'
                    ? 'Students photograph their working. Marked by hand from your marking queue — only you see this.'
                    : 'Marked by hand from your marking queue. Only you see this.'}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-destructive">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** A 40px icon button for the per-question and per-option toolbars. */
function IconAction({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'shrink-0 text-muted-foreground',
        destructive && 'hover:bg-danger-subtle hover:text-destructive',
      )}
    >
      {children}
    </Button>
  );
}

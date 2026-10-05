'use client';

import { AlertTriangle, Check, ImagePlus, Loader2, Paperclip, X } from 'lucide-react';
import * as React from 'react';
import { Checkbox as AriaCheckbox, Radio as AriaRadio } from 'react-aria-components';

import { MathText } from '@/components/shared/math-text';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

export interface ExamOption {
  id: string;
  text: string;
  imageUrl: string | null;
}

export interface ExamAttachment {
  id: string;
  url: string;
  name: string;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/*
 * Each option card *is* the React Aria radio / checkbox: one <label> around a
 * visually hidden native input, so the whole card is the hit area and there is
 * no label nested in a label. Focus sits on that hidden input, so the global
 * focus outline is drawn on the card instead. Deliberately no transitions — a
 * new question's options must not fade in from the previous question's state.
 */
function optionCardClass({
  isSelected,
  isHovered,
  isFocusVisible,
}: {
  isSelected: boolean;
  isHovered: boolean;
  isFocusVisible: boolean;
}) {
  return cn(
    'flex min-h-12 cursor-pointer items-start gap-3 rounded-md border px-4 py-3 text-foreground',
    isSelected
      ? 'border-primary bg-accent shadow-[inset_0_0_0_1px_hsl(var(--primary))]'
      : isHovered
        ? 'border-input bg-muted/50'
        : 'border-border bg-card',
    isFocusVisible && 'outline outline-2 outline-offset-2 outline-ring',
  );
}

/** Everything inside a card is phrasing content, because the card is a <label>. */
function OptionBody({
  kind,
  selected,
  letter,
  option,
}: {
  kind: 'radio' | 'checkbox';
  selected: boolean;
  letter: string;
  option: ExamOption;
}) {
  return (
    <>
      {/* The mark carries the selected state without relying on colour. */}
      <span className="flex h-[1.625rem] shrink-0 items-center" aria-hidden>
        {kind === 'radio' ? (
          <span
            className={cn(
              'flex size-5 items-center justify-center rounded-full border-2 bg-card',
              selected ? 'border-primary' : 'border-input',
            )}
          >
            {selected ? (
              <span className="size-2.5 rounded-full bg-primary forced-colors:bg-[CanvasText]" />
            ) : null}
          </span>
        ) : (
          <span
            className={cn(
              'flex size-5 items-center justify-center rounded border-2',
              selected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-card',
            )}
          >
            {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
          </span>
        )}
      </span>
      <span
        className={cn(
          'tabular flex h-[1.625rem] w-4 shrink-0 items-center text-sm font-semibold',
          selected ? 'text-primary' : 'text-muted-foreground',
        )}
        aria-hidden
      >
        {letter}
      </span>
      <span className="min-w-0 flex-1 space-y-2.5">
        {option.text ? (
          <MathText text={option.text} className="block text-base leading-[1.625rem]" />
        ) : null}
        {option.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- authorised route, not a static asset: Next's optimiser cannot fetch it
          <img
            src={option.imageUrl}
            // The letter is aria-hidden, so an image-only option needs its own
            // name; when text is present it already names the option.
            alt={option.text ? '' : `Option ${letter} diagram`}
            // White backing keeps transparent diagrams legible in dark mode.
            className="block h-auto max-h-56 w-auto max-w-full rounded border border-border bg-white object-contain"
          />
        ) : null}
      </span>
    </>
  );
}

/** One correct answer — MCQ_SINGLE, TRUE_FALSE and ASSERTION_REASON. */
export function SingleChoiceInput({
  options,
  selectedOptionId,
  onSelect,
  questionNumber,
}: {
  options: ExamOption[];
  selectedOptionId: string | null;
  onSelect: (optionId: string) => void;
  questionNumber: number;
}) {
  return (
    <RadioGroup
      value={selectedOptionId ?? ''}
      onValueChange={onSelect}
      className="gap-2.5"
      aria-label={`Answer options for question ${questionNumber}`}
    >
      {options.map((option, index) => (
        <AriaRadio key={option.id} value={option.id} className={optionCardClass}>
          <OptionBody
            kind="radio"
            selected={selectedOptionId === option.id}
            letter={OPTION_LETTERS[index] ?? String(index + 1)}
            option={option}
          />
        </AriaRadio>
      ))}
    </RadioGroup>
  );
}

/** Several correct answers — MCQ_MULTI. */
export function MultipleChoiceInput({
  options,
  selectedOptionIds,
  onChange,
  questionNumber,
}: {
  options: ExamOption[];
  selectedOptionIds: string[];
  onChange: (next: string[]) => void;
  questionNumber: number;
}) {
  const selected = new Set(selectedOptionIds);

  const toggle = (optionId: string) => {
    const next = new Set(selected);
    if (next.has(optionId)) next.delete(optionId);
    else next.add(optionId);
    // Preserve the displayed order so the payload is stable between saves.
    onChange(options.filter((option) => next.has(option.id)).map((option) => option.id));
  };

  return (
    <div
      role="group"
      aria-label={`Answer options for question ${questionNumber} — select all that apply`}
      className="flex flex-col gap-2.5"
    >
      {options.map((option, index) => (
        <AriaCheckbox
          key={option.id}
          isSelected={selected.has(option.id)}
          onChange={() => toggle(option.id)}
          className={optionCardClass}
        >
          <OptionBody
            kind="checkbox"
            selected={selected.has(option.id)}
            letter={OPTION_LETTERS[index] ?? String(index + 1)}
            option={option}
          />
        </AriaCheckbox>
      ))}
    </div>
  );
}

/**
 * The assertion–reason stem. Presented as two labelled statements above the
 * standard option set, which is how these appear on paper.
 */
export function AssertionReasonStem({
  assertion,
  reason,
}: {
  assertion: string;
  reason: string;
}) {
  return (
    <div className="mt-6 space-y-3">
      {[
        { label: 'Assertion (A)', value: assertion },
        { label: 'Reason (R)', value: reason },
      ].map((item) => (
        <div key={item.label} className="rounded-md border border-border bg-muted px-4 py-3.5">
          <p className="type-eyebrow">{item.label}</p>
          <MathText
            text={item.value}
            className="mt-1 block text-lg leading-[1.75] text-foreground"
          />
        </div>
      ))}
    </div>
  );
}

/** A word or phrase — SHORT_ANSWER. */
export function ShortAnswerInput({
  value,
  onChange,
  questionNumber,
  maxLength = 500,
}: {
  value: string;
  onChange: (next: string) => void;
  questionNumber: number;
  maxLength?: number;
}) {
  return (
    <div className="space-y-2">
      <Input
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Type your answer"
        aria-label={`Your answer for question ${questionNumber}`}
        className="h-12 px-4 text-base"
        autoComplete="off"
        spellCheck={false}
      />
      <p className="text-sm text-muted-foreground">
        Spelling and spacing are normalised when marking, so capitalisation does not matter unless
        your faculty specified otherwise.
      </p>
    </div>
  );
}

/** Descriptive prose — LONG_ANSWER. Marked by a person, not by the server. */
export function LongAnswerInput({
  value,
  onChange,
  questionNumber,
  maxWords,
  maxLength = 20_000,
}: {
  value: string;
  onChange: (next: string) => void;
  questionNumber: number;
  maxWords: number | null;
  maxLength?: number;
}) {
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const overLimit = maxWords !== null && words > maxWords;

  return (
    <div className="space-y-2">
      <Textarea
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        rows={12}
        placeholder="Write your answer"
        aria-label={`Your answer for question ${questionNumber}`}
        className="resize-y px-4 py-3 text-base leading-[1.75]"
        spellCheck={false}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className={cn('tabular', overLimit ? 'font-medium text-warning' : 'text-muted-foreground')}>
          {words} {words === 1 ? 'word' : 'words'}
          {maxWords !== null ? ` · suggested limit ${maxWords}` : ''}
        </span>
        <span className="text-muted-foreground">Marked by your faculty after the exam.</span>
      </div>
      {overLimit ? (
        <p className="flex items-start gap-2 rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-[3px] size-4 shrink-0" aria-hidden />
          You are past the suggested length. Your answer is still saved in full.
        </p>
      ) : null}
    </div>
  );
}

/** Photographs of written work — IMAGE_ANSWER. */
export function ImageAnswerInput({
  attachments,
  maxAttachments,
  uploading,
  onUpload,
  onRemove,
  onPickerOpen,
}: {
  attachments: ExamAttachment[];
  maxAttachments: number;
  uploading: boolean;
  onUpload: (file: File) => void;
  onRemove: (attachmentId: string) => void;
  onPickerOpen: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // Only put the student back in fullscreen if they were in it before the dialog.
  const wasFullscreen = React.useRef(false);
  const atLimit = attachments.length >= maxAttachments;

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        // Only reachable through the button below, which tells the security
        // monitor about the picker first; tabbing straight to this input would
        // open it unannounced and the blur would be scored.
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset first so choosing the same file twice still fires a change.
          event.target.value = '';
          if (file) onUpload(file);
          // Choosing a file is a user gesture, so fullscreen can be re-entered
          // now without a second click. If the browser refuses, the gate asks.
          if (wasFullscreen.current && !document.fullscreenElement) {
            void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
          }
        }}
      />

      {attachments.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {attachments.map((attachment, index) => (
            <li
              key={attachment.id}
              className="overflow-hidden rounded-md border border-border bg-card"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- served
                  from an authorised route, not a static asset. */}
              <img
                src={attachment.url}
                alt={`Your uploaded answer, page ${index + 1}`}
                className="block h-auto max-h-64 w-full bg-white object-contain"
              />
              <div className="flex items-center gap-2 border-t border-border py-1 pl-3 pr-1">
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Page {index + 1}</span>
                  {' · '}
                  {attachment.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-11 shrink-0"
                  aria-label={`Remove page ${index + 1}`}
                  onClick={() => onRemove(attachment.id)}
                >
                  <X />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="rounded-md border border-dashed border-input bg-background px-6 py-8 text-center">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={atLimit || uploading}
          onClick={() => {
            // Tell the security monitor a native dialog is about to take focus,
            // so the blur it causes is not read as leaving the exam.
            wasFullscreen.current = Boolean(document.fullscreenElement);
            onPickerOpen();
            inputRef.current?.click();
          }}
        >
          {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <ImagePlus aria-hidden />}
          {uploading ? 'Uploading…' : 'Add a photo of your work'}
        </Button>
        <p className="tabular mt-3 text-sm text-muted-foreground">
          {atLimit
            ? `You have attached the maximum of ${maxAttachments} image${maxAttachments === 1 ? '' : 's'}.`
            : `PNG, JPEG or WebP, up to 5 MB each. ${attachments.length} of ${maxAttachments} attached.`}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Location data is removed from your photo before it is stored.
        </p>
      </div>
    </div>
  );
}

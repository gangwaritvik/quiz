'use client';

import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import {
  ADD_TIME_PRESETS,
  CUSTOM_CHOICE,
  type MinutesCheck,
  type PickerState,
  formatClock,
  initialPicker,
  maxAddable,
  newEndTime,
  resolvePicker,
} from '@/lib/extension-ui';
import { cn, pluralize } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Minutes picker — shared with the pre-start "Extra time" panel.      */
/* ------------------------------------------------------------------ */

const CHIP_CLASSES = cn(
  'tabular inline-flex h-11 min-w-[4.25rem] cursor-pointer select-none items-center justify-center rounded-md border border-border bg-card px-3.5 text-sm font-medium text-foreground',
  'transition-colors duration-fast ease-standard hover:bg-accent',
  // Selected: tinted fill and a 2px Oxford edge, so it is not colour alone.
  'peer-checked:border-primary peer-checked:bg-accent peer-checked:text-accent-foreground peer-checked:shadow-[inset_0_0_0_1px_hsl(var(--primary))]',
  'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
  'peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-disabled:hover:bg-card',
);

/**
 * Preset minutes as radio chips (native radios: arrow keys move and select),
 * plus a Custom chip with its own number field. `check` is the result of
 * `resolvePicker` for the same state, so the parent and the field agree.
 */
export function MinutesPicker({
  idPrefix,
  legend,
  presets,
  state,
  onChange,
  min,
  max,
  check,
  disabled,
}: {
  idPrefix: string;
  legend: string;
  presets: readonly number[];
  state: PickerState;
  onChange: (next: PickerState) => void;
  min: number;
  max: number;
  check: MinutesCheck;
  disabled?: boolean;
}) {
  const [touched, setTouched] = React.useState(false);
  const customSelected = state.choice === CUSTOM_CHOICE;
  const showError = customSelected && !check.ok && (touched || state.custom !== '');
  const helpId = `${idPrefix}-custom-help`;
  const inputId = `${idPrefix}-custom`;

  const chip = (value: string, label: string, chipDisabled: boolean) => (
    <div key={value} className="relative">
      <input
        type="radio"
        id={`${idPrefix}-${value}`}
        name={`${idPrefix}-minutes`}
        value={value}
        checked={state.choice === value}
        disabled={disabled || chipDisabled}
        onChange={() => onChange({ ...state, choice: value })}
        className="peer sr-only"
      />
      <label htmlFor={`${idPrefix}-${value}`} className={CHIP_CLASSES}>
        {label}
      </label>
    </div>
  );

  return (
    <fieldset className="min-w-0 space-y-3" disabled={disabled}>
      <legend className="mb-2.5 text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) =>
          chip(String(preset), preset === 0 ? 'None' : `${preset} min`, preset > max),
        )}
        {chip(CUSTOM_CHOICE, 'Custom', max < min)}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={inputId}>Custom minutes</Label>
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={state.custom}
          placeholder={`${min}–${max}`}
          disabled={max < min}
          invalid={showError}
          aria-describedby={helpId}
          onChange={(event) => onChange({ choice: CUSTOM_CHOICE, custom: event.target.value })}
          onClick={() => {
            if (!customSelected) onChange({ ...state, choice: CUSTOM_CHOICE });
          }}
          onBlur={() => setTouched(true)}
          className="tabular w-32"
        />
        <p
          id={helpId}
          aria-live="polite"
          className={cn('text-xs', showError ? 'text-danger' : 'text-muted-foreground')}
        >
          {showError && !check.ok ? check.message : `Whole minutes, ${min} to ${max}.`}
        </p>
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */
/* Add time to an attempt that is in progress.                         */
/* ------------------------------------------------------------------ */

/** What the dialog needs from a live row. */
export interface AddTimeTarget {
  attemptId: string;
  name: string;
  /** ISO end time of the attempt right now. */
  expiresAt: string;
  /** Extra minutes the attempt already has. */
  extraMinutes: number;
}

interface ExtendResult {
  expiresAt: string;
  extraMinutes: number;
  remainingMs: number;
}

export function AddTimeDialog({
  target,
  onOpenChange,
  onChanged,
}: {
  /** The student to add time for; null keeps the dialog closed. */
  target: AddTimeTarget | null;
  onOpenChange: (open: boolean) => void;
  /** Called after the server accepted the change, or said the row is stale. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);

  // Keep the last student on screen while the dialog fades out.
  const last = React.useRef(target);
  if (target) last.current = target;
  const shown = target ?? last.current;

  return (
    // No onOpenChange while the request is in flight, so Escape and outside
    // clicks cannot dismiss it half way.
    <Dialog open={target !== null} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent hideClose={busy} className="max-h-[90dvh] overflow-y-auto">
        {shown ? (
          <AddTimeForm
            // A different student starts from a fresh selection.
            key={shown.attemptId}
            target={shown}
            busy={busy}
            setBusy={setBusy}
            onClose={() => onOpenChange(false)}
            onChanged={onChanged}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AddTimeForm({
  target,
  busy,
  setBusy,
  onClose,
  onChanged,
}: {
  target: AddTimeTarget;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const ceiling = maxAddable(target.extraMinutes);
  const [picker, setPicker] = React.useState(() => initialPicker(ADD_TIME_PRESETS, 15, ceiling));

  const check = resolvePicker(picker, 1, ceiling);
  const minutes = check.ok ? check.minutes : null;
  const newEnd = minutes === null ? null : newEndTime(target.expiresAt, minutes);

  const submit = async () => {
    if (minutes === null) return;
    setBusy(true);
    try {
      const result = await apiFetch<ExtendResult>(
        `/api/admin/attempts/${target.attemptId}/extend`,
        { method: 'POST', body: { minutes } },
      );
      toast.success(
        `${target.name} now has ${pluralize(minutes, 'more minute')} (ends at ${formatClock(result.expiresAt)}).`,
      );
      onChanged();
      onClose();
    } catch (caught) {
      if (!(caught instanceof ApiClientError)) {
        toast.error(`We could not add time for ${target.name}.`);
        return;
      }
      toast.error(caught.message);
      // 422 (total limit) and network errors are fixable here, so the dialog
      // stays open. 409 (already ended) and 403 (not yours) are not: the row
      // is stale, so refresh and close.
      if (caught.status === 409 || caught.status === 403) {
        onChanged();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle className="break-words">Add time for {target.name}</DialogTitle>
        <DialogDescription>
          Adds minutes to this student&apos;s timer for this attempt only. Their answers are kept.
          They are told on screen.
        </DialogDescription>
      </DialogHeader>

      <MinutesPicker
        idPrefix="add-time"
        legend="Minutes to add"
        presets={ADD_TIME_PRESETS}
        state={picker}
        onChange={setPicker}
        min={1}
        max={ceiling}
        check={check}
        disabled={busy}
      />

      <div className="space-y-2">
        <p
          aria-live="polite"
          className="tabular rounded-md border border-border bg-muted/60 px-3.5 py-3 text-sm"
        >
          <span className="text-muted-foreground">Ends </span>
          <span className="font-medium">{formatClock(target.expiresAt)}</span>
          <span aria-hidden> → </span>
          <span className="sr-only"> and will become </span>
          <span className="font-semibold">{formatClock(newEnd)}</span>
        </p>
        {target.extraMinutes > 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {ceiling > 0
              ? `Already has ${pluralize(target.extraMinutes, 'extra minute')}. Up to ${ceiling} more can be added (180 in total per attempt).`
              : `Already has ${pluralize(target.extraMinutes, 'extra minute')}, the most one attempt can have (180).`}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={minutes === null}>
          {minutes === null ? 'Add time' : `Add ${pluralize(minutes, 'minute')}`}
        </Button>
      </DialogFooter>
    </form>
  );
}

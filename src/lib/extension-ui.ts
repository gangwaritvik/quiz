import { formatDateTime } from '@/lib/utils';

/*
 * Pure helpers behind the faculty "Add time" dialog (Live exams) and the
 * "Extra time" tab (quiz detail). No React, no fetching, so they can be unit
 * tested. The limits mirror the server's; the server stays the authority and
 * these only stop a faculty member from sending a request that will be refused.
 */

/** Most minutes one request may add (live) or set (before the quiz starts). */
export const MAX_EXTENSION_MINUTES = 120;
/** Most extra minutes one attempt may accumulate across all requests. */
export const MAX_TOTAL_EXTRA_MINUTES = 180;

export const ADD_TIME_PRESETS = [5, 10, 15, 30, 60] as const;
/** Before the quiz starts, 0 means "remove the extension". */
export const PRESTART_PRESETS = [0, 5, 10, 15, 30, 60] as const;

/** The radio value of the "Custom" choice; presets use their minutes as a string. */
export const CUSTOM_CHOICE = 'custom';

export type MinutesCheck = { ok: true; minutes: number } | { ok: false; message: string };

/** Which preset (or Custom) is selected, plus the text typed into the custom field. */
export interface PickerState {
  choice: string;
  custom: string;
}

/** Whole minutes only, within [min, max]. */
export function checkMinutes(raw: string, min: number, max: number): MinutesCheck {
  if (max < min) return { ok: false, message: 'No more time can be added.' };
  const text = raw.trim();
  const range = { ok: false, message: `Enter ${min} to ${max} minutes.` } as const;
  if (text === '') return range;
  if (!/^-?\d+$/.test(text)) return { ok: false, message: 'Enter a whole number of minutes.' };
  const value = Number(text);
  return value < min || value > max ? range : { ok: true, minutes: value };
}

/** How many more minutes one attempt can take, given what it already has. */
export function maxAddable(currentExtra: number): number {
  const used = Math.max(0, currentExtra);
  return Math.max(0, Math.min(MAX_EXTENSION_MINUTES, MAX_TOTAL_EXTRA_MINUTES - used));
}

/** Whole minutes pulled into [min, max]; anything unusable becomes `min`. */
export function clampMinutes(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * The end time after adding `minutes` to `expiresAt`, or null when `expiresAt`
 * is unreadable. Minutes are clamped, so the preview can never show a time the
 * server would refuse.
 */
export function newEndTime(
  expiresAt: string | Date,
  minutes: number,
  max: number = MAX_EXTENSION_MINUTES,
): Date | null {
  const base = new Date(expiresAt).getTime();
  if (Number.isNaN(base)) return null;
  return new Date(base + clampMinutes(minutes, 0, max) * 60_000);
}

/** "11:40 am" in the browser's zone, or an em dash for an unreadable date. */
export function formatClock(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return formatDateTime(date, { day: undefined, month: undefined, year: undefined });
}

/**
 * Starting selection: `preferred` when it is allowed, else the largest allowed
 * preset, else Custom with nothing typed.
 */
export function initialPicker(
  presets: readonly number[],
  preferred: number,
  max: number,
): PickerState {
  if (preferred <= max && presets.includes(preferred)) {
    return { choice: String(preferred), custom: '' };
  }
  const fallback = presets.filter((preset) => preset > 0 && preset <= max).pop();
  return { choice: fallback === undefined ? CUSTOM_CHOICE : String(fallback), custom: '' };
}

/** Starting selection for an existing value: its preset, or Custom holding it. */
export function pickerFor(presets: readonly number[], minutes: number): PickerState {
  return presets.includes(minutes)
    ? { choice: String(minutes), custom: '' }
    : { choice: CUSTOM_CHOICE, custom: String(minutes) };
}

/** The minutes the picker currently stands for, or why it is not usable. */
export function resolvePicker(state: PickerState, min: number, max: number): MinutesCheck {
  if (state.choice === CUSTOM_CHOICE) return checkMinutes(state.custom, min, max);
  const minutes = Number(state.choice);
  return minutes > max ? { ok: false, message: `Enter ${min} to ${max} minutes.` } : { ok: true, minutes };
}

/** "+15 min" for the live row badge. */
export function extraBadge(minutes: number): string {
  return `+${minutes} min`;
}

/** Case-insensitive match on name, roll number or section. */
export function matchesStudentQuery(
  student: { name: string; rollNumber: string; section: string },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [student.name, student.rollNumber, student.section].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

/**
 * Active-filter chips for list screens.
 *
 * Pure and framework-free so the rule "what counts as an active filter, and
 * what does its chip say" is testable without rendering anything.
 */

export interface FilterField {
  /** Stable key the caller uses to know which filter a removed chip was. */
  key: string;
  /** Short field name shown before the colon, e.g. "Subject". */
  label: string;
  /** Raw filter value. Empty, or equal to `unset`, means the filter is off. */
  value: string;
  /** Human text for the value; falls back to the raw value. */
  display?: string;
}

export interface FilterChip {
  key: string;
  /** "Subject: Database Systems" */
  text: string;
}

/** `unset` is the sentinel a select uses for "no filter" (the question bank uses 'ALL'). */
export function buildFilterChips(fields: FilterField[], unset = 'ALL'): FilterChip[] {
  return fields
    .filter((field) => field.value !== '' && field.value !== unset)
    .map((field) => ({ key: field.key, text: `${field.label}: ${field.display || field.value}` }));
}

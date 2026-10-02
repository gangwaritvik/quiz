/**
 * Minimal RFC-4180 CSV reader.
 *
 * Handles quoted fields, escaped quotes and embedded newlines — enough for the
 * spreadsheets a department actually exports, without pulling in a dependency.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const text = input.replace(/^﻿/, ''); // strip Excel's BOM

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field.trim());
      field = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);

  return rows;
}

/** Drops a leading header row when its first cell matches one of `headers`. */
export function stripHeader(rows: string[][], headers: string[]): string[][] {
  const first = rows[0]?.[0]?.toLowerCase().trim();
  if (first && headers.some((header) => first === header.toLowerCase())) return rows.slice(1);
  return rows;
}

export interface ImportIssue {
  row: number;
  message: string;
}

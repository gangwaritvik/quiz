/**
 * Splits authored text into plain and mathematical segments.
 *
 * Questions are written as ordinary prose with LaTeX between delimiters —
 * `$…$` inline, `$$…$$` display — which is the convention faculty already know
 * from LaTeX and most question banks export.
 *
 * This module is deliberately pure and free of any renderer import: the split
 * happens here, the typesetting happens in `MathText`. Keeping them apart means
 * the rule that decides *what counts as math* can be reasoned about (and
 * tested) without pulling in KaTeX.
 */

export interface MathSegment {
  kind: 'text' | 'math';
  value: string;
  /** Display (centred, own line) rather than inline. Math segments only. */
  display: boolean;
}

/** Guards against pathological input producing thousands of render calls. */
const MAX_MATH_SEGMENTS = 200;

/**
 * Finds the closing delimiter, skipping anything backslash-escaped so that
 * `\$` inside an expression does not terminate it early.
 */
function findClosing(input: string, from: number, delimiter: string): number {
  let index = from;
  while (index < input.length) {
    if (input[index] === '\\') {
      index += 2; // skip the escape and whatever it escapes
      continue;
    }
    if (input.startsWith(delimiter, index)) return index;
    index += 1;
  }
  return -1;
}

export function parseMathSegments(input: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let buffer = '';
  let index = 0;
  let mathCount = 0;

  const flushText = () => {
    if (buffer.length > 0) {
      segments.push({ kind: 'text', value: buffer, display: false });
      buffer = '';
    }
  };

  while (index < input.length) {
    const char = input[index];

    // An escaped dollar is a literal dollar, not a delimiter — so prices and
    // currency in a question body survive untouched.
    if (char === '\\' && input[index + 1] === '$') {
      buffer += '$';
      index += 2;
      continue;
    }

    if (char === '$') {
      const display = input[index + 1] === '$';
      const delimiter = display ? '$$' : '$';
      const start = index + delimiter.length;
      const end = findClosing(input, start, delimiter);

      // An unmatched delimiter means the author wrote a stray dollar sign.
      // Treating the remainder as prose is friendlier than swallowing it.
      if (end === -1) {
        buffer += input.slice(index);
        break;
      }

      const tex = input.slice(start, end).trim();
      if (tex.length > 0 && mathCount < MAX_MATH_SEGMENTS) {
        flushText();
        segments.push({ kind: 'math', value: tex, display });
        mathCount += 1;
      } else {
        // Empty (`$$`) or past the cap — keep it as literal text.
        buffer += input.slice(index, end + delimiter.length);
      }

      index = end + delimiter.length;
      continue;
    }

    buffer += char;
    index += 1;
  }

  flushText();
  return segments;
}

/** True when the text contains at least one renderable expression. */
export function hasMath(input: string): boolean {
  return parseMathSegments(input).some((segment) => segment.kind === 'math');
}

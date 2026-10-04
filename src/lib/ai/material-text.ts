/*
 * Study material text handling that needs no PDF library: deciding which
 * pages need OCR, grouping them for the model, and stitching the text the AI
 * will search into one page-marked document.
 */

/** A page with fewer readable characters than this has no real text layer. */
export const SCANNED_PAGE_THRESHOLD = 30;
/** Most scanned pages read per file; the rest are left out and reported. */
export const MAX_OCR_PAGES = 150;
/** Scanned pages sent to the model per OCR call. */
export const OCR_BATCH_PAGES = 8;

export function isScannedPage(text: string): boolean {
  return text.replace(/\s+/g, '').length < SCANNED_PAGE_THRESHOLD;
}

/** 1-based numbers of the pages that need OCR, capped at `limit`. */
export function scannedPageNumbers(pageTexts: string[], limit = MAX_OCR_PAGES): number[] {
  const pages: number[] = [];
  pageTexts.forEach((text, index) => {
    if (isScannedPage(text)) pages.push(index + 1);
  });
  return pages.slice(0, limit);
}

export function batchPages(pages: number[], size = OCR_BATCH_PAGES): number[][] {
  const batches: number[][] = [];
  for (let i = 0; i < pages.length; i += size) batches.push(pages.slice(i, i + size));
  return batches;
}

/**
 * Splits an OCR answer for several pages back into pages. The model is asked
 * to start each page with `--- Page N ---`; text before the first marker goes
 * to the first page asked for.
 */
export function splitTranscript(transcript: string, pages: number[]): Map<number, string> {
  const result = new Map<number, string>();
  const parts = transcript.split(/^-{3}\s*Page\s+(\d+)\s*-{3}\s*$/im);
  // parts: [before, n1, text1, n2, text2, ...]
  const before = parts[0]!.trim();
  if (before && pages[0] !== undefined) result.set(pages[0], before);
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const page = Number(parts[i]);
    if (pages.includes(page)) {
      result.set(page, [result.get(page), parts[i + 1]!.trim()].filter(Boolean).join('\n\n'));
    }
  }
  return result;
}

/**
 * One Markdown document with a `--- Page N ---` line before every page, using
 * the OCR text where a page had none of its own. This is what gets indexed,
 * so citations and page focus line up with the original pages.
 */
export function buildCompanion(pageTexts: string[], ocr: Map<number, string>): string {
  return pageTexts
    .map((text, index) => {
      const page = index + 1;
      const body = (ocr.get(page) ?? text).trim();
      return `--- Page ${page} ---\n${body || '[no readable text on this page]'}`;
    })
    .join('\n\n');
}

export interface SliceMaterial {
  title: string;
  /** One entry per page, in order. */
  pages: string[];
}

/** Most text sent to the model for one batch. */
export const MAX_SLICE_CHARS = 100_000;

/**
 * The text for batch `index` of `count`: the pages of all chosen materials,
 * cut into `count` consecutive windows, so a job asking for many questions
 * covers the whole material instead of whatever a search ranks first. Pages
 * carry a `--- title · page N ---` line. Empty when no page has readable text.
 */
export function sliceForBatch(
  materials: SliceMaterial[],
  index: number,
  count: number,
  maxChars = MAX_SLICE_CHARS,
): string {
  const pages = materials
    .flatMap((material) =>
      material.pages.map((text, i) => ({ title: material.title, page: i + 1, text: text.trim() })),
    )
    .filter((page) => page.text && page.text !== '[no readable text on this page]');
  if (pages.length === 0) return '';

  const from = Math.floor((index * pages.length) / count);
  const to = Math.max(from + 1, Math.floor(((index + 1) * pages.length) / count));
  const window = pages.slice(from, to);
  const each = Math.floor(maxChars / window.length);
  return window
    .map((page) => `--- ${page.title} · page ${page.page} ---\n${page.text.slice(0, each)}`)
    .join('\n\n');
}

/**
 * For a model that cannot search a store: the pages that mention the topic,
 * best first, cut to the budget and shown in page order. Empty when nothing
 * matches. Words of three letters or more are matched; a page that contains
 * the whole phrase counts for more.
 */
export function pagesForQuery(materials: SliceMaterial[], query: string, maxChars = MAX_SLICE_CHARS): string {
  const phrase = query.trim().toLowerCase();
  const terms = [...new Set(phrase.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3))];
  if (terms.length === 0) return '';

  const scored = materials
    .flatMap((material, m) =>
      material.pages.map((text, i) => {
        const lower = text.toLowerCase();
        let score = phrase.length >= 3 && lower.includes(phrase) ? 5 : 0;
        for (const term of terms) score += lower.split(term).length - 1;
        return { m, i, title: material.title, text: text.trim(), score };
      }),
    )
    .filter((page) => page.score > 0 && page.text);
  if (scored.length === 0) return '';

  const best = scored.sort((a, b) => b.score - a.score).slice(0, 8);
  const each = Math.floor(maxChars / best.length);
  return best
    .sort((a, b) => a.m - b.m || a.i - b.i)
    .map((page) => `--- ${page.title} · page ${page.i + 1} ---\n${page.text.slice(0, each)}`)
    .join('\n\n');
}

/** For a model that cannot read a PDF: pages `from` to `to` of one material, as text. */
export function pagesInRange(material: SliceMaterial, from: number, to: number, maxChars = MAX_SLICE_CHARS): string {
  const window = material.pages
    .map((text, i) => ({ page: i + 1, text: text.trim() }))
    .filter((page) => page.page >= from && page.page <= to && page.text);
  if (window.length === 0) return '';
  const each = Math.floor(maxChars / window.length);
  return window.map((page) => `--- ${material.title} · page ${page.page} ---\n${page.text.slice(0, each)}`).join('\n\n');
}

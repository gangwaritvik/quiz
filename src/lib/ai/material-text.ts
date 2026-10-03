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

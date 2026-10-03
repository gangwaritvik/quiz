import 'server-only';

import { PDFDocument } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

/** Page count, or null when the file is not a PDF we can open (e.g. encrypted). */
export async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

/** The text layer of every page, in order. A scanned page comes back (nearly) empty. */
export async function readPageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return Array.isArray(text) ? text : [text];
}

/** A new PDF holding only the given 1-based pages, in that order. */
export async function extractPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const total = source.getPageCount();
  const indices = pages.filter((page) => page >= 1 && page <= total).map((page) => page - 1);
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(source, indices)) out.addPage(page);
  return out.save();
}

export const pageRange = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

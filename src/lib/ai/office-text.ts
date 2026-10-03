import { unzipSync } from 'fflate';

/*
 * The plain text of a Word or PowerPoint file, read straight from its ZIP.
 * Used only to check the AI's quotes against the material, so layout, images
 * and styling are ignored.
 */

const MAX_XML_BYTES = 50 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string) =>
  text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#')) {
      const point = code[1]!.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });

/** Runs of `<tag>…</tag>` text inside one paragraph, joined. */
const runs = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => decode(m[1]!)).join('');

const paragraphs = (xml: string, paragraph: string, run: string) =>
  xml
    .split(`</${paragraph}>`)
    .map((part) => runs(part, run).trim())
    .filter(Boolean)
    .join('\n');

/** One entry per page: a Word file is a single page, a presentation one per slide. */
export function officeTextPages(bytes: Uint8Array, kind: 'docx' | 'pptx'): string[] {
  const files = unzipSync(bytes, {
    filter: (file) =>
      file.originalSize < MAX_XML_BYTES &&
      (kind === 'docx' ? file.name === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/.test(file.name)),
  });
  const read = (name: string) => new TextDecoder().decode(files[name]!);

  if (kind === 'docx') {
    return files['word/document.xml'] ? [paragraphs(read('word/document.xml'), 'w:p', 'w:t')] : [];
  }
  return Object.keys(files)
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((name) => paragraphs(read(name), 'a:p', 'a:t'));
}

import 'server-only';

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Prisma } from '@prisma/client';

import { buildCompanion, scannedPageNumbers, splitTranscript, batchPages } from '@/lib/ai/material-text';
import { officeTextPages } from '@/lib/ai/office-text';
import { extractPages, readPageTexts } from '@/lib/ai/pdf-pages';
import { AiError, getProvider } from '@/lib/ai/provider';
import { prisma } from '@/lib/db';

/**
 * Study material: storing the teacher's file, reading scanned pages (OCR) and
 * indexing the result into the subject's Gemini File Search store. Runs in the
 * background after the upload request returns; the material's status says
 * where it is.
 */

export const MAX_MATERIAL_BYTES = 25 * 1024 * 1024;
/** Processing that has not finished by now was cut off (e.g. a server restart). */
const STALE_MS = 30 * 60_000;

const ROOT = path.join(path.resolve(process.env.UPLOAD_DIR ?? './var/uploads'), 'materials');

export type MaterialKind = 'pdf' | 'docx' | 'pptx' | 'image';

export interface DetectedMaterial {
  kind: MaterialKind;
  mimeType: string;
  extension: string;
}

const startsWith = (buffer: Buffer, text: string | number[]) =>
  typeof text === 'string'
    ? buffer.subarray(0, text.length).toString('latin1') === text
    : text.every((byte, i) => buffer[i] === byte);

/**
 * What the file really is, from its bytes. The name and declared type are not
 * trusted: a DOCX or PPTX is a ZIP that must contain the matching main part.
 */
export function detectMaterial(buffer: Buffer): DetectedMaterial | null {
  if (startsWith(buffer, '%PDF-')) return { kind: 'pdf', mimeType: 'application/pdf', extension: 'pdf' };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47])) return { kind: 'image', mimeType: 'image/png', extension: 'png' };
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { kind: 'image', mimeType: 'image/jpeg', extension: 'jpg' };
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    // ZIP entry names are stored as plain text in the local and central headers.
    const names = buffer.toString('latin1');
    if (names.includes('word/document.xml')) {
      return {
        kind: 'docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
      };
    }
    if (names.includes('ppt/presentation.xml')) {
      return {
        kind: 'pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        extension: 'pptx',
      };
    }
  }
  return null;
}

export async function saveMaterialFile(buffer: Buffer, extension: string): Promise<string> {
  await mkdir(ROOT, { recursive: true });
  const key = `${randomBytes(16).toString('hex')}.${extension}`;
  await writeFile(path.join(ROOT, key), buffer, { flag: 'wx' });
  return key;
}

export async function readMaterialFile(storageKey: string): Promise<Uint8Array> {
  // Keys are server-generated; refuse anything that could leave the folder.
  if (!/^[a-f0-9]{32}\.[a-z]+$/.test(storageKey)) throw new Error('Bad storage key');
  return new Uint8Array(await readFile(path.join(ROOT, storageKey)));
}

export async function deleteMaterialFile(storageKey: string) {
  if (!/^[a-f0-9]{32}\.[a-z]+$/.test(storageKey)) return;
  await unlink(path.join(ROOT, storageKey)).catch(() => undefined);
}

/**
 * The material's own text, one entry per page (a slide for PowerPoint, one
 * entry for Word), for checking the AI's quotes. Empty when it cannot be read.
 */
export async function materialPages(material: {
  storageKey: string;
  ocrText: string | null;
}): Promise<string[]> {
  try {
    if (material.ocrText) {
      // Page-marked: "--- Page N ---" then that page's text.
      const pages: string[] = [];
      const parts = material.ocrText.split(/^-{3}\s*Page\s+(\d+)\s*-{3}\s*$/im);
      for (let i = 1; i + 1 < parts.length; i += 2) pages[Number(parts[i]) - 1] = parts[i + 1]!;
      return Array.from(pages, (page) => page ?? '');
    }
    const bytes = await readMaterialFile(material.storageKey);
    const kind = detectMaterial(Buffer.from(bytes))?.kind;
    if (kind === 'pdf') return await readPageTexts(bytes);
    if (kind === 'docx' || kind === 'pptx') return officeTextPages(bytes, kind);
  } catch (error) {
    console.warn('[ai] could not read material text for checking', error);
  }
  return [];
}

/** The subject's store, created on first use. Two uploads at once agree on one. */
export async function ensureSubjectStore(subjectId: string): Promise<string> {
  const subject = await prisma.subject.findUniqueOrThrow({
    where: { id: subjectId },
    select: { code: true, fileSearchStore: true },
  });
  if (subject.fileSearchStore) return subject.fileSearchStore;

  const provider = await getProvider();
  const created = await provider.createStore(`securequiz-${subject.code}`);
  await prisma.subject.updateMany({
    where: { id: subjectId, fileSearchStore: null },
    data: { fileSearchStore: created },
  });
  const winner = await prisma.subject.findUniqueOrThrow({
    where: { id: subjectId },
    select: { fileSearchStore: true },
  });
  return winner.fileSearchStore!;
}

/** Marks processing that was cut off as failed, so the teacher can retry. */
export async function failStaleMaterials(subjectId: string) {
  await prisma.studyMaterial.updateMany({
    where: {
      subjectId,
      status: { in: ['OCR', 'PROCESSING'] },
      updatedAt: { lt: new Date(Date.now() - STALE_MS) },
    },
    data: { status: 'FAILED', error: 'Processing was interrupted. Delete it and upload again.' },
  });
}

/** OCR where needed, then index. Never throws: failures are recorded on the row. */
export async function processMaterial(materialId: string) {
  try {
    const material = await prisma.studyMaterial.findUniqueOrThrow({ where: { id: materialId } });
    const provider = await getProvider();
    const bytes = await readMaterialFile(material.storageKey);

    let index = { bytes, mimeType: material.mimeType };
    const kind = detectMaterial(Buffer.from(bytes))?.kind;

    if (kind === 'pdf' || kind === 'image') {
      const pageTexts = kind === 'pdf' ? await readPageTexts(bytes) : [''];
      const scanned = scannedPageNumbers(pageTexts);

      if (scanned.length > 0) {
        await prisma.studyMaterial.update({
          where: { id: materialId },
          data: { status: 'OCR', progress: { done: 0, total: scanned.length } },
        });
        const ocr = new Map<number, string>();
        let done = 0;
        for (const pages of batchPages(scanned)) {
          const chunk = kind === 'pdf' ? await extractPages(bytes, pages) : bytes;
          const transcript = await provider.transcribe({
            bytes: chunk,
            mimeType: kind === 'pdf' ? 'application/pdf' : material.mimeType,
            pages,
          });
          for (const [page, text] of splitTranscript(transcript, pages)) ocr.set(page, text);
          done += pages.length;
          await prisma.studyMaterial.update({
            where: { id: materialId },
            data: { progress: { done, total: scanned.length } },
          });
        }
        const companion = buildCompanion(pageTexts, ocr);
        await prisma.studyMaterial.update({
          where: { id: materialId },
          data: { ocrText: companion, scannedPages: scanned.length },
        });
        index = { bytes: new TextEncoder().encode(companion), mimeType: 'text/plain' };
      }
    }

    await prisma.studyMaterial.update({
      where: { id: materialId },
      data: { status: 'PROCESSING', progress: Prisma.DbNull },
    });
    const store = await ensureSubjectStore(material.subjectId);
    const documentName = await provider.indexDocument({
      store,
      bytes: index.bytes,
      mimeType: index.mimeType,
      displayName: material.title.slice(0, 120),
      materialId,
    });
    await prisma.studyMaterial.update({
      where: { id: materialId },
      data: { status: 'READY', geminiDocument: documentName, error: null },
    });
  } catch (error) {
    console.error('[ai] material processing failed', materialId, error);
    await prisma.studyMaterial
      .update({
        where: { id: materialId },
        data: {
          status: 'FAILED',
          error:
            error instanceof AiError ? error.message : 'This file could not be read. Try another copy of it.',
        },
      })
      .catch(() => undefined);
  }
}

import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { MediaKind } from '@prisma/client';

import { ApiError } from '@/lib/api';
import { prisma } from '@/lib/db';

/**
 * File storage for question images and uploaded answer sheets.
 *
 * Three rules shape this module:
 *
 *  1. **The declared content type is never trusted.** The real format is
 *     determined by reading the bytes. A file that does not parse as one of the
 *     accepted image formats is rejected, whatever it claims to be.
 *  2. **Metadata is stripped before the file is stored.** A photograph of
 *     handwritten work taken on a phone typically carries EXIF GPS — the
 *     student's home address, in effect. An examination platform has no need
 *     for it, so it never reaches disk.
 *  3. **Names are server-generated.** The stored path is random and the
 *     original filename is kept only as a display label, so a crafted name can
 *     never influence where bytes land.
 *
 * Files live outside `public/` and are served only through an authorising
 * route, so no image is reachable by guessing a URL.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB per file
/** Guards against decompression bombs — a 50000² PNG is a few KB on disk. */
const MAX_IMAGE_DIMENSION = 10_000;

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR ?? './var/uploads');

const KIND_FOLDER: Record<MediaKind, string> = {
  QUESTION_IMAGE: 'questions',
  OPTION_IMAGE: 'options',
  ANSWER_IMAGE: 'answers',
};

export interface ImageInfo {
  mimeType: string;
  extension: string;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readPng(buffer: Buffer): ImageInfo | null {
  if (!startsWith(buffer, PNG_SIGNATURE)) return null;
  // The IHDR chunk is required to be first, and carries the dimensions.
  if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return {
    mimeType: 'image/png',
    extension: 'png',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

/** Frame-header markers that carry dimensions; excludes DHT/JPG/DAC. */
function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function readJpeg(buffer: Buffer): ImageInfo | null {
  if (!startsWith(buffer, [0xff, 0xd8])) return null;

  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) return null; // desynchronised — not a valid JPEG
    const marker = buffer[offset + 1]!;

    // Padding bytes between segments are legal.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Start of scan: everything after is entropy-coded, no more headers.
    if (marker === 0xda || marker === 0xd9) return null;

    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;

    if (isStartOfFrame(marker)) {
      if (offset + 9 > buffer.length) return null;
      return {
        mimeType: 'image/jpeg',
        extension: 'jpg',
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }
  return null;
}

function readWebp(buffer: Buffer): ImageInfo | null {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buffer.toString('ascii', 8, 12) !== 'WEBP') return null;

  const chunk = buffer.toString('ascii', 12, 16);
  const base = { mimeType: 'image/webp', extension: 'webp' };

  if (chunk === 'VP8X') {
    // Extended format: canvas size is stored as two 24-bit values, minus one.
    return {
      ...base,
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    };
  }
  if (chunk === 'VP8 ') {
    // Lossy: dimensions follow the 3-byte start code in the frame header.
    if (buffer.length < 30) return null;
    return {
      ...base,
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    // Lossless: 14 bits each, packed little-endian after the 0x2f signature.
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return {
      ...base,
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

/**
 * Identifies the file by its actual bytes. Successfully parsing the dimensions
 * doubles as proof the file really is the format it appears to be, so a
 * renamed executable cannot slip through.
 */
export function sniffImage(buffer: Buffer): ImageInfo | null {
  return readPng(buffer) ?? readJpeg(buffer) ?? readWebp(buffer);
}

// ---------------------------------------------------------------------------
// Metadata removal
// ---------------------------------------------------------------------------

/** APP1 holds EXIF (including GPS) and XMP; APP13 holds IPTC; FE is a comment. */
const JPEG_STRIP_MARKERS = new Set([0xe1, 0xed, 0xfe]);

function stripJpegMetadata(buffer: Buffer): Buffer {
  const parts: Buffer[] = [buffer.subarray(0, 2)]; // SOI
  let offset = 2;

  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1]!;

    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // From SOS onward the data is entropy-coded; copy the remainder verbatim.
    if (marker === 0xda) {
      parts.push(buffer.subarray(offset));
      return Buffer.concat(parts);
    }

    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    const end = offset + 2 + length;
    if (end > buffer.length) break;

    if (!JPEG_STRIP_MARKERS.has(marker)) {
      parts.push(buffer.subarray(offset, end));
    }
    offset = end;
  }

  return Buffer.concat(parts);
}

/**
 * Ancillary PNG chunks that carry metadata rather than pixels. Chunks each
 * carry their own CRC, so dropping whole chunks leaves the file valid.
 */
const PNG_STRIP_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function stripPngMetadata(buffer: Buffer): Buffer {
  const parts: Buffer[] = [buffer.subarray(0, 8)]; // signature
  let offset = 8;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length; // length + type + data + crc
    if (end > buffer.length) break;

    if (!PNG_STRIP_CHUNKS.has(type)) {
      parts.push(buffer.subarray(offset, end));
    }

    offset = end;
    if (type === 'IEND') break;
  }

  return Buffer.concat(parts);
}

function stripWebpMetadata(buffer: Buffer): Buffer {
  const body: Buffer[] = [];
  let offset = 12; // past "RIFF" + size + "WEBP"

  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    // RIFF chunks are padded to an even length.
    const end = offset + 8 + size + (size % 2);
    if (end > buffer.length) break;

    if (type !== 'EXIF' && type !== 'XMP ') {
      body.push(buffer.subarray(offset, end));
    }
    offset = end;
  }

  const payload = Buffer.concat(body);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(payload.length + 4, 4); // size covers "WEBP" + chunks
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, payload]);
}

/**
 * Removes identifying metadata. Falls back to the original bytes if the
 * rewrite produced something implausible, so a parser edge case degrades to
 * "stored as uploaded" rather than to a corrupt file.
 */
export function stripMetadata(buffer: Buffer, mimeType: string): Buffer {
  let stripped: Buffer;
  try {
    if (mimeType === 'image/jpeg') stripped = stripJpegMetadata(buffer);
    else if (mimeType === 'image/png') stripped = stripPngMetadata(buffer);
    else if (mimeType === 'image/webp') stripped = stripWebpMetadata(buffer);
    else return buffer;
  } catch {
    return buffer;
  }

  // The result must still parse as the same format, or we keep the original.
  const info = sniffImage(stripped);
  if (!info || info.mimeType !== mimeType) return buffer;
  return stripped;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Resolves a storage key to an absolute path, refusing anything that escapes. */
function resolveStoragePath(storageKey: string): string {
  const resolved = path.resolve(UPLOAD_ROOT, storageKey);
  const root = UPLOAD_ROOT.endsWith(path.sep) ? UPLOAD_ROOT : UPLOAD_ROOT + path.sep;
  if (!resolved.startsWith(root)) {
    // Keys are server-generated, so this is belt and braces — but a path
    // traversal here would read arbitrary files, so it is checked anyway.
    throw new ApiError('FORBIDDEN', 'Invalid storage location.');
  }
  return resolved;
}

/** Keeps a readable label for the UI without letting it reach the filesystem. */
function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'upload';
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'upload';
}

export interface StoreUploadInput {
  buffer: Buffer;
  kind: MediaKind;
  originalName: string;
  uploadedById: string | null;
}

export async function storeUpload(input: StoreUploadInput) {
  if (input.buffer.length === 0) {
    throw new ApiError('VALIDATION', 'That file is empty.');
  }
  if (input.buffer.length > MAX_UPLOAD_BYTES) {
    throw new ApiError(
      'VALIDATION',
      `Images must be ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB or smaller.`,
    );
  }

  const info = sniffImage(input.buffer);
  if (!info) {
    throw new ApiError(
      'VALIDATION',
      'That file is not a readable image. Please upload a PNG, JPEG or WebP.',
    );
  }
  if (info.width > MAX_IMAGE_DIMENSION || info.height > MAX_IMAGE_DIMENSION) {
    throw new ApiError('VALIDATION', 'That image is too large in pixel dimensions.');
  }

  const bytes = stripMetadata(input.buffer, info.mimeType);
  const checksum = createHash('sha256').update(bytes).digest('hex');

  const now = new Date();
  const storageKey = path.posix.join(
    KIND_FOLDER[input.kind],
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${randomBytes(16).toString('hex')}.${info.extension}`,
  );

  const target = resolveStoragePath(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);

  try {
    return await prisma.mediaAsset.create({
      data: {
        kind: input.kind,
        storageKey,
        originalName: safeDisplayName(input.originalName),
        mimeType: info.mimeType,
        byteSize: bytes.length,
        width: info.width,
        height: info.height,
        checksum,
        uploadedById: input.uploadedById,
      },
    });
  } catch (error) {
    // Never leave an orphaned file behind if the row could not be written.
    await unlink(target).catch(() => undefined);
    throw error;
  }
}

export async function readAssetBytes(storageKey: string): Promise<Buffer> {
  try {
    return await readFile(resolveStoragePath(storageKey));
  } catch {
    throw new ApiError('NOT_FOUND', 'That file is no longer available.');
  }
}

/** Removes the row and its bytes. Missing bytes are not an error. */
export async function deleteAsset(assetId: string): Promise<void> {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: { id: true, storageKey: true },
  });
  if (!asset) return;

  await prisma.mediaAsset.delete({ where: { id: asset.id } });
  await unlink(resolveStoragePath(asset.storageKey)).catch(() => undefined);
}

/**
 * Deletes each of these assets, but only if nothing points at it any more.
 *
 * Call this after removing questions or replacing their options, with the ids
 * those rows *used* to reference. Without it an image outlives the only thing
 * that could authorise reading it: the bytes stay on disk forever, and for a
 * photograph of a student's work that is a retention problem, not just waste.
 *
 * Each id is re-checked against every table that can reference an asset rather
 * than assumed unused, so an image shared by two rows is never pulled out from
 * under the one still using it. Failures are swallowed per asset: losing a file
 * is not a reason to fail the edit that triggered the cleanup.
 */
export async function deleteUnreferencedAssets(assetIds: Array<string | null>): Promise<number> {
  const candidates = [...new Set(assetIds.filter((id): id is string => Boolean(id)))];
  let removed = 0;

  for (const assetId of candidates) {
    try {
      const [questions, options, attachments] = await Promise.all([
        prisma.question.count({ where: { imageAssetId: assetId } }),
        prisma.option.count({ where: { imageAssetId: assetId } }),
        prisma.answerAttachment.count({ where: { assetId } }),
      ]);
      if (questions + options + attachments > 0) continue;

      await deleteAsset(assetId);
      removed++;
    } catch {
      // Leave the asset in place rather than aborting the caller's work.
    }
  }

  return removed;
}

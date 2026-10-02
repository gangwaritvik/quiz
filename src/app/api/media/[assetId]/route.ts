import { ApiError, route } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { readAssetBytes } from '@/lib/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ assetId: string }>;
}

/**
 * Serves an uploaded image.
 *
 * Every read is authorised against the *relationship* between the viewer and
 * the asset, not merely against holding its id:
 *
 *  - faculty may read any asset, since they author papers and mark answers;
 *  - a student may read a question or option image only if that question is on
 *    a paper they were actually served;
 *  - a student may read an answer image only if it is attached to their own
 *    answer.
 *
 * So a leaked or guessed asset id is not sufficient to view another student's
 * uploaded work, nor to browse question images from a paper you have not sat.
 */
async function assertStudentMayRead(assetId: string, kind: string, studentId: string) {
  if (kind === 'ANSWER_IMAGE') {
    const own = await prisma.answerAttachment.findFirst({
      where: { assetId, answer: { attempt: { studentId } } },
      select: { id: true },
    });
    if (!own) throw new ApiError('FORBIDDEN', 'That file does not belong to you.');
    return;
  }

  const served = await prisma.attemptQuestion.findFirst({
    where: {
      attempt: { studentId },
      question:
        kind === 'OPTION_IMAGE'
          ? { options: { some: { imageAssetId: assetId } } }
          : { imageAssetId: assetId },
    },
    select: { id: true },
  });

  if (!served) {
    throw new ApiError('FORBIDDEN', 'That image is not part of any of your papers.');
  }
}

export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireSession();
  const { assetId } = await params;

  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: { id: true, kind: true, storageKey: true, mimeType: true, originalName: true },
  });
  if (!asset) throw new ApiError('NOT_FOUND', 'That file could not be found.');

  if (session.role !== 'ADMIN') {
    if (!session.studentId) {
      throw new ApiError('FORBIDDEN', 'You cannot view this file.');
    }
    await assertStudentMayRead(asset.id, asset.kind, session.studentId);
  }

  const bytes = await readAssetBytes(asset.storageKey);

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': asset.mimeType,
      'Content-Length': String(bytes.length),
      // Storage keys are random and content never changes under a given id, so
      // this is safe to cache — but only ever in the viewer's own browser.
      'Cache-Control': 'private, max-age=3600, immutable',
      'Content-Disposition': `inline; filename="${asset.originalName.replace(/"/g, '')}"`,
    },
  });
});

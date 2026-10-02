import { ApiError, assertSameOrigin, ok, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { attachAnswerImage } from '@/lib/exam';
import { loadLiveAttempt, recordServerEvent } from '@/lib/exam-guard';
import { MAX_UPLOAD_BYTES, deleteAsset, storeUpload } from '@/lib/media';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

/**
 * Attaches a photograph of written work to an image answer.
 *
 * Routed through `loadLiveAttempt` like every other in-exam write, so the same
 * ownership, device-binding and deadline rules apply — an upload arriving after
 * time is up is refused exactly as a late answer would be.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireStudent();
  const context = await getRequestContext();
  const { attemptId } = await params;

  enforceRateLimit(RATE_LIMITS.upload, `attempt:${attemptId}`);

  const { remaining } = await loadLiveAttempt(attemptId, session, context);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError('VALIDATION', 'Expected a file upload.');
  }

  const file = form.get('file');
  const attemptQuestionId = String(form.get('attemptQuestionId') ?? '');

  if (!(file instanceof File)) {
    throw new ApiError('VALIDATION', 'No file was included in the request.');
  }
  if (!attemptQuestionId) {
    throw new ApiError('VALIDATION', 'No question was specified for this upload.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(
      'VALIDATION',
      `Images must be ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB or smaller.`,
    );
  }

  const asset = await storeUpload({
    buffer: Buffer.from(await file.arrayBuffer()),
    kind: 'ANSWER_IMAGE',
    originalName: file.name || 'answer',
    uploadedById: session.userId,
  });

  let attachment;
  try {
    attachment = await attachAnswerImage({
      attemptId,
      studentId: session.studentId,
      attemptQuestionId,
      assetId: asset.id,
    });
  } catch (error) {
    // The bytes are already on disk; if linking them to an answer failed (a
    // full question, a closed attempt) they are of no use to anyone.
    await deleteAsset(asset.id).catch(() => undefined);
    throw error;
  }

  // Recorded as INFO. It also explains the window blur a file picker always
  // causes, so an invigilator reading the timeline is not misled into treating
  // an upload as a tab switch.
  await recordServerEvent(attemptId, 'ATTACHMENT_UPLOADED', {
    attemptQuestionId,
    byteSize: asset.byteSize,
  });

  return ok({
    attachment: {
      id: attachment.id,
      url: `/api/media/${attachment.asset.id}`,
      name: attachment.asset.originalName,
    },
    timer: {
      remainingMs: remaining.remainingMs,
      serverNow: new Date().toISOString(),
    },
  });
});

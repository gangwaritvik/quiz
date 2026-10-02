import type { MediaKind } from '@prisma/client';

import { ApiError, assertSameOrigin, ok, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { MAX_UPLOAD_BYTES, storeUpload } from '@/lib/media';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_KINDS = new Set<MediaKind>(['QUESTION_IMAGE', 'OPTION_IMAGE']);

/**
 * Faculty upload for a diagram used in a question or as an answer option.
 *
 * The asset is created unattached; the question editor stores the returned id
 * on save. Anything uploaded and then abandoned is harmless — it is unreachable
 * without an id, and never reaches a student because access is granted through
 * the question relationship, not by possession of the id.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  enforceRateLimit(RATE_LIMITS.upload, `admin:${session.userId}`);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError('VALIDATION', 'Expected a file upload.');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new ApiError('VALIDATION', 'No file was included in the request.');
  }
  // Checked before reading the body into memory as well as inside storeUpload.
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(
      'VALIDATION',
      `Images must be ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB or smaller.`,
    );
  }

  const kindValue = String(form.get('kind') ?? 'QUESTION_IMAGE') as MediaKind;
  if (!ALLOWED_KINDS.has(kindValue)) {
    throw new ApiError('VALIDATION', 'Unsupported image kind.');
  }

  const asset = await storeUpload({
    buffer: Buffer.from(await file.arrayBuffer()),
    kind: kindValue,
    originalName: file.name || 'image',
    uploadedById: session.userId,
  });

  await audit({
    userId: session.userId,
    action: 'admin.media_uploaded',
    entityType: 'MediaAsset',
    entityId: asset.id,
    metadata: { kind: asset.kind, byteSize: asset.byteSize },
  });

  return ok({
    id: asset.id,
    url: `/api/media/${asset.id}`,
    originalName: asset.originalName,
    width: asset.width,
    height: asset.height,
    byteSize: asset.byteSize,
  });
});

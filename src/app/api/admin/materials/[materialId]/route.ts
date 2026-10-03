import { deleteMaterialFile, processMaterial } from '@/lib/ai/materials';
import { AiError, getProvider } from '@/lib/ai/provider';
import { ApiError, assertSameOrigin, ok, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertMaterialOwner } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ materialId: string }>;
}

/** One material, including the text the AI reads when OCR was needed. */
export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireAdmin();
  const { materialId } = await params;
  await assertMaterialOwner(materialId, session.adminId);

  const material = await prisma.studyMaterial.findUniqueOrThrow({
    where: { id: materialId },
    select: {
      id: true,
      title: true,
      originalName: true,
      pageCount: true,
      scannedPages: true,
      ocrText: true,
      status: true,
      error: true,
    },
  });
  return ok(material);
});

/** Removes the material from the AI's index and from disk. */
export const DELETE = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);
  const session = await requireAdmin();
  const context = await getRequestContext();
  const { materialId } = await params;
  enforceRateLimit(RATE_LIMITS.adminWrite, `material-delete:${session.userId}`);
  await assertMaterialOwner(materialId, session.adminId);

  const material = await prisma.studyMaterial.findUniqueOrThrow({
    where: { id: materialId },
    select: { storageKey: true, geminiDocument: true, status: true },
  });
  if (material.status === 'OCR' || material.status === 'PROCESSING') {
    throw new ApiError('CONFLICT', 'Wait until this file has finished processing, then delete it.');
  }

  if (material.geminiDocument) {
    try {
      await (await getProvider()).deleteDocument(material.geminiDocument);
    } catch (error) {
      throw new ApiError(
        'CONFLICT',
        error instanceof AiError ? error.message : 'The file could not be removed from the AI index. Try again.',
      );
    }
  }

  await prisma.studyMaterial.delete({ where: { id: materialId } });
  await deleteMaterialFile(material.storageKey);

  await audit({
    action: 'admin.material_deleted',
    userId: session.userId,
    entityType: 'StudyMaterial',
    entityId: materialId,
    context,
  });
  return ok({ id: materialId });
});

/** Tries a failed material again (e.g. after Google was briefly overloaded). */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);
  const session = await requireAdmin();
  const { materialId } = await params;
  enforceRateLimit(RATE_LIMITS.aiUpload, `ai-upload:${session.userId}`);
  await assertMaterialOwner(materialId, session.adminId);

  const claimed = await prisma.studyMaterial.updateMany({
    where: { id: materialId, status: 'FAILED' },
    data: { status: 'PROCESSING', error: null },
  });
  if (claimed.count !== 1) throw new ApiError('CONFLICT', 'Only a failed file can be retried.');
  void processMaterial(materialId);
  return ok({ id: materialId });
});

import { failStaleJobs } from '@/lib/ai/jobs';
import {
  MAX_MATERIAL_BYTES,
  detectMaterial,
  failStaleMaterials,
  processMaterial,
  saveMaterialFile,
} from '@/lib/ai/materials';
import { pdfPageCount } from '@/lib/ai/pdf-pages';
import { aiEnabled } from '@/lib/ai/provider';
import { ApiError, assertSameOrigin, ok, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ subjectId: string }>;
}

/** The caller's study material for one subject, and their recent AI batches. */
export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireAdmin();
  const { subjectId } = await params;

  await Promise.all([failStaleMaterials(subjectId), failStaleJobs(session.adminId)]);

  const [materials, jobs] = await Promise.all([
    prisma.studyMaterial.findMany({
      where: { subjectId, ownerId: session.adminId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        mimeType: true,
        byteSize: true,
        pageCount: true,
        scannedPages: true,
        progress: true,
        status: true,
        error: true,
        createdAt: true,
      },
    }),
    prisma.generationJob.findMany({
      where: { subjectId, authorId: session.adminId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        stats: true,
        error: true,
        createdAt: true,
        _count: { select: { drafts: { where: { status: 'PENDING' } } } },
      },
    }),
  ]);

  return ok({
    enabled: aiEnabled(),
    materials: materials.map((material) => ({
      ...material,
      createdAt: material.createdAt.toISOString(),
    })),
    jobs: jobs.map(({ _count, ...job }) => ({
      ...job,
      pending: _count.drafts,
      createdAt: job.createdAt.toISOString(),
    })),
  });
});

/**
 * Uploads study material. The file's real type is read from its bytes; it is
 * stored as our own copy, then OCR (if needed) and indexing run in the
 * background while the list shows its progress.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);
  const session = await requireAdmin();
  const context = await getRequestContext();
  const { subjectId } = await params;

  if (!aiEnabled()) {
    throw new ApiError('CONFLICT', 'AI question generation is not set up on this server.');
  }
  enforceRateLimit(RATE_LIMITS.aiUpload, `ai-upload:${session.userId}`);

  const subject = await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true } });
  if (!subject) throw new ApiError('NOT_FOUND', 'That subject no longer exists.');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError('VALIDATION', 'Expected a file upload.');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError('VALIDATION', 'No file was included in the request.');
  if (file.size > MAX_MATERIAL_BYTES) {
    throw new ApiError('VALIDATION', `Study material must be ${MAX_MATERIAL_BYTES / (1024 * 1024)} MB or smaller.`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectMaterial(buffer);
  if (!detected) {
    throw new ApiError('VALIDATION', 'Upload a PDF, Word (.docx), PowerPoint (.pptx), JPG or PNG file.');
  }

  let pageCount: number | null = null;
  if (detected.kind === 'pdf') {
    pageCount = await pdfPageCount(new Uint8Array(buffer));
    if (pageCount === null) {
      throw new ApiError('VALIDATION', 'This PDF could not be opened. If it is password-protected, remove the password first.');
    }
  }

  const originalName = (file.name || `material.${detected.extension}`).slice(0, 200);
  const title = String(form.get('title') ?? '').trim().slice(0, 120) || originalName.replace(/\.[a-z0-9]+$/i, '');
  const storageKey = await saveMaterialFile(buffer, detected.extension);

  const material = await prisma.studyMaterial.create({
    data: {
      subjectId,
      ownerId: session.adminId,
      title,
      originalName,
      mimeType: detected.mimeType,
      byteSize: buffer.length,
      storageKey,
      pageCount,
      status: 'PROCESSING',
    },
    select: { id: true, title: true, status: true },
  });

  await audit({
    action: 'admin.material_uploaded',
    userId: session.userId,
    entityType: 'StudyMaterial',
    entityId: material.id,
    context,
    metadata: { subjectId, kind: detected.kind, byteSize: buffer.length, pageCount },
  });

  // Background: OCR and indexing can take minutes; the list polls for status.
  void processMaterial(material.id);

  return ok(material);
});

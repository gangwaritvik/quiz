import { failStaleJobs } from '@/lib/ai/jobs';
import { ok, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertJobOwner } from '@/lib/ownership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ jobId: string }>;
}

/** A generation batch and its drafts, for the review screen (polled while running). */
export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireAdmin();
  const { jobId } = await params;
  await assertJobOwner(jobId, session.adminId);
  await failStaleJobs(session.adminId);

  const job = await prisma.generationJob.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      params: true,
      stats: true,
      error: true,
      materialIds: true,
      createdAt: true,
      finishedAt: true,
      subject: {
        select: { id: true, name: true, code: true, topics: { select: { id: true, name: true }, orderBy: { name: 'asc' } } },
      },
      drafts: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, payload: true, source: true, questionId: true },
      },
    },
  });

  const materials = await prisma.studyMaterial.findMany({
    where: { id: { in: job.materialIds } },
    select: { id: true, title: true },
  });

  return ok({
    ...job,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    materials,
  });
});

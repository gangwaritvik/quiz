import { createQuizFromDrafts } from '@/lib/ai/jobs';
import { assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { assertJobOwner } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { createQuizFromDraftsSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ jobId: string }>;
}

/** Turns a batch into a draft quiz; the teacher assigns students and publishes it from the quiz page. */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);
  const session = await requireAdmin();
  const context = await getRequestContext();
  const { jobId } = await params;
  enforceRateLimit(RATE_LIMITS.adminWrite, `ai-quiz:${session.userId}`);
  await assertJobOwner(jobId, session.adminId);
  const body = await parseBody(request, createQuizFromDraftsSchema);

  const result = await createQuizFromDrafts({
    jobId,
    adminId: session.adminId,
    title: body.title,
    durationMinutes: body.durationMinutes,
    startsAt: new Date(body.startsAt),
    endsAt: new Date(body.endsAt),
    addToBank: body.addToBank,
  });

  await audit({
    action: 'admin.quiz_created',
    userId: session.userId,
    entityType: 'Quiz',
    entityId: result.quizId,
    context,
    metadata: { title: body.title, source: 'ai', jobId, ...result },
  });
  return ok(result);
});

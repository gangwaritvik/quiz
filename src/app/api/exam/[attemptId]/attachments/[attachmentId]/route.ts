import { assertSameOrigin, ok, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { detachAnswerImage } from '@/lib/exam';
import { loadLiveAttempt } from '@/lib/exam-guard';
import { deleteAsset } from '@/lib/media';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string; attachmentId: string }>;
}

/** Removes an attachment a student added, while their attempt is still open. */
export const DELETE = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireStudent();
  const context = await getRequestContext();
  const { attemptId, attachmentId } = await params;

  enforceRateLimit(RATE_LIMITS.answerSave, `detach:${attemptId}`);

  const { remaining } = await loadLiveAttempt(attemptId, session, context);

  const { assetId } = await detachAnswerImage({
    attemptId,
    studentId: session.studentId,
    attachmentId,
  });

  // Nothing else can reference the asset once the attachment row is gone.
  await deleteAsset(assetId).catch(() => undefined);

  return ok({
    removed: true,
    attachmentId,
    timer: {
      remainingMs: remaining.remainingMs,
      serverNow: new Date().toISOString(),
    },
  });
});

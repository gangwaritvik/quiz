import { assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { gradeAnswerManually } from '@/lib/exam';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { gradeAnswerSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ answerId: string }>;
}

/**
 * Records a mark for one descriptive or uploaded answer.
 *
 * Marking changes a student's total after submission, so it is audited and
 * also written to the attempt's own timeline — a score that moves later is
 * always traceable to a person and a time.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { answerId } = await params;

  enforceRateLimit(RATE_LIMITS.adminWrite, `grade:${session.userId}`);

  const body = await parseBody(request, gradeAnswerSchema);

  const attempt = await gradeAnswerManually({
    answerId,
    adminId: session.adminId,
    awardedMarks: body.awardedMarks,
    note: body.note || null,
  });

  await audit({
    action: 'admin.answer_graded',
    userId: session.userId,
    entityType: 'Answer',
    entityId: answerId,
    context,
    metadata: { awardedMarks: body.awardedMarks, attemptId: attempt.id },
  });

  return ok({
    graded: true,
    answerId,
    attempt: {
      id: attempt.id,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percentage: attempt.percentage,
      pendingCount: attempt.pendingManualCount,
    },
  });
});

import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertAttemptOwner } from '@/lib/ownership';
import { EVENT_LABELS, computeIntegrity } from '@/lib/integrity';
import { getRequestContext } from '@/lib/session';
import { integrityReviewSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

/** Full investigation view: the score, its derivation, and the raw timeline. */
export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireAdmin();
  const { attemptId } = await params;
  await assertAttemptOwner(attemptId, session.adminId);

  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    include: {
      student: { include: { user: { select: { name: true, email: true } } } },
      quiz: { select: { id: true, title: true, durationMinutes: true, subject: { select: { name: true } } } },
      integrity: true,
      session: { select: { deviceLabel: true, trusted: true } },
      events: { orderBy: { occurredAt: 'asc' } },
      reviews: {
        include: { admin: { include: { user: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!attempt) throw new ApiError('NOT_FOUND', 'Attempt not found.');

  // Recomputed live so the breakdown always matches the events on screen.
  const computation = computeIntegrity(attempt.events);

  return ok({
    attempt: {
      id: attempt.id,
      status: attempt.status,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percentage: attempt.percentage,
      deviceLabel: attempt.session?.deviceLabel ?? 'Unknown device',
      trustedDevice: attempt.session?.trusted ?? false,
    },
    student: {
      id: attempt.studentId,
      name: attempt.student.user.name,
      email: attempt.student.user.email,
      rollNumber: attempt.student.rollNumber,
      department: attempt.student.department,
      section: attempt.student.section,
    },
    quiz: {
      id: attempt.quiz.id,
      title: attempt.quiz.title,
      subject: attempt.quiz.subject.name,
      durationMinutes: attempt.quiz.durationMinutes,
    },
    integrity: {
      score: computation.score,
      status: computation.status,
      breakdown: computation.breakdown,
      clean: computation.clean,
      reviewed: attempt.integrity?.reviewed ?? false,
    },
    timeline: attempt.events.map((event) => ({
      id: event.id,
      type: event.type,
      label: EVENT_LABELS[event.type],
      severity: event.severity,
      occurredAt: event.occurredAt.toISOString(),
      durationMs: event.durationMs,
      metadata: event.metadata,
    })),
    reviews: attempt.reviews.map((review) => ({
      id: review.id,
      outcome: review.outcome,
      note: review.note,
      adminName: review.admin.user.name,
      createdAt: review.createdAt.toISOString(),
    })),
  });
});

/** Records a faculty review decision. The score itself is never overwritten. */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { attemptId } = await params;
  await assertAttemptOwner(attemptId, session.adminId);

  const body = await parseBody(request, integrityReviewSchema);

  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.integrityReview.create({
      data: {
        attemptId,
        adminId: session.adminId,
        outcome: body.outcome,
        note: body.note || null,
      },
    });

    await tx.integrityScore.updateMany({
      where: { attemptId },
      data: { reviewed: true },
    });

    return created;
  });

  await audit({
    action: 'admin.integrity_reviewed',
    userId: session.userId,
    entityType: 'QuizAttempt',
    entityId: attemptId,
    context,
    metadata: { outcome: body.outcome },
  });

  return ok({ reviewId: review.id, outcome: review.outcome });
});

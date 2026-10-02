import { ok, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { canStartAnother } from '@/lib/attempt-policy';
import { prisma } from '@/lib/db';
import { sweepExpiredAttempts } from '@/lib/exam';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Every quiz assigned to the caller, past and present. */
export const GET = route(async () => {
  const session = await requireStudent();
  enforceRateLimit(RATE_LIMITS.read, `quizzes:${session.userId}`);
  await sweepExpiredAttempts();

  const now = new Date();
  const assignments = await prisma.quizAssignment.findMany({
    where: { studentId: session.studentId, quiz: { status: { not: 'DRAFT' } } },
    include: {
      quiz: {
        include: {
          subject: { select: { name: true, code: true } },
          attempts: {
            where: { studentId: session.studentId },
            select: { id: true, status: true, percentage: true, submittedAt: true },
            orderBy: { attemptNumber: 'desc' },
          },
        },
      },
    },
    orderBy: { quiz: { startsAt: 'desc' } },
  });

  const quizzes = assignments.map(({ quiz, extraAttempts }) => {
    const live = quiz.attempts.find((a) => a.status === 'IN_PROGRESS');
    // The newest finished attempt carries the result link and score.
    const latest = quiz.attempts.find(
      (a) => a.status === 'SUBMITTED' || a.status === 'AUTO_SUBMITTED',
    );
    const finished = Boolean(latest);
    // A grant (or a quiz that allows several attempts) puts a finished quiz back on offer.
    const retakeOpen =
      finished &&
      !live &&
      quiz.status === 'PUBLISHED' &&
      now >= quiz.startsAt &&
      now <= quiz.endsAt &&
      canStartAnother(quiz, extraAttempts, quiz.attempts.length);

    return {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      subject: quiz.subject.name,
      subjectCode: quiz.subject.code,
      questionCount: quiz.questionCount,
      durationMinutes: quiz.durationMinutes,
      startsAt: quiz.startsAt.toISOString(),
      endsAt: quiz.endsAt.toISOString(),
      state: live
        ? 'IN_PROGRESS'
        : retakeOpen
          ? 'AVAILABLE'
          : finished
            ? 'COMPLETED'
            : now > quiz.endsAt
            ? 'CLOSED'
            : now < quiz.startsAt
              ? 'SCHEDULED'
              : 'AVAILABLE',
      activeAttemptId: live?.id ?? null,
      // A result link is offered only when the teacher has released results.
      resultAttemptId: latest && quiz.releaseResults ? latest.id : null,
      percentage: latest && quiz.releaseResults ? latest.percentage : null,
      cameraMonitoring: quiz.cameraMonitoring,
    };
  });

  return ok({ quizzes });
});

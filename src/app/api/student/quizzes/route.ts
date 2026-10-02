import { ok, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
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

  const quizzes = assignments.map(({ quiz }) => {
    const latest = quiz.attempts[0];
    const finished =
      latest && (latest.status === 'SUBMITTED' || latest.status === 'AUTO_SUBMITTED');

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
      state: finished
        ? 'COMPLETED'
        : latest?.status === 'IN_PROGRESS'
          ? 'IN_PROGRESS'
          : now > quiz.endsAt
            ? 'CLOSED'
            : now < quiz.startsAt
              ? 'SCHEDULED'
              : 'AVAILABLE',
      activeAttemptId: latest?.status === 'IN_PROGRESS' ? latest.id : null,
      // A result link is offered only when the teacher has released results.
      resultAttemptId: finished && quiz.releaseResults ? latest.id : null,
      percentage: finished && quiz.releaseResults ? latest.percentage : null,
      cameraMonitoring: quiz.cameraMonitoring,
    };
  });

  return ok({ quizzes });
});

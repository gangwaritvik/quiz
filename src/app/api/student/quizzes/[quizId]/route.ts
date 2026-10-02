import { ApiError, ok, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ quizId: string }>;
}

/**
 * Pre-exam briefing data. Returns the security policy the student is about to
 * be held to — but never the question paper, which only exists once an attempt
 * has been created server-side.
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireStudent();
  const { quizId } = await params;

  const assignment = await prisma.quizAssignment.findUnique({
    where: { quizId_studentId: { quizId, studentId: session.studentId } },
    include: {
      quiz: {
        include: {
          subject: { select: { name: true, code: true } },
          attempts: {
            where: { studentId: session.studentId },
            select: { id: true, status: true, attemptNumber: true, expiresAt: true },
            orderBy: { attemptNumber: 'desc' },
          },
        },
      },
    },
  });

  // Unassigned quizzes are indistinguishable from non-existent ones.
  if (!assignment || assignment.quiz.status === 'DRAFT') {
    throw new ApiError('NOT_FOUND', 'This quiz is not available to you.');
  }

  const { quiz } = assignment;
  const now = new Date();
  const latest = quiz.attempts[0];
  const finished = quiz.attempts.some(
    (a) => a.status === 'SUBMITTED' || a.status === 'AUTO_SUBMITTED',
  );

  // A student on extra time can still be sitting after the window closes, and
  // must be able to get back in; their own clock decides, as on the server.
  const canResume = latest?.status === 'IN_PROGRESS' && latest.expiresAt > now;

  const blockedReason =
    quiz.status !== 'PUBLISHED'
      ? 'This quiz is not currently open.'
      : now < quiz.startsAt
        ? 'This quiz has not started yet.'
        : now > quiz.endsAt && !canResume
          ? 'The window for this quiz has closed.'
          : finished && quiz.singleAttempt
            ? 'You have already completed this quiz. Only one attempt is permitted.'
            : null;

  return ok({
    quiz: {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      subject: quiz.subject.name,
      subjectCode: quiz.subject.code,
      questionCount: quiz.questionCount,
      durationMinutes: quiz.durationMinutes,
      startsAt: quiz.startsAt.toISOString(),
      endsAt: quiz.endsAt.toISOString(),
      security: {
        requireFullscreen: quiz.requireFullscreen,
        detectTabSwitch: quiz.detectTabSwitch,
        blockCopyPaste: quiz.blockCopyPaste,
        bindDeviceSession: quiz.bindDeviceSession,
        cameraMonitoring: quiz.cameraMonitoring,
        microphoneMonitoring: quiz.microphoneMonitoring,
        singleAttempt: quiz.singleAttempt,
        maxFullscreenExits: quiz.maxFullscreenExits,
        lockQuestionNavigation: quiz.lockQuestionNavigation,
        blockMultipleDisplays: quiz.blockMultipleDisplays,
        requireScreenShare: quiz.requireScreenShare,
      },
    },
    extraMinutes: assignment.extraMinutes,
    canStart: blockedReason === null,
    blockedReason,
    activeAttemptId: latest?.status === 'IN_PROGRESS' ? latest.id : null,
  });
});

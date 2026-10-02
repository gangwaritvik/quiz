import { ok, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { getAttemptPaper } from '@/lib/exam';
import { loadLiveAttempt, loadNotices } from '@/lib/exam-guard';
import { getRequestContext } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

/**
 * The exam paper as the student may see it.
 *
 * `getAttemptPaper` selects question and option *text* only — `isCorrect` and
 * `explanation` are never read into this response, so there is nothing for a
 * student to find in the network tab or in React state.
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireStudent();
  const context = await getRequestContext();
  const { attemptId } = await params;

  const { attempt, remaining, paused } = await loadLiveAttempt(attemptId, session, context);
  const { questions } = await getAttemptPaper(attemptId, session.studentId);

  return ok({
    attempt: {
      id: attempt.id,
      status: attempt.status,
      startedAt: attempt.startedAt.toISOString(),
    },
    quiz: {
      id: attempt.quiz.id,
      title: attempt.quiz.title,
      durationMinutes: attempt.quiz.durationMinutes,
      questionCount: questions.length,
      security: {
        requireFullscreen: attempt.quiz.requireFullscreen,
        detectTabSwitch: attempt.quiz.detectTabSwitch,
        blockCopyPaste: attempt.quiz.blockCopyPaste,
        bindDeviceSession: attempt.quiz.bindDeviceSession,
        cameraMonitoring: attempt.quiz.cameraMonitoring,
        microphoneMonitoring: attempt.quiz.microphoneMonitoring,
        maxFullscreenExits: attempt.quiz.maxFullscreenExits,
        lockQuestionNavigation: attempt.quiz.lockQuestionNavigation,
        blockMultipleDisplays: attempt.quiz.blockMultipleDisplays,
        requireScreenShare: attempt.quiz.requireScreenShare,
      },
    },
    questions,
    // The client renders this countdown but never decides on it.
    timer: {
      remainingMs: remaining.remainingMs,
      expiresAt: remaining.expiresAt.toISOString(),
      serverNow: remaining.serverNow.toISOString(),
    },
    // Total faculty-granted extra time, already inside `timer.expiresAt`. The
    // client uses a rise in this to tell the student their time was extended.
    extraMinutes: attempt.extraMinutes,
    paused,
    // Notices sent during this sitting, so a reload does not hide one.
    notices: await loadNotices(attempt.quizId, attempt.startedAt),
  });
});

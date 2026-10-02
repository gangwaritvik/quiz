import { ApiError, ok, route } from '@/lib/api';
import { requireStudent } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resultsVisibility } from '@/lib/exam';
import { effectiveEndsAt } from '@/lib/time-extension';
import { MANUAL_TYPES } from '@/lib/grading';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

/**
 * Result detail for a student's own attempt.
 *
 * Two gates apply: `releaseResults` controls whether the score is visible at
 * all, and `releaseAnswers` separately controls whether the correct option and
 * explanation are included. Until the teacher opts in, neither is read from
 * the database.
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireStudent();
  const { attemptId } = await params;

  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    include: {
      quiz: { include: { subject: { select: { name: true, code: true } } } },
      integrity: true,
    },
  });

  if (!attempt) throw new ApiError('NOT_FOUND', 'Result not found.');
  if (attempt.studentId !== session.studentId) {
    throw new ApiError('FORBIDDEN', 'This result does not belong to you.');
  }
  if (attempt.status === 'IN_PROGRESS') {
    throw new ApiError('CONFLICT', 'This attempt is still in progress.');
  }
  const visibility = resultsVisibility(attempt.quiz);
  if (!visibility.results) {
    // Released results still wait for the window to close, so nobody can
    // relay a score or answer key to students who are still sitting the paper.
    const releasesAt = attempt.quiz.releaseResults ? effectiveEndsAt(attempt.quiz).toISOString() : null;
    return ok({
      released: false,
      releasesAt,
      quiz: { title: attempt.quiz.title, subject: attempt.quiz.subject.name },
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      message: releasesAt
        ? 'Results will be available once the exam window closes.'
        : 'Your faculty has not released results for this quiz yet.',
    });
  }

  const showAnswers = visibility.answers;
  /** Some answers are still with a human marker, so the total will still move. */
  const provisional = attempt.pendingManualCount > 0;

  const attemptQuestions = await prisma.attemptQuestion.findMany({
    where: { attemptId },
    orderBy: { position: 'asc' },
    include: {
      question: {
        select: {
          id: true,
          text: true,
          type: true,
          topic: { select: { name: true } },
          // `modelAnswer` is rubric material for whoever marks the paper and is
          // never sent to a student, released answers or not.
          ...(showAnswers ? { explanation: true } : {}),
          options: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              text: true,
              // The answer key itself — read only once the teacher opts in.
              ...(showAnswers ? { isCorrect: true } : {}),
            },
          },
        },
      },
      answers: {
        select: {
          selectedOptionId: true,
          textResponse: true,
          isCorrect: true,
          awardedMarks: true,
          requiresManualGrading: true,
          gradedAt: true,
          graderNote: true,
          selectedOptions: { select: { optionId: true } },
          attachments: {
            orderBy: { position: 'asc' },
            select: { id: true, asset: { select: { id: true, originalName: true } } },
          },
        },
      },
    },
  });

  // Topic performance is derived from grading flags. Answers still awaiting a
  // marker are excluded rather than counted as wrong.
  const topicTotals = new Map<string, { correct: number; total: number }>();
  for (const aq of attemptQuestions) {
    const answer = aq.answers[0];
    if (answer?.requiresManualGrading && answer.gradedAt === null) continue;

    const topic = aq.question.topic?.name ?? 'General';
    const entry = topicTotals.get(topic) ?? { correct: 0, total: 0 };
    entry.total += 1;
    if (answer?.isCorrect) entry.correct += 1;
    topicTotals.set(topic, entry);
  }

  // With the answer key withheld, a topic's score is itself a leak: "0 of 3 in
  // Topic A" tells a student, and anyone they share it with, that every option
  // they chose there was wrong. So topics are shown only with the key.
  const topicPerformance = [...(showAnswers ? topicTotals.entries() : [])]
    .map(([topic, value]) => ({
      topic,
      correct: value.correct,
      total: value.total,
      percentage: Math.round((value.correct / value.total) * 100),
    }))
    .sort((a, b) => b.percentage - a.percentage);

  // The student's re-check requests on this result, newest first.
  const appeals = await prisma.resultAppeal.findMany({
    where: { attemptId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, reason: true, facultyNote: true, createdAt: true, resolvedAt: true },
  });

  return ok({
    released: true,
    appeal: appeals[0]
      ? {
          ...appeals[0],
          createdAt: appeals[0].createdAt.toISOString(),
          resolvedAt: appeals[0].resolvedAt?.toISOString() ?? null,
        }
      : null,
    canAppeal:
      attempt.pendingManualCount === 0 &&
      appeals.length < 3 &&
      !appeals.some((appeal) => appeal.status === 'OPEN'),
    showAnswers,
    provisional,
    pendingManualCount: attempt.pendingManualCount,
    // The signed-in student's own particulars for the answer-sheet header.
    // Taken from the session, which is the attempt's owner (checked above), so
    // no other student's record is read or returned.
    candidate: { name: session.name, rollNumber: session.rollNumber ?? null },
    // Released implies the window has closed; this is the date it did, so the
    // page can say when results became available.
    releasesAt: effectiveEndsAt(attempt.quiz).toISOString(),
    attempt: {
      id: attempt.id,
      status: attempt.status,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percentage: attempt.percentage,
      correctCount: attempt.correctCount,
      incorrectCount: attempt.incorrectCount,
      unansweredCount: attempt.unansweredCount,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
    },
    quiz: {
      title: attempt.quiz.title,
      subject: attempt.quiz.subject.name,
      subjectCode: attempt.quiz.subject.code,
      questionCount: attempt.quiz.questionCount,
    },
    integrity: attempt.integrity
      ? { score: attempt.integrity.score, status: attempt.integrity.status }
      : null,
    topicPerformance,
    questions: attemptQuestions.map((aq) => {
      const answer = aq.answers[0];
      const type = aq.question.type;
      const isManual = MANUAL_TYPES.has(type);
      const awaitingMarker = Boolean(answer?.requiresManualGrading && answer.gradedAt === null);

      const attachments =
        answer?.attachments.map((attachment) => ({
          id: attachment.id,
          url: `/api/media/${attachment.asset.id}`,
          name: attachment.asset.originalName,
        })) ?? [];

      const answered = (() => {
        if (!answer) return false;
        if (type === 'MCQ_MULTI') return answer.selectedOptions.length > 0;
        if (type === 'IMAGE_ANSWER') return attachments.length > 0;
        if (type === 'SHORT_ANSWER' || type === 'LONG_ANSWER') {
          return Boolean(answer.textResponse?.trim());
        }
        return Boolean(answer.selectedOptionId);
      })();

      // With answers withheld, per-question correctness is itself an answer
      // key: a student knows which option they picked, so "you got Q3 right"
      // discloses the correct option for Q3 and can be shared with students
      // who have not sat the paper. Only whole-paper counts are safe;
      // topic scores are not either, and are withheld above.
      const base = {
        position: aq.position,
        text: aq.question.text,
        type,
        topic: aq.question.topic?.name ?? 'General',
        marks: aq.marks,
        answered,
        awaitingMarker,
      };

      // A hand-marked answer has no option key to leak: the student's own
      // writing and their marker's feedback are theirs to see as soon as
      // results are released, independently of the answer-key gate.
      const ownWork = isManual
        ? {
            textResponse: answer?.textResponse ?? null,
            attachments,
            awardedMarks: awaitingMarker ? null : (answer?.awardedMarks ?? 0),
            graderNote: answer?.graderNote ?? null,
          }
        : {};

      if (!showAnswers) return { ...base, ...ownWork };

      const options = aq.question.options as Array<{
        id: string;
        text: string;
        isCorrect?: boolean;
      }>;

      return {
        ...base,
        ...ownWork,
        awardedMarks: awaitingMarker ? null : (answer?.awardedMarks ?? 0),
        isCorrect: awaitingMarker ? null : (answer?.isCorrect ?? null),
        explanation: (aq.question as { explanation?: string | null }).explanation ?? null,
        selectedOptionId: answer?.selectedOptionId ?? null,
        selectedOptionIds: answer?.selectedOptions.map((s) => s.optionId) ?? [],
        textResponse: answer?.textResponse ?? null,
        attachments,
        options: options.map((o) => ({
          id: o.id,
          text: o.text,
          isCorrect: Boolean(o.isCorrect),
        })),
      };
    }),
  });
});

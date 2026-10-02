import { ApiError, ok, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

/** Faculty-only view of one student's complete submitted paper and responses. */
export const GET = route(async (_request: Request, { params }: Params) => {
  await requireAdmin();
  const { attemptId } = await params;

  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      submittedAt: true,
      score: true,
      maxScore: true,
      percentage: true,
      correctCount: true,
      incorrectCount: true,
      unansweredCount: true,
      pendingManualCount: true,
      student: {
        select: {
          rollNumber: true,
          section: true,
          department: true,
          user: { select: { name: true, email: true } },
        },
      },
      quiz: {
        select: { id: true, title: true, subject: { select: { name: true } } },
      },
      questions: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          position: true,
          marks: true,
          optionOrder: true,
          question: {
            select: {
              text: true,
              type: true,
              explanation: true,
              modelAnswer: true,
              maxWords: true,
              topic: { select: { name: true } },
              options: {
                orderBy: { position: 'asc' },
                select: {
                  id: true,
                  text: true,
                  isCorrect: true,
                  imageAssetId: true,
                },
              },
            },
          },
          answers: {
            select: {
              id: true,
              selectedOptionId: true,
              textResponse: true,
              isCorrect: true,
              awardedMarks: true,
              markedForReview: true,
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
      },
    },
  });

  if (!attempt) throw new ApiError('NOT_FOUND', 'Attempt not found.');

  return ok({
    attempt: {
      id: attempt.id,
      status: attempt.status,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percentage: attempt.percentage,
      correctCount: attempt.correctCount,
      incorrectCount: attempt.incorrectCount,
      unansweredCount: attempt.unansweredCount,
      pendingManualCount: attempt.pendingManualCount,
    },
    student: {
      name: attempt.student.user.name,
      email: attempt.student.user.email,
      rollNumber: attempt.student.rollNumber,
      section: attempt.student.section,
      department: attempt.student.department,
    },
    quiz: { id: attempt.quiz.id, title: attempt.quiz.title, subject: attempt.quiz.subject.name },
    questions: attempt.questions.map((attemptQuestion) => {
      const answer = attemptQuestion.answers[0] ?? null;
      const optionsById = new Map(attemptQuestion.question.options.map((option) => [option.id, option]));
      const optionIds = attemptQuestion.optionOrder.length
        ? attemptQuestion.optionOrder
        : attemptQuestion.question.options.map((option) => option.id);

      return {
        position: attemptQuestion.position,
        marks: attemptQuestion.marks,
        text: attemptQuestion.question.text,
        type: attemptQuestion.question.type,
        topic: attemptQuestion.question.topic?.name ?? null,
        explanation: attemptQuestion.question.explanation,
        modelAnswer: attemptQuestion.question.modelAnswer,
        maxWords: attemptQuestion.question.maxWords,
        options: optionIds.flatMap((id) => {
          const option = optionsById.get(id);
          return option
            ? [{
                id: option.id,
                text: option.text,
                isCorrect: option.isCorrect,
                imageUrl: option.imageAssetId ? `/api/media/${option.imageAssetId}` : null,
              }]
            : [];
        }),
        answer: answer
          ? {
              id: answer.id,
              selectedOptionId: answer.selectedOptionId,
              selectedOptionIds: answer.selectedOptions.map((selection) => selection.optionId),
              textResponse: answer.textResponse,
              isCorrect: answer.isCorrect,
              awardedMarks: answer.awardedMarks,
              markedForReview: answer.markedForReview,
              requiresManualGrading: answer.requiresManualGrading,
              gradedAt: answer.gradedAt?.toISOString() ?? null,
              graderNote: answer.graderNote,
              attachments: answer.attachments.map((attachment) => ({
                id: attachment.id,
                url: `/api/media/${attachment.asset.id}`,
                name: attachment.asset.originalName,
              })),
            }
          : null,
      };
    }),
  });
});

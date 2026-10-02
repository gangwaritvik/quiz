import { ApiError, ok, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertAttemptOwner } from '@/lib/ownership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ attemptId: string }>;
}

/**
 * One attempt's manually-markable answers, with everything the marker needs:
 * the question, the student's response, and the author's model answer.
 *
 * Faculty-only. The model answer in particular is rubric material and never
 * appears on any student-facing route.
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireAdmin();
  const { attemptId } = await params;
  await assertAttemptOwner(attemptId, session.adminId);

  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      score: true,
      maxScore: true,
      percentage: true,
      pendingManualCount: true,
      manualGradedAt: true,
      student: {
        select: {
          rollNumber: true,
          section: true,
          department: true,
          user: { select: { name: true, email: true } },
        },
      },
      quiz: {
        select: { id: true, title: true, releaseResults: true, subject: { select: { name: true } } },
      },
      questions: {
        orderBy: { position: 'asc' },
        select: {
          position: true,
          marks: true,
          question: {
            select: {
              text: true,
              type: true,
              modelAnswer: true,
              maxWords: true,
              imageAssetId: true,
              topic: { select: { name: true } },
            },
          },
          answers: {
            select: {
              id: true,
              textResponse: true,
              awardedMarks: true,
              graderNote: true,
              gradedAt: true,
              requiresManualGrading: true,
              gradedBy: { select: { user: { select: { name: true } } } },
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

  // Only the answers a person actually has to mark.
  const answers = attempt.questions
    .filter((aq) => aq.answers[0]?.requiresManualGrading)
    .map((aq) => {
      const answer = aq.answers[0]!;
      return {
        answerId: answer.id,
        position: aq.position,
        maxMarks: aq.marks,
        questionText: aq.question.text,
        questionType: aq.question.type,
        topic: aq.question.topic?.name ?? null,
        questionImageUrl: aq.question.imageAssetId
          ? `/api/media/${aq.question.imageAssetId}`
          : null,
        modelAnswer: aq.question.modelAnswer,
        maxWords: aq.question.maxWords,
        textResponse: answer.textResponse,
        attachments: answer.attachments.map((attachment) => ({
          id: attachment.id,
          url: `/api/media/${attachment.asset.id}`,
          name: attachment.asset.originalName,
        })),
        awardedMarks: answer.awardedMarks,
        graderNote: answer.graderNote,
        gradedAt: answer.gradedAt?.toISOString() ?? null,
        gradedBy: answer.gradedBy?.user.name ?? null,
      };
    });

  return ok({
    attempt: {
      id: attempt.id,
      status: attempt.status,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percentage: attempt.percentage,
      pendingCount: attempt.pendingManualCount,
      completedAt: attempt.manualGradedAt?.toISOString() ?? null,
    },
    student: {
      name: attempt.student.user.name,
      email: attempt.student.user.email,
      rollNumber: attempt.student.rollNumber,
      section: attempt.student.section,
      department: attempt.student.department,
    },
    quiz: {
      id: attempt.quiz.id,
      title: attempt.quiz.title,
      subject: attempt.quiz.subject.name,
      releaseResults: attempt.quiz.releaseResults,
    },
    answers,
  });
});

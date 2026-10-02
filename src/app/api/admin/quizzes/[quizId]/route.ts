import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { deleteUnreferencedAssets } from '@/lib/media';
import { assertQuizOwner } from '@/lib/ownership';
import { getRequestContext } from '@/lib/session';
import { updateQuizSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ quizId: string }>;
}

export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireAdmin();
  const { quizId } = await params;
  await assertQuizOwner(quizId, session.adminId);

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      subject: true,
      assignments: {
        include: {
          student: { include: { user: { select: { name: true, email: true } } } },
        },
      },
      attempts: {
        include: {
          student: { include: { user: { select: { name: true } } } },
          integrity: true,
        },
        orderBy: { startedAt: 'desc' },
      },
      // The written paper, for a FIXED-mode quiz. Empty for pooled quizzes,
      // which have no paper until a student starts one.
      questions: {
        orderBy: { position: 'asc' },
        include: {
          question: {
            include: {
              options: { orderBy: { position: 'asc' } },
              topic: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!quiz) throw new ApiError('NOT_FOUND', 'Quiz not found.');

  // Once a single student has been served this paper, it is frozen: their
  // recorded answers point at these very option rows, and their stored score
  // was computed against these marks. The database enforces the sharp edge of
  // this too — a served question cannot be deleted at all.
  const editable = quiz.sourceMode === 'FIXED' && quiz.attempts.length === 0;

  return ok({
    quiz: {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      subject: quiz.subject.name,
      subjectId: quiz.subjectId,
      status: quiz.status,
      sourceMode: quiz.sourceMode,
      questionCount: quiz.questionCount,
      totalMarks: quiz.totalMarks,
      durationMinutes: quiz.durationMinutes,
      startsAt: quiz.startsAt.toISOString(),
      endsAt: quiz.endsAt.toISOString(),
      poolTopicIds: quiz.poolTopicIds,
      difficultyMix: { easy: quiz.easyPct, medium: quiz.mediumPct, hard: quiz.hardPct },
      marking: {
        negativeMarkingPct: quiz.negativeMarkingPct,
        multiPartialCredit: quiz.multiPartialCredit,
      },
      security: {
        randomizeQuestions: quiz.randomizeQuestions,
        randomizeOptions: quiz.randomizeOptions,
        singleAttempt: quiz.singleAttempt,
        requireFullscreen: quiz.requireFullscreen,
        detectTabSwitch: quiz.detectTabSwitch,
        blockCopyPaste: quiz.blockCopyPaste,
        bindDeviceSession: quiz.bindDeviceSession,
        cameraMonitoring: quiz.cameraMonitoring,
        microphoneMonitoring: quiz.microphoneMonitoring,
        lockQuestionNavigation: quiz.lockQuestionNavigation,
        blockMultipleDisplays: quiz.blockMultipleDisplays,
        requireScreenShare: quiz.requireScreenShare,
        releaseResults: quiz.releaseResults,
        releaseAnswers: quiz.releaseAnswers,
      },
    },
    editable,
    // Faculty author the paper, so the answer key legitimately leaves the
    // server here — exactly as it does for the question bank. This route is
    // behind requireAdmin; no student-facing route ever includes `isCorrect`.
    questions: quiz.questions.map(({ question, position }) => ({
      id: question.id,
      position,
      text: question.text,
      type: question.type,
      marks: question.marks,
      assertionText: question.assertionText,
      reasonText: question.reasonText,
      acceptedAnswers: question.acceptedAnswers,
      modelAnswer: question.modelAnswer,
      maxAttachments: question.maxAttachments,
      imageAssetId: question.imageAssetId,
      topic: question.topic?.name ?? null,
      options: question.options.map((option) => ({
        id: option.id,
        text: option.text,
        isCorrect: option.isCorrect,
        imageAssetId: option.imageAssetId,
      })),
    })),
    assignments: quiz.assignments.map((assignment) => ({
      studentId: assignment.studentId,
      name: assignment.student.user.name,
      rollNumber: assignment.student.rollNumber,
      section: assignment.student.section,
      extraAttempts: assignment.extraAttempts,
    })),
    attempts: quiz.attempts.map((attempt) => ({
      id: attempt.id,
      studentId: attempt.studentId,
      attemptNumber: attempt.attemptNumber,
      studentName: attempt.student.user.name,
      rollNumber: attempt.student.rollNumber,
      status: attempt.status,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percentage: attempt.percentage,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      integrityScore: attempt.integrity?.score ?? null,
      integrityStatus: attempt.integrity?.status ?? null,
    })),
  });
});

export const PATCH = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { quizId } = await params;
  await assertQuizOwner(quizId, session.adminId);

  const body = await parseBody(request, updateQuizSchema);

  const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
  if (!quiz) throw new ApiError('NOT_FOUND', 'Quiz not found.');

  const live = await prisma.quizAttempt.count({
    where: { quizId, status: 'IN_PROGRESS' },
  });

  // Un-publishing a quiz with live attempts would strip the paper out from
  // under students who are mid-exam.
  if (body.status && body.status !== 'PUBLISHED' && quiz.status === 'PUBLISHED' && live > 0) {
    throw new ApiError(
      'CONFLICT',
      `${live} student${live === 1 ? ' is' : 's are'} currently taking this exam. Wait for them to finish before changing its status.`,
    );
  }

  // The same reasoning covers the clock and the rules: shortening the window or
  // turning on fullscreen under someone already sitting the paper changes the
  // exam they agreed to start.
  const editsSettings =
    body.title !== undefined ||
    body.description !== undefined ||
    body.durationMinutes !== undefined ||
    body.startsAt !== undefined ||
    body.endsAt !== undefined ||
    body.easyPct !== undefined ||
    body.mediumPct !== undefined ||
    body.hardPct !== undefined ||
    body.negativeMarkingPct !== undefined ||
    body.multiPartialCredit !== undefined ||
    body.security !== undefined;

  if (editsSettings && live > 0) {
    throw new ApiError(
      'CONFLICT',
      `${live} student${live === 1 ? ' is' : 's are'} sitting this exam right now. Its settings cannot be changed mid-attempt.`,
    );
  }

  const startsAt = body.startsAt ? new Date(body.startsAt) : quiz.startsAt;
  const endsAt = body.endsAt ? new Date(body.endsAt) : quiz.endsAt;
  if (endsAt <= startsAt) {
    throw new ApiError('VALIDATION', 'The end of the window must be after its start.', {
      endsAt: ['Must be after the start'],
    });
  }

  const updated = await prisma.quiz.update({
    where: { id: quizId },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description || null } : {}),
      ...(body.durationMinutes !== undefined ? { durationMinutes: body.durationMinutes } : {}),
      ...(body.startsAt !== undefined ? { startsAt } : {}),
      ...(body.endsAt !== undefined ? { endsAt } : {}),
      ...(body.easyPct !== undefined ? { easyPct: body.easyPct } : {}),
      ...(body.mediumPct !== undefined ? { mediumPct: body.mediumPct } : {}),
      ...(body.hardPct !== undefined ? { hardPct: body.hardPct } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.negativeMarkingPct !== undefined ? { negativeMarkingPct: body.negativeMarkingPct } : {}),
      ...(body.multiPartialCredit !== undefined ? { multiPartialCredit: body.multiPartialCredit } : {}),
      ...(body.security ?? {}),
    },
  });

  await audit({
    action: body.status === 'PUBLISHED' ? 'admin.quiz_published' : 'admin.quiz_updated',
    userId: session.userId,
    entityType: 'Quiz',
    entityId: quizId,
    context,
    metadata: {
      ...(body.status ? { from: quiz.status, to: body.status } : {}),
      ...(editsSettings ? { change: 'settings' } : {}),
    },
  });

  return ok({ id: updated.id, status: updated.status });
});

/**
 * Deletes a quiz outright.
 *
 * Only ever allowed while no student has attempted it. An attempt is the
 * record of what someone was asked and how they answered; deleting the quiz
 * cascades that away, and no convenience in a list view is worth destroying an
 * examination record. Archiving exists for the rest.
 */
export const DELETE = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { quizId } = await params;
  await assertQuizOwner(quizId, session.adminId);

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: {
      id: true,
      title: true,
      _count: { select: { attempts: true } },
      questions: {
        select: {
          questionId: true,
          question: {
            select: { imageAssetId: true, options: { select: { imageAssetId: true } } },
          },
        },
      },
    },
  });
  if (!quiz) throw new ApiError('NOT_FOUND', 'Quiz not found.');

  if (quiz._count.attempts > 0) {
    throw new ApiError(
      'CONFLICT',
      `${quiz._count.attempts} student${quiz._count.attempts === 1 ? ' has' : 's have'} attempted this quiz, so it cannot be deleted — that would erase their examination record. Archive it instead.`,
    );
  }

  const questionIds = quiz.questions.map((link) => link.questionId);
  const assetIds = quiz.questions.flatMap((link) => [
    link.question.imageAssetId,
    ...link.question.options.map((option) => option.imageAssetId),
  ]);

  await prisma.$transaction(async (tx) => {
    // Assignments and the question links cascade from the quiz; the inline
    // questions themselves do not, since nothing owns them but this quiz.
    await tx.quiz.delete({ where: { id: quizId } });
    if (questionIds.length > 0) {
      await tx.question.deleteMany({ where: { id: { in: questionIds }, adHoc: true } });
    }
  });

  const removedImages = await deleteUnreferencedAssets(assetIds);

  await audit({
    action: 'admin.quiz_deleted',
    userId: session.userId,
    entityType: 'Quiz',
    entityId: quizId,
    context,
    metadata: { title: quiz.title, questionsRemoved: questionIds.length, removedImages },
  });

  return ok({ deleted: true });
});

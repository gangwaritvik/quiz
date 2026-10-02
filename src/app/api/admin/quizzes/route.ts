import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ownQuizWhere } from '@/lib/ownership';
import { questionFieldsFromInput, questionOptionsFromInput } from '@/lib/questions';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { createQuizSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const session = await requireAdmin();

  const quizzes = await prisma.quiz.findMany({
    where: ownQuizWhere(session.adminId),
    include: {
      subject: { select: { name: true, code: true } },
      author: { include: { user: { select: { name: true } } } },
      _count: { select: { assignments: true, attempts: true } },
    },
    orderBy: [{ startsAt: 'desc' }],
  });

  const now = new Date();

  return ok({
    quizzes: quizzes.map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      subject: quiz.subject.name,
      subjectCode: quiz.subject.code,
      status: quiz.status,
      sourceMode: quiz.sourceMode,
      questionCount: quiz.questionCount,
      durationMinutes: quiz.durationMinutes,
      difficultyMix: { easy: quiz.easyPct, medium: quiz.mediumPct, hard: quiz.hardPct },
      startsAt: quiz.startsAt.toISOString(),
      endsAt: quiz.endsAt.toISOString(),
      assignedCount: quiz._count.assignments,
      attemptCount: quiz._count.attempts,
      author: quiz.author?.user.name ?? 'Unassigned',
      live: quiz.status === 'PUBLISHED' && quiz.startsAt <= now && quiz.endsAt >= now,
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
    })),
  });
});

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  enforceRateLimit(RATE_LIMITS.adminWrite, `quiz-create:${session.userId}`);

  const body = await parseBody(request, createQuizSchema);

  const subject = await prisma.subject.findUnique({ where: { id: body.subjectId } });
  if (!subject) throw new ApiError('VALIDATION', 'Select a valid subject.');

  const fixed = body.sourceMode === 'FIXED';

  if (!fixed) {
    // Refuse to publish a quiz whose pool cannot fill the paper — better to fail
    // here than to strand a student at the start of an exam.
    const poolSize = await prisma.question.count({
      where: {
        active: true,
        adHoc: false,
        subjectId: body.subjectId,
        ...(body.poolTopicIds.length ? { topicId: { in: body.poolTopicIds } } : {}),
      },
    });
    if (poolSize < body.questionCount) {
      throw new ApiError(
        'VALIDATION',
        `The selected pool has ${poolSize} questions but the quiz needs ${body.questionCount}.`,
        { questionCount: ['Not enough questions in the selected pool'] },
      );
    }
  }

  // A fixed paper's size and worth are facts about the questions written, never
  // numbers the client gets to assert.
  const questionCount = fixed ? body.questions.length : body.questionCount;
  const totalMarks = fixed
    ? body.questions.reduce((sum, question) => sum + question.marks, 0)
    : 0;

  const quiz = await prisma.$transaction(async (tx) => {
    const created = await tx.quiz.create({
      data: {
        title: body.title,
        description: body.description || null,
        subjectId: body.subjectId,
        authorId: session.adminId,
        status: body.status,
        durationMinutes: body.durationMinutes,
        sourceMode: body.sourceMode,
        questionCount,
        totalMarks,
        poolTopicIds: fixed ? [] : body.poolTopicIds,
        easyPct: body.easyPct,
        mediumPct: body.mediumPct,
        hardPct: body.hardPct,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        ...body.security,
        negativeMarkingPct: body.negativeMarkingPct ?? null,
        multiPartialCredit: body.multiPartialCredit ?? null,
      },
    });

    if (fixed) {
      // Each question is a real Question row, so marking, results and the
      // grading queue treat it exactly like a bank question — `adHoc` only
      // keeps it out of the shared pool.
      for (const [position, input] of body.questions.entries()) {
        const question = await tx.question.create({
          data: {
            ...questionFieldsFromInput({ ...input, subjectId: body.subjectId }),
            subjectId: body.subjectId,
            authorId: session.adminId,
            adHoc: true,
            options: { create: questionOptionsFromInput({ ...input, subjectId: body.subjectId }) },
          },
        });

        await tx.quizQuestion.create({
          data: { quizId: created.id, questionId: question.id, position },
        });
      }
    }

    if (body.assignedStudentIds.length > 0) {
      await tx.quizAssignment.createMany({
        data: body.assignedStudentIds.map((studentId) => ({
          quizId: created.id,
          studentId,
        })),
        skipDuplicates: true,
      });
    }

    return created;
  });

  await audit({
    action: body.status === 'PUBLISHED' ? 'admin.quiz_published' : 'admin.quiz_created',
    userId: session.userId,
    entityType: 'Quiz',
    entityId: quiz.id,
    context,
    metadata: {
      title: quiz.title,
      assigned: body.assignedStudentIds.length,
      sourceMode: quiz.sourceMode,
      questionCount,
    },
  });

  return ok({ quizId: quiz.id, status: quiz.status });
});

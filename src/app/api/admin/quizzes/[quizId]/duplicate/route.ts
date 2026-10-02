import { ApiError, assertSameOrigin, ok, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ quizId: string }>;
}

/**
 * Copies a quiz into a new draft.
 *
 * This is the sanctioned way to correct a paper students have already sat:
 * the original stays exactly as it was answered, and the copy is free to edit.
 *
 * What is deliberately *not* copied:
 *  - attempts and their answers, which belong to the original sitting;
 *  - assignments, so a copy cannot quietly become visible to a cohort;
 *  - the published status — a copy always lands as a draft.
 *
 * A fixed paper's questions are copied as new rows rather than shared, so
 * editing the copy cannot reach back and alter what the original asked.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { quizId } = await params;

  enforceRateLimit(RATE_LIMITS.adminWrite, `quiz-duplicate:${session.userId}`);

  const source = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      questions: {
        orderBy: { position: 'asc' },
        include: { question: { include: { options: { orderBy: { position: 'asc' } } } } },
      },
    },
  });
  if (!source) throw new ApiError('NOT_FOUND', 'Quiz not found.');

  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.quiz.create({
      data: {
        title: `${source.title} (copy)`.slice(0, 120),
        description: source.description,
        subjectId: source.subjectId,
        authorId: session.adminId,
        status: 'DRAFT',
        durationMinutes: source.durationMinutes,
        sourceMode: source.sourceMode,
        questionCount: source.questionCount,
        totalMarks: source.totalMarks,
        poolTopicIds: source.poolTopicIds,
        easyPct: source.easyPct,
        mediumPct: source.mediumPct,
        hardPct: source.hardPct,
        startsAt: source.startsAt,
        endsAt: source.endsAt,
        randomizeQuestions: source.randomizeQuestions,
        randomizeOptions: source.randomizeOptions,
        singleAttempt: source.singleAttempt,
        requireFullscreen: source.requireFullscreen,
        detectTabSwitch: source.detectTabSwitch,
        blockCopyPaste: source.blockCopyPaste,
        bindDeviceSession: source.bindDeviceSession,
        cameraMonitoring: source.cameraMonitoring,
        microphoneMonitoring: source.microphoneMonitoring,
        maxFullscreenExits: source.maxFullscreenExits,
        lockQuestionNavigation: source.lockQuestionNavigation,
        blockMultipleDisplays: source.blockMultipleDisplays,
        requireScreenShare: source.requireScreenShare,
        releaseResults: source.releaseResults,
        releaseAnswers: source.releaseAnswers,
      },
    });

    for (const [position, link] of source.questions.entries()) {
      const original = link.question;
      // Images are referenced, not re-uploaded: the asset is immutable and
      // both questions may legitimately point at the same bytes. The sweep
      // that runs on delete checks every reference before removing anything.
      const cloned = await tx.question.create({
        data: {
          text: original.text,
          type: original.type,
          difficulty: original.difficulty,
          marks: original.marks,
          negativeMarks: original.negativeMarks,
          explanation: original.explanation,
          subjectId: original.subjectId,
          topicId: original.topicId,
          authorId: session.adminId,
          adHoc: true,
          assertionText: original.assertionText,
          reasonText: original.reasonText,
          partialCredit: original.partialCredit,
          acceptedAnswers: original.acceptedAnswers,
          caseSensitive: original.caseSensitive,
          numericTolerance: original.numericTolerance,
          maxWords: original.maxWords,
          maxAttachments: original.maxAttachments,
          modelAnswer: original.modelAnswer,
          imageAssetId: original.imageAssetId,
          options: {
            create: original.options.map((option) => ({
              text: option.text,
              isCorrect: option.isCorrect,
              position: option.position,
              imageAssetId: option.imageAssetId,
            })),
          },
        },
      });

      await tx.quizQuestion.create({
        data: { quizId: created.id, questionId: cloned.id, position },
      });
    }

    return created;
  });

  await audit({
    action: 'admin.quiz_created',
    userId: session.userId,
    entityType: 'Quiz',
    entityId: copy.id,
    context,
    metadata: { title: copy.title, duplicatedFrom: source.id, questions: source.questions.length },
  });

  return ok({ quizId: copy.id, title: copy.title });
});

import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { deleteUnreferencedAssets } from '@/lib/media';
import { questionFieldsFromInput, questionOptionsFromInput } from '@/lib/questions';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { replaceQuizQuestionsSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ quizId: string }>;
}

/**
 * Replaces the written paper of a FIXED-mode quiz.
 *
 * Editing stops the moment a single attempt exists, and the check is here
 * rather than in the UI because the consequences are not cosmetic:
 *
 *  - a student's recorded choice is a foreign key to a specific Option row, so
 *    deleting an option would blank out what they actually answered;
 *  - `score` and `maxScore` are computed at submission against the marks as
 *    they were, so changing marks afterwards leaves a stored total that no
 *    longer follows from the paper;
 *  - the database refuses outright to delete a question that has been served
 *    (`AttemptQuestion.question` is onDelete: Restrict), so a late edit would
 *    fail halfway through in any case.
 *
 * The whole set is replaced rather than diffed: with no attempts in existence
 * nothing references the old rows, and a wholesale swap cannot leave a
 * half-updated answer key behind.
 */
export const PUT = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  const { quizId } = await params;

  enforceRateLimit(RATE_LIMITS.adminWrite, `quiz-questions:${session.userId}`);

  const body = await parseBody(request, replaceQuizQuestionsSchema);

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: {
      id: true,
      title: true,
      subjectId: true,
      sourceMode: true,
      _count: { select: { attempts: true } },
      questions: {
        select: {
          questionId: true,
          // Gathered before the rows go, so their images can be swept after.
          question: {
            select: {
              imageAssetId: true,
              options: { select: { imageAssetId: true } },
            },
          },
        },
      },
    },
  });

  if (!quiz) throw new ApiError('NOT_FOUND', 'Quiz not found.');

  if (quiz.sourceMode !== 'FIXED') {
    throw new ApiError(
      'VALIDATION',
      'This quiz draws its questions from the bank, so it has no written paper to edit.',
    );
  }

  if (quiz._count.attempts > 0) {
    throw new ApiError(
      'CONFLICT',
      `${quiz._count.attempts} student${quiz._count.attempts === 1 ? ' has' : 's have'} already been served this paper, so its questions can no longer be changed. Duplicate the quiz instead if you need a corrected version.`,
    );
  }

  const previousIds = quiz.questions.map((link) => link.questionId);
  const previousAssetIds = quiz.questions.flatMap((link) => [
    link.question.imageAssetId,
    ...link.question.options.map((option) => option.imageAssetId),
  ]);

  const updated = await prisma.$transaction(async (tx) => {
    // Links first, then the questions themselves; options cascade with them.
    await tx.quizQuestion.deleteMany({ where: { quizId: quiz.id } });
    await tx.question.deleteMany({ where: { id: { in: previousIds }, adHoc: true } });

    for (const [position, input] of body.questions.entries()) {
      const withSubject = { ...input, subjectId: quiz.subjectId };
      const question = await tx.question.create({
        data: {
          ...questionFieldsFromInput(withSubject),
          subjectId: quiz.subjectId,
          authorId: session.adminId,
          adHoc: true,
          options: { create: questionOptionsFromInput(withSubject) },
        },
      });
      await tx.quizQuestion.create({
        data: { quizId: quiz.id, questionId: question.id, position },
      });
    }

    return tx.quiz.update({
      where: { id: quiz.id },
      data: {
        questionCount: body.questions.length,
        totalMarks: body.questions.reduce((sum, question) => sum + question.marks, 0),
      },
      select: { questionCount: true, totalMarks: true },
    });
  });

  // After the transaction: an image the rewritten paper no longer uses has
  // nothing left that could authorise reading it, so it should not linger.
  // A re-used image is detected and kept by the sweep itself.
  const sweptAssets = await deleteUnreferencedAssets(previousAssetIds);

  await audit({
    action: 'admin.quiz_updated',
    userId: session.userId,
    entityType: 'Quiz',
    entityId: quiz.id,
    context,
    metadata: {
      title: quiz.title,
      change: 'questions_replaced',
      from: previousIds.length,
      to: updated.questionCount,
      imagesRemoved: sweptAssets,
    },
  });

  return ok({ questionCount: updated.questionCount, totalMarks: updated.totalMarks });
});

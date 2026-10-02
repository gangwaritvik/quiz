import { ok, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  MIN_ATTEMPTS_FOR_DISCRIMINATION,
  analyseItems,
  type ItemQuestion,
  type ItemResponse,
} from '@/lib/item-analysis';
import { assertQuizOwner } from '@/lib/ownership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ quizId: string }>;
}

/** A hard ceiling so one enormous quiz cannot hold a request open. */
const MAX_ATTEMPTS = 2000;

/**
 * How each question of a quiz behaved: facility, discrimination and which wrong
 * options attracted students. Only submitted attempts count, and only for the
 * quiz's author.
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const session = await requireAdmin();
  const { quizId } = await params;
  await assertQuizOwner(quizId, session.adminId);

  const attempts = await prisma.quizAttempt.findMany({
    where: { quizId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
    orderBy: { submittedAt: 'asc' },
    take: MAX_ATTEMPTS,
    select: {
      id: true,
      score: true,
      questions: {
        select: {
          marks: true,
          questionId: true,
          position: true,
          question: {
            select: {
              id: true,
              text: true,
              type: true,
              options: {
                orderBy: { position: 'asc' },
                select: { id: true, text: true, isCorrect: true },
              },
            },
          },
          answers: {
            select: {
              awardedMarks: true,
              selectedOptionId: true,
              textResponse: true,
              selectedOptions: { select: { optionId: true } },
              _count: { select: { attachments: true } },
            },
          },
        },
      },
    },
  });

  const questions = new Map<string, ItemQuestion & { position: number }>();
  const responses: ItemResponse[] = [];

  for (const attempt of attempts) {
    for (const aq of attempt.questions) {
      if (!questions.has(aq.questionId)) {
        questions.set(aq.questionId, {
          id: aq.question.id,
          text: aq.question.text,
          type: aq.question.type,
          options: aq.question.options,
          position: aq.position,
        });
      }

      const answer = aq.answers[0];
      const selected = answer
        ? [
            ...(answer.selectedOptionId ? [answer.selectedOptionId] : []),
            ...answer.selectedOptions.map((s) => s.optionId),
          ]
        : [];
      const answered =
        Boolean(answer) &&
        (selected.length > 0 ||
          Boolean(answer?.textResponse?.trim()) ||
          (answer?._count.attachments ?? 0) > 0);

      responses.push({
        attemptId: attempt.id,
        attemptScore: attempt.score ?? 0,
        questionId: aq.questionId,
        marks: aq.marks,
        answered,
        // No answer row at all means nothing to mark: it earned nothing.
        awardedMarks: answer ? answer.awardedMarks : 0,
        selectedOptionIds: selected,
      });
    }
  }

  const ordered = [...questions.values()].sort((a, b) => a.position - b.position);
  const stats = analyseItems(ordered, responses);

  return ok({
    attempts: attempts.length,
    truncated: attempts.length === MAX_ATTEMPTS,
    minAttemptsForDiscrimination: MIN_ATTEMPTS_FOR_DISCRIMINATION,
    questions: stats,
  });
});

import 'server-only';

import { ApiError } from '@/lib/api';
import { prisma } from '@/lib/db';

/**
 * Faculty ownership: an admin sees and acts on only the quizzes they authored
 * (Quiz.authorId === Admin.id) and the attempts/answers of those quizzes.
 * Every check is one query; 404 when the row is missing, 403 when not owned.
 */
export function ownQuizWhere(adminId: string) {
  return { authorId: adminId };
}

/** Where fragment for QuizAttempt (and anything filtered through `attempt`). */
export function ownAttemptWhere(adminId: string) {
  return { quiz: { authorId: adminId } };
}

function check(authorId: string | null | undefined, adminId: string, what: string) {
  if (authorId === undefined) throw new ApiError('NOT_FOUND', `That ${what} no longer exists.`);
  if (authorId !== adminId) {
    throw new ApiError('FORBIDDEN', `That ${what} belongs to another faculty member.`);
  }
}

export async function assertQuizOwner(quizId: string, adminId: string) {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { authorId: true } });
  check(quiz ? quiz.authorId : undefined, adminId, 'quiz');
}

export async function assertAttemptOwner(attemptId: string, adminId: string) {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: { quiz: { select: { authorId: true } } },
  });
  check(attempt ? attempt.quiz.authorId : undefined, adminId, 'attempt');
}

export async function assertAppealOwner(appealId: string, adminId: string) {
  const appeal = await prisma.resultAppeal.findUnique({
    where: { id: appealId },
    select: { attempt: { select: { quiz: { select: { authorId: true } } } } },
  });
  check(appeal ? appeal.attempt.quiz.authorId : undefined, adminId, 'appeal');
}

export async function assertAnswerOwner(answerId: string, adminId: string) {
  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    select: { attempt: { select: { quiz: { select: { authorId: true } } } } },
  });
  check(answer ? answer.attempt.quiz.authorId : undefined, adminId, 'answer');
}

import 'server-only';

import { randomInt } from 'node:crypto';

import { Prisma } from '@prisma/client';
import type { AttemptStatus, Difficulty, QuestionType, Quiz } from '@prisma/client';

import { ApiError } from '@/lib/api';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import {
  FIXED_OPTION_ORDER_TYPES,
  effectiveMarking,
  gradeAnswer,
  hasResponse,
  OPTION_TYPES,
  type GradableQuestion,
} from '@/lib/grading';
import { recomputeIntegrityScore } from '@/lib/integrity';
import { canStartAnother } from '@/lib/attempt-policy';
import { shouldApply } from '@/lib/offline-queue';
import {
  MAX_PAUSE_MS,
  computeExpiresAt,
  effectiveEndsAt,
  pauseAdjustedExpiresAt,
} from '@/lib/time-extension';

/**
 * The exam engine. Everything that decides *what a student sees* and *what a
 * student scores* lives here and runs on the server:
 *
 *  - question selection and shuffling
 *  - the authoritative clock
 *  - grading against `Option.isCorrect`
 *
 * Nothing in this module ever serialises `isCorrect` into a student payload.
 */

/** Fisher–Yates using a CSPRNG so orders are not predictable from a seed. */
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * Grace period after `expiresAt` during which a late submit is still accepted,
 * and during which answers the student made before the buzzer may still arrive.
 * A student whose connection dropped near the end sends their queued answers
 * the moment it returns; without this they would be refused even though the
 * screen told them their work was safe. The client's own paper is locked at
 * zero, so the window only helps answers that were already written.
 */
export const SUBMIT_GRACE_MS = 60_000;

/** Explicit limits for interactive transactions on hot exam paths. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

/**
 * Scores are visible only once faculty released them AND the exam is over for
 * everyone — the window has closed and so has the longest time extension
 * granted on it. Otherwise an early finisher could relay answers to a student
 * still sitting the paper. Correct answers additionally need `releaseAnswers`.
 */
export function resultsVisibility(
  quiz: Pick<Quiz, 'releaseResults' | 'releaseAnswers' | 'endsAt' | 'maxExtensionMinutes'>,
  now = new Date(),
) {
  const windowClosed = now >= effectiveEndsAt(quiz);
  const results = quiz.releaseResults && windowClosed;
  return { results, answers: results && quiz.releaseAnswers, windowClosed };
}

export interface RemainingTime {
  remainingMs: number;
  expiresAt: Date;
  serverNow: Date;
  expired: boolean;
}

/** The single source of truth for "how much time is left". */
export function remainingTime(expiresAt: Date): RemainingTime {
  const serverNow = new Date();
  const remainingMs = expiresAt.getTime() - serverNow.getTime();
  return {
    remainingMs: Math.max(0, remainingMs),
    expiresAt,
    serverNow,
    expired: remainingMs <= 0,
  };
}

// ---------------------------------------------------------------------------
// Question selection
// ---------------------------------------------------------------------------

interface PoolQuestion {
  id: string;
  difficulty: Difficulty;
  marks: number;
}

/**
 * Splits `total` across easy/medium/hard using the quiz's configured
 * percentages, then backfills from the remaining pool when a bucket is short —
 * a quiz must never silently produce fewer questions than promised.
 */
export function distributeByDifficulty<T extends PoolQuestion>(
  pool: T[],
  total: number,
  mix: { easyPct: number; mediumPct: number; hardPct: number },
): T[] {
  const byDifficulty: Record<Difficulty, T[]> = {
    EASY: shuffle(pool.filter((q) => q.difficulty === 'EASY')),
    MEDIUM: shuffle(pool.filter((q) => q.difficulty === 'MEDIUM')),
    HARD: shuffle(pool.filter((q) => q.difficulty === 'HARD')),
  };

  const targets: Array<[Difficulty, number]> = [
    ['EASY', Math.round((total * mix.easyPct) / 100)],
    ['MEDIUM', Math.round((total * mix.mediumPct) / 100)],
    ['HARD', Math.round((total * mix.hardPct) / 100)],
  ];

  const picked: T[] = [];
  const takenIds = new Set<string>();

  for (const [difficulty, target] of targets) {
    for (const question of byDifficulty[difficulty].slice(0, Math.max(0, target))) {
      if (picked.length >= total) break;
      picked.push(question);
      takenIds.add(question.id);
    }
  }

  if (picked.length < total) {
    const leftovers = shuffle(pool.filter((q) => !takenIds.has(q.id)));
    for (const question of leftovers) {
      if (picked.length >= total) break;
      picked.push(question);
      takenIds.add(question.id);
    }
  }

  return picked.slice(0, total);
}

const PAPER_QUESTION_SELECT = {
  id: true,
  type: true,
  difficulty: true,
  marks: true,
  options: { select: { id: true }, orderBy: { position: 'asc' as const } },
} as const;

/**
 * The fixed paper: exactly the questions written for this quiz, in the order
 * they were written. There is no pool to sample, so nothing is selected here —
 * only ordered.
 */
async function fixedPaperQuestions(quiz: Quiz) {
  const links = await prisma.quizQuestion.findMany({
    where: { quizId: quiz.id, question: { active: true } },
    orderBy: { position: 'asc' },
    select: { question: { select: PAPER_QUESTION_SELECT } },
  });

  const questions = links.map((link) => link.question);
  if (questions.length === 0) {
    throw new ApiError(
      'QUIZ_UNAVAILABLE',
      'This quiz has no questions yet. Please contact your faculty.',
    );
  }
  return questions;
}

async function buildQuestionPaper(quiz: Quiz) {
  let pool: Array<{
    id: string;
    type: QuestionType;
    difficulty: Difficulty;
    marks: number;
    options: Array<{ id: string }>;
  }>;
  let selected: typeof pool;

  if (quiz.sourceMode === 'FIXED') {
    pool = await fixedPaperQuestions(quiz);
    selected = pool;
  } else {
    const where: Prisma.QuestionWhereInput = {
      active: true,
      subjectId: quiz.subjectId,
      // Questions written inline for one quiz are not part of the shared bank.
      adHoc: false,
      ...(quiz.poolTopicIds.length > 0 ? { topicId: { in: quiz.poolTopicIds } } : {}),
    };

    pool = await prisma.question.findMany({ where, select: PAPER_QUESTION_SELECT });

    if (pool.length < quiz.questionCount) {
      throw new ApiError(
        'QUIZ_UNAVAILABLE',
        `This quiz needs ${quiz.questionCount} questions but only ${pool.length} are available in its pool. Please contact your faculty.`,
      );
    }

    selected = distributeByDifficulty(pool, quiz.questionCount, quiz);
  }

  const ordered = quiz.randomizeQuestions ? shuffle(selected) : selected;
  const optionsById = new Map(pool.map((q) => [q.id, q.options.map((o) => o.id)]));
  const typeById = new Map(pool.map((q) => [q.id, q.type]));

  return ordered.map((question, index) => {
    const optionIds = optionsById.get(question.id) ?? [];
    // Assertion–reason and true/false carry a prescribed option order that
    // students are taught to rely on, so they are never shuffled.
    const fixedOrder = FIXED_OPTION_ORDER_TYPES.has(typeById.get(question.id)!);
    return {
      questionId: question.id,
      position: index,
      marks: question.marks,
      optionOrder: quiz.randomizeOptions && !fixedOrder ? shuffle(optionIds) : optionIds,
    };
  });
}

// ---------------------------------------------------------------------------
// Attempt lifecycle
// ---------------------------------------------------------------------------

export interface StartAttemptInput {
  quizId: string;
  studentId: string;
  sessionId: string;
  deviceHash: string;
  ipHash: string;
}

/**
 * Creates an attempt after checking, server-side and in this order:
 *   assignment -> publication -> exam window -> attempt policy.
 * The quiz id arriving from the client is never trusted beyond being a lookup key.
 */
export async function startAttempt(input: StartAttemptInput) {
  const quiz = await prisma.quiz.findUnique({ where: { id: input.quizId } });
  if (!quiz) throw new ApiError('NOT_FOUND', 'Quiz not found.');

  const assignment = await prisma.quizAssignment.findUnique({
    where: { quizId_studentId: { quizId: quiz.id, studentId: input.studentId } },
  });
  if (!assignment) {
    // Same message as "not found" would leak less, but the student genuinely
    // needs to know to contact faculty, so we are explicit without revealing
    // anything about the quiz itself.
    throw new ApiError('QUIZ_UNAVAILABLE', 'This quiz has not been assigned to you.');
  }

  if (quiz.status !== 'PUBLISHED') {
    throw new ApiError('QUIZ_UNAVAILABLE', 'This quiz is not currently open.');
  }

  const now = new Date();
  if (now < quiz.startsAt) {
    throw new ApiError('QUIZ_UNAVAILABLE', 'This quiz has not started yet.');
  }

  const existing = await prisma.quizAttempt.findMany({
    where: { quizId: quiz.id, studentId: input.studentId },
    orderBy: { attemptNumber: 'desc' },
  });

  // Resume an in-progress attempt instead of creating a second one. This sits
  // before the window check: a student on extra time may reconnect after the
  // window has closed, and their own clock decides whether they can continue.
  const live = existing.find((a) => a.status === 'IN_PROGRESS');
  if (live) {
    if (remainingTime(pauseAdjustedExpiresAt(live.expiresAt, live.pausedAt)).expired) {
      await finalizeAttempt(live.id, 'AUTO_SUBMITTED');
      throw new ApiError('ATTEMPT_EXPIRED', 'Your previous attempt expired and was submitted.');
    }
    return { attempt: live, resumed: true, quiz };
  }

  if (now > quiz.endsAt) {
    throw new ApiError('QUIZ_UNAVAILABLE', 'The window for this quiz has closed.');
  }

  if (!canStartAnother(quiz, assignment.extraAttempts, existing.length)) {
    throw new ApiError(
      'CONFLICT',
      assignment.extraAttempts > 0
        ? 'You have used all the attempts you were given for this quiz.'
        : 'You have already attempted this quiz. Only one attempt is permitted.',
    );
  }

  const paper = await buildQuestionPaper(quiz);

  // The exam window is anchored to the server clock at creation time and is
  // never extended by anything the client sends afterwards.
  const expiresAt = computeExpiresAt(now, quiz, assignment.extraMinutes);

  let attempt;
  try {
    attempt = await prisma.$transaction(async (tx) => {
      const created = await tx.quizAttempt.create({
        data: {
          quizId: quiz.id,
          studentId: input.studentId,
          sessionId: input.sessionId,
          attemptNumber: (existing[0]?.attemptNumber ?? 0) + 1,
          startedAt: now,
          expiresAt,
          extraMinutes: assignment.extraMinutes,
          deviceHash: input.deviceHash,
          ipHash: input.ipHash,
          maxScore: paper.reduce((sum, q) => sum + q.marks, 0),
        },
      });

      await tx.attemptQuestion.createMany({
        data: paper.map((q) => ({ ...q, attemptId: created.id })),
      });

      await tx.examEvent.create({
        data: { attemptId: created.id, type: 'ATTEMPT_STARTED', severity: 'INFO' },
      });

      return created;
    }, TX_OPTIONS);
  } catch (error) {
    // A double-click or second tab raced us to the same attemptNumber: the
    // other request created the attempt, so resume it instead of failing.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await prisma.quizAttempt.findFirst({
        where: { quizId: quiz.id, studentId: input.studentId, status: 'IN_PROGRESS' },
      });
      if (winner) return { attempt: winner, resumed: true, quiz };
    }
    throw error;
  }

  // Statistics only, and outside the transaction so concurrent starts do not
  // serialise on the same Question rows.
  void prisma.question
    .updateMany({
      where: { id: { in: paper.map((q) => q.questionId) } },
      data: { usageCount: { increment: 1 } },
    })
    .catch((error) => console.error('[exam] failed to bump question usage', error));

  await recomputeIntegrityScore(attempt.id);
  return { attempt, resumed: false, quiz };
}

/** Student-visible shape of one question — correct answers are absent by construction. */
export interface SafeQuestion {
  attemptQuestionId: string;
  position: number;
  text: string;
  type: QuestionType;
  marks: number;
  topic: string | null;
  /** Assertion–reason stems. Null for every other type. */
  assertionText: string | null;
  reasonText: string | null;
  /** Diagram accompanying the question, if any. */
  imageUrl: string | null;
  options: Array<{ id: string; text: string; imageUrl: string | null }>;
  /** Guidance for written answers; not enforced as a hard limit. */
  maxWords: number | null;
  maxAttachments: number;
  selectedOptionId: string | null;
  selectedOptionIds: string[];
  textResponse: string | null;
  attachments: Array<{ id: string; url: string; name: string }>;
  markedForReview: boolean;
  /**
   * Whether this question counts as answered. Computed here rather than
   * inferred by the client, because "answered" now means different things for
   * different types — an option, a set of options, typed text, or an upload.
   */
  answered: boolean;
}

/**
 * Loads the attempt paper for a student.
 *
 * The `select` clauses here are load-bearing security: `Option.isCorrect` and
 * `Question.explanation` are never read into this payload.
 */
export async function getAttemptPaper(attemptId: string, studentId: string) {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    include: {
      quiz: { include: { subject: true } },
      questions: {
        orderBy: { position: 'asc' },
        include: {
          question: {
            // Load-bearing: `isCorrect`, `explanation`, `acceptedAnswers` and
            // `modelAnswer` are all answer-key material and are absent here by
            // construction rather than filtered out afterwards.
            select: {
              id: true,
              text: true,
              type: true,
              marks: true,
              assertionText: true,
              reasonText: true,
              maxWords: true,
              maxAttachments: true,
              imageAssetId: true,
              topic: { select: { name: true } },
              options: { select: { id: true, text: true, imageAssetId: true } },
            },
          },
          answers: {
            select: {
              selectedOptionId: true,
              textResponse: true,
              markedForReview: true,
              selectedOptions: { select: { optionId: true } },
              attachments: {
                orderBy: { position: 'asc' },
                select: {
                  id: true,
                  asset: { select: { id: true, originalName: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!attempt) throw new ApiError('NOT_FOUND', 'Attempt not found.');
  // IDOR guard: an attempt id alone is never sufficient authorisation.
  if (attempt.studentId !== studentId) {
    throw new ApiError('FORBIDDEN', 'This attempt does not belong to you.');
  }

  const questions: SafeQuestion[] = attempt.questions.map((aq) => {
    const optionById = new Map(aq.question.options.map((o) => [o.id, o]));
    const ordered = aq.optionOrder.length
      ? aq.optionOrder.map((id) => optionById.get(id)).filter(Boolean)
      : aq.question.options;
    const answer = aq.answers[0];

    const selectedOptionIds = answer?.selectedOptions.map((s) => s.optionId) ?? [];
    const attachments =
      answer?.attachments.map((attachment) => ({
        id: attachment.id,
        url: `/api/media/${attachment.asset.id}`,
        name: attachment.asset.originalName,
      })) ?? [];

    return {
      attemptQuestionId: aq.id,
      position: aq.position,
      text: aq.question.text,
      type: aq.question.type,
      marks: aq.marks,
      topic: aq.question.topic?.name ?? null,
      assertionText: aq.question.assertionText,
      reasonText: aq.question.reasonText,
      imageUrl: aq.question.imageAssetId ? `/api/media/${aq.question.imageAssetId}` : null,
      options: (ordered as Array<{ id: string; text: string; imageAssetId: string | null }>).map(
        (o) => ({
          id: o.id,
          text: o.text,
          imageUrl: o.imageAssetId ? `/api/media/${o.imageAssetId}` : null,
        }),
      ),
      maxWords: aq.question.maxWords,
      maxAttachments: aq.question.maxAttachments,
      selectedOptionId: answer?.selectedOptionId ?? null,
      selectedOptionIds,
      textResponse: answer?.textResponse ?? null,
      attachments,
      markedForReview: answer?.markedForReview ?? false,
      answered: hasResponse(aq.question.type, {
        selectedOptionId: answer?.selectedOptionId ?? null,
        selectedOptionIds,
        textResponse: answer?.textResponse ?? null,
        attachmentCount: attachments.length,
      }),
    };
  });

  return { attempt, questions };
}

export const MAX_SHORT_ANSWER_CHARS = 500;
export const MAX_LONG_ANSWER_CHARS = 20_000;

export interface SaveAnswerInput {
  attemptId: string;
  studentId: string;
  attemptQuestionId: string;
  /** Single-choice types. */
  selectedOptionId?: string | null;
  /** Multi-select. */
  selectedOptionIds?: string[];
  /** Written types. */
  textResponse?: string | null;
  markedForReview?: boolean;
  /** Offline-queue sequence; a write no newer than the stored one is ignored. */
  clientSeq?: number;
}

/**
 * Loads an attempt that is open for writing, or refuses.
 *
 * Shared by every answer mutation so the ownership, status and deadline checks
 * cannot drift apart between saving an option, saving text, and attaching a file.
 */
/** Writes are refused while faculty have the attempt paused; the client keeps the answer and retries. */
function pausedError() {
  return new ApiError('PAUSED', 'Your exam is paused by your faculty. Your answer is kept and will be saved when it resumes.');
}

async function loadWritableAttempt(attemptId: string, studentId: string) {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true, studentId: true, status: true, expiresAt: true, pausedAt: true },
  });

  if (!attempt) throw new ApiError('NOT_FOUND', 'Attempt not found.');
  if (attempt.studentId !== studentId) {
    throw new ApiError('FORBIDDEN', 'This attempt does not belong to you.');
  }
  if (attempt.status !== 'IN_PROGRESS') {
    throw new ApiError('ATTEMPT_EXPIRED', 'This attempt has already been submitted.');
  }
  if (attempt.pausedAt) throw pausedError();
  if (remainingTime(attempt.expiresAt).remainingMs <= -SUBMIT_GRACE_MS) {
    await finalizeAttempt(attempt.id, 'AUTO_SUBMITTED');
    throw new ApiError('ATTEMPT_EXPIRED', 'Time is up — your exam has been submitted.');
  }

  return attempt;
}

/**
 * Re-checks, inside the writing transaction, that the attempt is still open.
 * The conditional UPDATE row-locks the attempt until commit, so a concurrent
 * finalize either waits for this write (and grades it) or has already claimed
 * the attempt, in which case this matches nothing and the write is refused.
 */
async function lockWritableAttempt(tx: Prisma.TransactionClient, attemptId: string) {
  const now = new Date();
  const { count } = await tx.quizAttempt.updateMany({
    where: {
      id: attemptId,
      status: 'IN_PROGRESS',
      expiresAt: { gt: new Date(now.getTime() - SUBMIT_GRACE_MS) },
      pausedAt: null,
    },
    data: { lastSeenAt: now },
  });
  if (count !== 1) {
    // Paused after the earlier check, or really over? The client reacts very
    // differently (wait, versus submit), so say which.
    const current = await tx.quizAttempt.findUnique({
      where: { id: attemptId },
      select: { status: true, pausedAt: true },
    });
    if (current?.status === 'IN_PROGRESS' && current.pausedAt) throw pausedError();
    throw new ApiError('ATTEMPT_EXPIRED', 'This attempt has already been submitted.');
  }
}

/** Resolves a question on this attempt, refusing ids from any other paper. */
async function loadAttemptQuestion(attemptQuestionId: string, attemptId: string) {
  const attemptQuestion = await prisma.attemptQuestion.findUnique({
    where: { id: attemptQuestionId },
    select: {
      id: true,
      attemptId: true,
      questionId: true,
      question: {
        select: {
          type: true,
          maxAttachments: true,
          options: { select: { id: true } },
        },
      },
    },
  });

  if (!attemptQuestion || attemptQuestion.attemptId !== attemptId) {
    throw new ApiError('FORBIDDEN', 'That question is not part of this attempt.');
  }
  return attemptQuestion;
}

/**
 * Persists one answer.
 *
 * The response shape is checked against the question's own type, so a client
 * cannot, say, post an option id for a descriptive question and have it stored
 * as if it were a choice. Option ids are verified to belong to this question,
 * so a crafted id from another paper is rejected.
 */
export async function saveAnswer(params: SaveAnswerInput) {
  const attempt = await loadWritableAttempt(params.attemptId, params.studentId);
  const attemptQuestion = await loadAttemptQuestion(params.attemptQuestionId, attempt.id);
  const type = attemptQuestion.question.type;
  const validOptionIds = new Set(attemptQuestion.question.options.map((o) => o.id));

  let selectedOptionId: string | null | undefined;
  let selectedOptionIds: string[] | undefined;
  let textResponse: string | null | undefined;

  if (type === 'MCQ_MULTI') {
    if (params.selectedOptionIds !== undefined) {
      // Deduplicate before validating so a repeated id cannot inflate the count.
      const unique = [...new Set(params.selectedOptionIds)];
      for (const id of unique) {
        if (!validOptionIds.has(id)) {
          throw new ApiError('VALIDATION', 'That option does not belong to this question.');
        }
      }
      selectedOptionIds = unique;
    }
  } else if (OPTION_TYPES.has(type)) {
    if (params.selectedOptionId !== undefined) {
      if (params.selectedOptionId !== null && !validOptionIds.has(params.selectedOptionId)) {
        throw new ApiError('VALIDATION', 'That option does not belong to this question.');
      }
      selectedOptionId = params.selectedOptionId;
    }
  }

  if (type === 'SHORT_ANSWER' || type === 'LONG_ANSWER') {
    if (params.textResponse !== undefined) {
      const limit = type === 'SHORT_ANSWER' ? MAX_SHORT_ANSWER_CHARS : MAX_LONG_ANSWER_CHARS;
      const value = (params.textResponse ?? '').slice(0, limit);
      textResponse = value.trim().length === 0 ? null : value;
    }
  }

  // IMAGE_ANSWER carries no inline response — its content arrives through the
  // attachment endpoint — but marking it for review must still work.
  const nothingToWrite =
    selectedOptionId === undefined &&
    selectedOptionIds === undefined &&
    textResponse === undefined &&
    params.markedForReview === undefined;

  if (nothingToWrite) {
    throw new ApiError('VALIDATION', 'No answer content was supplied for this question.');
  }

  const answer = await prisma.$transaction(async (tx) => {
    await lockWritableAttempt(tx, attempt.id);

    const select = {
      id: true,
      selectedOptionId: true,
      textResponse: true,
      markedForReview: true,
    } as const;

    // A queued save replayed after a newer edit already landed is acknowledged
    // but not applied. The attempt row lock above serialises this check.
    const existing = await tx.answer.findUnique({
      where: { attemptQuestionId: attemptQuestion.id },
      select: { ...select, clientSeq: true },
    });
    if (existing && !shouldApply(existing.clientSeq, params.clientSeq)) {
      selectedOptionIds = undefined;
      return existing;
    }

    const saved = await tx.answer.upsert({
      where: { attemptQuestionId: attemptQuestion.id },
      create: {
        attemptId: attempt.id,
        attemptQuestionId: attemptQuestion.id,
        selectedOptionId: selectedOptionId ?? null,
        textResponse: textResponse ?? null,
        markedForReview: params.markedForReview ?? false,
        ...(params.clientSeq === undefined ? {} : { clientSeq: BigInt(params.clientSeq) }),
      },
      update: {
        ...(selectedOptionId === undefined ? {} : { selectedOptionId }),
        ...(textResponse === undefined ? {} : { textResponse }),
        ...(params.markedForReview === undefined
          ? {}
          : { markedForReview: params.markedForReview }),
        ...(params.clientSeq === undefined ? {} : { clientSeq: BigInt(params.clientSeq) }),
      },
      select,
    });

    if (selectedOptionIds !== undefined) {
      // Replace wholesale: the client sends the full selection, so reconciling
      // deltas would only add a way for the two to disagree.
      await tx.answerOption.deleteMany({ where: { answerId: saved.id } });
      if (selectedOptionIds.length > 0) {
        await tx.answerOption.createMany({
          data: selectedOptionIds.map((optionId) => ({ answerId: saved.id, optionId })),
        });
      }
    }

    return saved;
  }, TX_OPTIONS);

  return {
    ...answer,
    selectedOptionIds:
      selectedOptionIds ??
      (await prisma.answerOption.findMany({
        where: { answerId: answer.id },
        select: { optionId: true },
      })).map((row) => row.optionId),
  };
}

// ---------------------------------------------------------------------------
// Answer attachments
// ---------------------------------------------------------------------------

/**
 * Links an already-stored upload to an image answer.
 *
 * Storage happens in `lib/media.ts`; this function owns only the exam-side
 * rules — that the question accepts uploads, that the attempt is still open,
 * and that the per-question limit is respected.
 */
export async function attachAnswerImage(params: {
  attemptId: string;
  studentId: string;
  attemptQuestionId: string;
  assetId: string;
}) {
  const attempt = await loadWritableAttempt(params.attemptId, params.studentId);
  const attemptQuestion = await loadAttemptQuestion(params.attemptQuestionId, attempt.id);

  if (attemptQuestion.question.type !== 'IMAGE_ANSWER') {
    throw new ApiError('VALIDATION', 'This question does not accept file uploads.');
  }

  return prisma.$transaction(async (tx) => {
    await lockWritableAttempt(tx, attempt.id);

    const answer = await tx.answer.upsert({
      where: { attemptQuestionId: attemptQuestion.id },
      create: { attemptId: attempt.id, attemptQuestionId: attemptQuestion.id },
      update: {},
      select: { id: true, _count: { select: { attachments: true } } },
    });

    const limit = attemptQuestion.question.maxAttachments;
    if (answer._count.attachments >= limit) {
      throw new ApiError(
        'VALIDATION',
        `You may attach at most ${limit} image${limit === 1 ? '' : 's'} to this question.`,
      );
    }

    const attachment = await tx.answerAttachment.create({
      data: {
        answerId: answer.id,
        assetId: params.assetId,
        position: answer._count.attachments,
      },
      select: { id: true, asset: { select: { id: true, originalName: true } } },
    });

    return attachment;
  }, TX_OPTIONS);
}

/** Removes one attachment from a student's own in-progress answer. */
export async function detachAnswerImage(params: {
  attemptId: string;
  studentId: string;
  attachmentId: string;
}) {
  const attempt = await loadWritableAttempt(params.attemptId, params.studentId);

  const attachment = await prisma.answerAttachment.findUnique({
    where: { id: params.attachmentId },
    select: { id: true, assetId: true, answer: { select: { attemptId: true } } },
  });

  if (!attachment || attachment.answer.attemptId !== attempt.id) {
    throw new ApiError('FORBIDDEN', 'That attachment does not belong to this attempt.');
  }

  await prisma.$transaction(async (tx) => {
    await lockWritableAttempt(tx, attempt.id);
    await tx.answerAttachment.delete({ where: { id: attachment.id } });
  }, TX_OPTIONS);
  return { assetId: attachment.assetId };
}

/**
 * Recomputes an attempt's totals from its stored answers.
 *
 * The single place attempt-level figures are derived, so a score reached by
 * automatic marking and one reached after a human marks a descriptive answer
 * are always computed the same way.
 */
export async function recomputeAttemptTotals(attemptId: string) {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      questions: {
        select: {
          marks: true,
          question: { select: { type: true } },
          answers: {
            select: {
              awardedMarks: true,
              isCorrect: true,
              selectedOptionId: true,
              textResponse: true,
              requiresManualGrading: true,
              gradedAt: true,
              _count: { select: { attachments: true, selectedOptions: true } },
            },
          },
        },
      },
    },
  });

  if (!attempt) throw new ApiError('NOT_FOUND', 'Attempt not found.');

  let score = 0;
  let maxScore = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;
  let pendingManualCount = 0;

  for (const aq of attempt.questions) {
    maxScore += aq.marks;
    const answer = aq.answers[0];

    if (!answer) {
      unansweredCount += 1;
      continue;
    }

    const answered = hasResponse(aq.question.type, {
      selectedOptionId: answer.selectedOptionId,
      selectedOptionIds: new Array<string>(answer._count.selectedOptions),
      textResponse: answer.textResponse,
      attachmentCount: answer._count.attachments,
    });

    if (!answered) {
      unansweredCount += 1;
      continue;
    }

    if (answer.requiresManualGrading && answer.gradedAt === null) {
      pendingManualCount += 1;
      continue; // contributes nothing until a person marks it
    }

    score += answer.awardedMarks ?? 0;
    if (answer.isCorrect === true) correctCount += 1;
    else if (answer.isCorrect === false) incorrectCount += 1;
  }

  score = Math.max(0, score); // negative marking never drives a total below zero
  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0;

  return prisma.quizAttempt.update({
    where: { id: attempt.id },
    data: {
      score,
      maxScore,
      percentage,
      correctCount,
      incorrectCount,
      unansweredCount,
      pendingManualCount,
    },
    include: { quiz: true },
  });
}

/**
 * Grades and closes an attempt. Idempotent: a second call on an already
 * submitted attempt returns the stored result rather than re-grading.
 *
 * Descriptive and image answers cannot be marked here. They are flagged for
 * manual grading and contribute nothing to the score until faculty marks them,
 * which leaves the attempt's total explicitly *provisional* rather than
 * quietly wrong.
 */
export async function finalizeAttempt(attemptId: string, status: AttemptStatus = 'SUBMITTED') {
  // Claim first. Only the caller whose conditional update matches grades the
  // attempt; every concurrent finalize (sweeps on read paths, a retried
  // submit) sees count 0 and returns the stored result. The UPDATE also waits
  // on any in-flight answer save holding the row lock, so grading below reads
  // every committed answer and no later save can land.
  const claim = await prisma.quizAttempt.updateMany({
    where: { id: attemptId, status: 'IN_PROGRESS' },
    data: { status, submittedAt: new Date() },
  });

  if (claim.count !== 1) {
    const stored = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: { quiz: true },
    });
    if (!stored) throw new ApiError('NOT_FOUND', 'Attempt not found.');
    return stored;
  }

  try {
    await gradeClaimedAttempt(attemptId, status);
  } catch (error) {
    // Hand the attempt back so a retry or the expiry sweep can grade it,
    // rather than leaving it submitted with no marks.
    await prisma.quizAttempt
      .updateMany({
        where: { id: attemptId, status },
        data: { status: 'IN_PROGRESS', submittedAt: null },
      })
      .catch(() => undefined);
    throw error;
  }

  // Totals and integrity are pure recomputations from stored rows, safe to rerun.
  const updated = await recomputeAttemptTotals(attemptId);
  await recomputeIntegrityScore(attemptId);
  return updated;
}

/** Grades the answers of an attempt this caller has just claimed. */
async function gradeClaimedAttempt(attemptId: string, status: AttemptStatus) {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    include: {
      quiz: { select: { negativeMarkingPct: true, multiPartialCredit: true } },
      questions: {
        include: {
          question: {
            select: {
              type: true,
              negativeMarks: true,
              partialCredit: true,
              acceptedAnswers: true,
              caseSensitive: true,
              numericTolerance: true,
              options: { select: { id: true, isCorrect: true } },
            },
          },
          answers: {
            select: {
              id: true,
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

  if (!attempt) throw new ApiError('NOT_FOUND', 'Attempt not found.');

  const answerUpdates: Array<{
    id: string;
    isCorrect: boolean | null;
    awardedMarks: number | null;
    requiresManualGrading: boolean;
  }> = [];

  for (const aq of attempt.questions) {
    const answer = aq.answers[0];
    if (!answer) continue;

    const gradable: GradableQuestion = {
      type: aq.question.type,
      marks: aq.marks,
      ...effectiveMarking(aq.question, aq.marks, attempt.quiz),
      acceptedAnswers: aq.question.acceptedAnswers,
      caseSensitive: aq.question.caseSensitive,
      numericTolerance: aq.question.numericTolerance,
      correctOptionIds: aq.question.options.filter((o) => o.isCorrect).map((o) => o.id),
    };

    const outcome = gradeAnswer(gradable, {
      selectedOptionId: answer.selectedOptionId,
      selectedOptionIds: answer.selectedOptions.map((s) => s.optionId),
      textResponse: answer.textResponse,
      attachmentCount: answer._count.attachments,
    });

    answerUpdates.push({
      id: answer.id,
      isCorrect: outcome.isCorrect,
      awardedMarks: outcome.awardedMarks,
      requiresManualGrading: outcome.state === 'MANUAL',
    });
  }

  // One batched round trip instead of one awaited update per question.
  await prisma.$transaction([
    ...answerUpdates.map((update) =>
      prisma.answer.update({
        where: { id: update.id },
        data: {
          isCorrect: update.isCorrect,
          awardedMarks: update.awardedMarks,
          requiresManualGrading: update.requiresManualGrading,
        },
      }),
    ),
    prisma.examEvent.create({
      data: {
        attemptId: attempt.id,
        type: status === 'AUTO_SUBMITTED' ? 'AUTO_SUBMITTED' : 'ATTEMPT_SUBMITTED',
        severity: 'INFO',
      },
    }),
  ]);

}

/**
 * Records a human's mark for one answer and rolls the attempt's totals forward.
 *
 * Faculty may re-mark an already-marked answer; the audit log and the attempt
 * timeline both retain that it happened, so a score that changes after release
 * is always traceable to a person and a time.
 */
export async function gradeAnswerManually(params: {
  answerId: string;
  adminId: string;
  awardedMarks: number;
  note?: string | null;
  /** Re-mark an answer the server graded itself: used only when faculty uphold an appeal. */
  override?: boolean;
}) {
  const answer = await prisma.answer.findUnique({
    where: { id: params.answerId },
    select: {
      id: true,
      attemptId: true,
      requiresManualGrading: true,
      attemptQuestion: { select: { marks: true } },
    },
  });

  if (!answer) throw new ApiError('NOT_FOUND', 'That answer could not be found.');
  if (!answer.requiresManualGrading && !params.override) {
    throw new ApiError('VALIDATION', 'That answer was marked automatically and cannot be re-marked.');
  }

  const maxMarks = answer.attemptQuestion.marks;
  if (params.awardedMarks < 0 || params.awardedMarks > maxMarks) {
    throw new ApiError('VALIDATION', `Marks must be between 0 and ${maxMarks}.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.answer.update({
      where: { id: answer.id },
      data: {
        awardedMarks: params.awardedMarks,
        // Full marks reads as correct; anything less is partial, which the
        // results view reports as marks rather than as a tick or a cross.
        isCorrect: params.awardedMarks >= maxMarks,
        gradedById: params.adminId,
        gradedAt: new Date(),
        graderNote: params.note?.trim() || null,
      },
    });

    await tx.examEvent.create({
      data: {
        attemptId: answer.attemptId,
        type: 'ANSWER_GRADED',
        severity: 'INFO',
        metadata: { answerId: answer.id, awardedMarks: params.awardedMarks, maxMarks },
      },
    });
  });

  const updated = await recomputeAttemptTotals(answer.attemptId);

  // Stamp the moment the last outstanding answer was marked, so results release
  // can tell a fully-marked attempt from one still in the queue.
  if (updated.pendingManualCount === 0) {
    await prisma.quizAttempt.update({
      where: { id: answer.attemptId },
      data: { manualGradedAt: new Date() },
    });
  }

  return updated;
}

/**
 * Closes any attempt whose server-side deadline has passed. Called on read
 * paths (dashboards, live monitoring) so an abandoned tab cannot leave an
 * attempt open indefinitely.
 */
/**
 * A pause nobody ended: after MAX_PAUSE_MS the clock runs again. Same write as
 * a manual resume (deadline moves by the capped pause, compare-and-set), so a
 * simultaneous manual resume wins or loses cleanly. Returns how many resumed.
 */
export async function resumeOverlongPauses(attemptId?: string) {
  const overdue = await prisma.quizAttempt.findMany({
    where: {
      status: 'IN_PROGRESS',
      pausedAt: { lt: new Date(Date.now() - MAX_PAUSE_MS) },
      ...(attemptId ? { id: attemptId } : {}),
    },
    select: {
      id: true,
      quizId: true,
      expiresAt: true,
      pausedAt: true,
      pausedTotalMs: true,
      extraMinutes: true,
    },
    take: 50,
  });

  let resumed = 0;
  for (const attempt of overdue) {
    const pausedTotalMs = attempt.pausedTotalMs + MAX_PAUSE_MS;
    const horizonMinutes = attempt.extraMinutes + Math.ceil(pausedTotalMs / 60_000);
    await prisma.quiz.updateMany({
      where: { id: attempt.quizId, maxExtensionMinutes: { lt: horizonMinutes } },
      data: { maxExtensionMinutes: horizonMinutes },
    });
    const { count } = await prisma.quizAttempt.updateMany({
      where: {
        id: attempt.id,
        status: 'IN_PROGRESS',
        pausedAt: attempt.pausedAt,
        expiresAt: attempt.expiresAt,
      },
      data: {
        expiresAt: new Date(attempt.expiresAt.getTime() + MAX_PAUSE_MS),
        pausedAt: null,
        pausedTotalMs,
      },
    });
    if (count === 1) {
      resumed += 1;
      await audit({
        action: 'admin.attempt_resumed',
        entityType: 'QuizAttempt',
        entityId: attempt.id,
        metadata: { automatic: true, pausedMs: MAX_PAUSE_MS, pausedTotalMs },
      });
    }
  }
  return resumed;
}

export async function sweepExpiredAttempts() {
  await resumeOverlongPauses();
  const stale = await prisma.quizAttempt.findMany({
    where: {
      status: 'IN_PROGRESS',
      pausedAt: null,
      expiresAt: { lt: new Date(Date.now() - SUBMIT_GRACE_MS) },
    },
    select: { id: true },
    take: 50,
  });

  for (const attempt of stale) {
    try {
      await finalizeAttempt(attempt.id, 'AUTO_SUBMITTED');
    } catch (error) {
      console.error('[exam] failed to auto-submit expired attempt', attempt.id, error);
    }
  }

  return stale.length;
}

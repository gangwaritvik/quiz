import 'server-only';

import type { Prisma } from '@prisma/client';

import { MANUAL_TYPES, OPTION_TYPES, TEXT_TYPES } from '@/lib/grading';
import type { CreateQuestionInput } from '@/lib/validation';

/**
 * Translates validated question input into the columns to write.
 *
 * The important job here is *clearing* fields that do not apply to the chosen
 * type. Editing a short-answer question into a multiple-choice one must not
 * leave its accepted answers behind: they are answer-key material, and a
 * forgotten row would keep marking against a key nobody can see any more.
 */
export function questionFieldsFromInput(
  body: CreateQuestionInput,
): Omit<Prisma.QuestionUncheckedCreateInput, 'id' | 'subjectId'> {
  const isOptionBased = OPTION_TYPES.has(body.type);
  const isText = TEXT_TYPES.has(body.type);
  const isManual = MANUAL_TYPES.has(body.type);

  return {
    text: body.text,
    type: body.type,
    difficulty: body.difficulty,
    marks: body.marks,
    negativeMarks: body.negativeMarks,
    explanation: body.explanation || null,
    topicId: body.topicId || null,
    imageAssetId: body.imageAssetId ?? null,

    // Assertion–reason only.
    assertionText: body.type === 'ASSERTION_REASON' ? body.assertionText || null : null,
    reasonText: body.type === 'ASSERTION_REASON' ? body.reasonText || null : null,

    // Multi-select only; harmless but meaningless elsewhere.
    partialCredit: body.type === 'MCQ_MULTI' ? body.partialCredit : true,

    // Short answer only — the auto-marking key.
    acceptedAnswers: body.type === 'SHORT_ANSWER' ? body.acceptedAnswers : [],
    caseSensitive: body.type === 'SHORT_ANSWER' ? body.caseSensitive : false,
    numericTolerance: body.type === 'SHORT_ANSWER' ? (body.numericTolerance ?? null) : null,

    // Written and uploaded answers.
    maxWords: isText && !isOptionBased ? (body.maxWords ?? null) : null,
    maxAttachments: body.type === 'IMAGE_ANSWER' ? body.maxAttachments : 3,
    modelAnswer: isManual ? body.modelAnswer || null : null,
  };
}

/** Options to create for this question — empty for written and uploaded answers. */
export function questionOptionsFromInput(body: CreateQuestionInput) {
  if (!OPTION_TYPES.has(body.type)) return [];
  return body.options.map((option, index) => ({
    text: option.text,
    isCorrect: option.isCorrect,
    imageAssetId: option.imageAssetId ?? null,
    position: index,
  }));
}

/**
 * Everything the question bank shows faculty. Includes `isCorrect` and the
 * answer key — this is the one read path where they legitimately leave the
 * server, and it is reachable only behind `requireAdmin`.
 */
export const ADMIN_QUESTION_INCLUDE = {
  subject: { select: { name: true, code: true } },
  topic: { select: { id: true, name: true } },
  options: {
    select: { id: true, text: true, isCorrect: true, imageAssetId: true },
    orderBy: { position: 'asc' as const },
  },
} satisfies Prisma.QuestionInclude;

type AdminQuestion = Prisma.QuestionGetPayload<{ include: typeof ADMIN_QUESTION_INCLUDE }>;

export function serializeAdminQuestion(question: AdminQuestion) {
  return {
    id: question.id,
    text: question.text,
    type: question.type,
    difficulty: question.difficulty,
    marks: question.marks,
    negativeMarks: question.negativeMarks,
    explanation: question.explanation,
    subject: question.subject.name,
    subjectId: question.subjectId,
    topic: question.topic?.name ?? null,
    topicId: question.topicId,
    usageCount: question.usageCount,
    aiGenerated: question.aiGenerated,
    imageAssetId: question.imageAssetId,
    imageUrl: question.imageAssetId ? `/api/media/${question.imageAssetId}` : null,
    assertionText: question.assertionText,
    reasonText: question.reasonText,
    partialCredit: question.partialCredit,
    acceptedAnswers: question.acceptedAnswers,
    caseSensitive: question.caseSensitive,
    numericTolerance: question.numericTolerance,
    maxWords: question.maxWords,
    maxAttachments: question.maxAttachments,
    modelAnswer: question.modelAnswer,
    options: question.options.map((option) => ({
      id: option.id,
      text: option.text,
      isCorrect: option.isCorrect,
      imageAssetId: option.imageAssetId,
      imageUrl: option.imageAssetId ? `/api/media/${option.imageAssetId}` : null,
    })),
  };
}

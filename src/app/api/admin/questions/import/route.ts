import type { Prisma, QuestionType } from '@prisma/client';

import { describeImportRepeats } from '@/lib/ai/similarity';
import { ApiError, assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { type ImportIssue, parseCsv, stripHeader } from '@/lib/csv';
import { prisma } from '@/lib/db';
import { ASSERTION_REASON_OPTIONS, TRUE_FALSE_OPTIONS } from '@/lib/grading';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { importQuestionsSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DIFFICULTIES = new Set(['EASY', 'MEDIUM', 'HARD']);

/** Short aliases so a spreadsheet does not have to carry enum names. */
const TYPE_ALIASES: Record<string, QuestionType> = {
  '': 'MCQ_SINGLE',
  MCQ: 'MCQ_SINGLE',
  MCQ_SINGLE: 'MCQ_SINGLE',
  SINGLE: 'MCQ_SINGLE',
  MULTI: 'MCQ_MULTI',
  MCQ_MULTI: 'MCQ_MULTI',
  MULTIPLE: 'MCQ_MULTI',
  TF: 'TRUE_FALSE',
  TRUE_FALSE: 'TRUE_FALSE',
  AR: 'ASSERTION_REASON',
  ASSERTION_REASON: 'ASSERTION_REASON',
  SHORT: 'SHORT_ANSWER',
  SHORT_ANSWER: 'SHORT_ANSWER',
  LONG: 'LONG_ANSWER',
  LONG_ANSWER: 'LONG_ANSWER',
  DESCRIPTIVE: 'LONG_ANSWER',
  IMAGE: 'IMAGE_ANSWER',
  IMAGE_ANSWER: 'IMAGE_ANSWER',
};

interface RowOption {
  text: string;
  isCorrect: boolean;
  position: number;
}

interface RowPlan {
  options: RowOption[];
  acceptedAnswers: string[];
  assertionText: string | null;
  reasonText: string | null;
}

/**
 * Works out the answer key for one row.
 *
 * The `correct` column carries whatever the type needs — a letter for single
 * choice, several letters for multi-select, pipe-separated text for a short
 * answer — so one column shape serves every type and older files that predate
 * the extra columns still import unchanged.
 */
function planRow(
  type: QuestionType,
  optionTexts: string[],
  correctRaw: string,
  assertion: string,
  reason: string,
): RowPlan | string {
  const correct = correctRaw.trim();

  if (type === 'SHORT_ANSWER') {
    const acceptedAnswers = correct
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean);
    if (acceptedAnswers.length === 0) {
      return 'List at least one accepted answer in the "correct" column, separated by |.';
    }
    return { options: [], acceptedAnswers, assertionText: null, reasonText: null };
  }

  if (type === 'LONG_ANSWER' || type === 'IMAGE_ANSWER') {
    // Nothing to key against — these are marked by a person.
    return { options: [], acceptedAnswers: [], assertionText: null, reasonText: null };
  }

  // Option-based from here on.
  const texts =
    type === 'TRUE_FALSE'
      ? [...TRUE_FALSE_OPTIONS]
      : type === 'ASSERTION_REASON'
        ? [...ASSERTION_REASON_OPTIONS]
        : optionTexts;

  if (texts.length < 2) return 'At least two options are required.';

  if (type === 'ASSERTION_REASON' && (!assertion.trim() || !reason.trim())) {
    return 'Assertion and reason columns are both required for an assertion–reason question.';
  }

  // Accepts "A", "AC", "A|C" and "A,C".
  const letters = [...new Set(correct.toUpperCase().replace(/[^A-Z]/g, '').split(''))];
  if (letters.length === 0) return 'The correct answer column is empty.';

  const indexes = letters.map((letter) => letter.charCodeAt(0) - 65);
  const last = String.fromCharCode(64 + texts.length);
  if (indexes.some((index) => index < 0 || index >= texts.length)) {
    return `Correct answer must be one of A–${last}.`;
  }

  if (type === 'MCQ_MULTI' && indexes.length < 2) {
    return 'A multiple-select question needs at least two correct options, e.g. "AC".';
  }
  if (type !== 'MCQ_MULTI' && indexes.length !== 1) {
    return 'Exactly one correct option is allowed for this type.';
  }

  return {
    options: texts.map((text, position) => ({
      text: text.trim(),
      isCorrect: indexes.includes(position),
      position,
    })),
    acceptedAnswers: [],
    assertionText: type === 'ASSERTION_REASON' ? assertion.trim() : null,
    reasonText: type === 'ASSERTION_REASON' ? reason.trim() : null,
  };
}

/**
 * CSV question import.
 *
 * Columns: question, optionA, optionB, optionC, optionD, correct, difficulty,
 *          topic, marks, explanation, type, assertion, reason
 *
 * The last three are optional, so files written for the original ten-column
 * format still import as multiple-choice questions.
 *
 * Valid rows are imported and invalid rows are reported individually — an
 * all-or-nothing import is far more frustrating for a 500-row spreadsheet.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  enforceRateLimit(RATE_LIMITS.adminWrite, `question-import:${session.userId}`);

  const body = await parseBody(request, importQuestionsSchema);

  const subject = await prisma.subject.findUnique({
    where: { id: body.subjectId },
    include: { topics: true },
  });
  if (!subject) throw new ApiError('VALIDATION', 'Select a valid subject.');

  const parsedRows = parseCsv(body.csv);
  const rows = stripHeader(parsedRows, ['question', 'question text']);
  const firstRow = parsedRows.length - rows.length + 1; // row 1 is the header only when one was dropped
  if (rows.length === 0) throw new ApiError('VALIDATION', 'The file contains no data rows.');
  if (rows.length > 1000) {
    throw new ApiError('VALIDATION', 'Import files are limited to 1000 questions at a time.');
  }

  const topicsByName = new Map(subject.topics.map((t) => [t.name.toLowerCase(), t]));
  const issues: ImportIssue[] = [];
  let imported = 0;
  const created: Array<{ id: string; row: number }> = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + firstRow;
    const [
      text,
      a,
      b,
      c,
      d,
      correct,
      difficulty,
      topicName,
      marks,
      explanation,
      typeRaw,
      assertion,
      reason,
    ] = row;

    if (!text || text.trim().length < 5) {
      issues.push({ row: rowNumber, message: 'Question text is missing or too short.' });
      continue;
    }

    const type = TYPE_ALIASES[(typeRaw ?? '').trim().toUpperCase()];
    if (!type) {
      issues.push({
        row: rowNumber,
        message: `Unknown type "${typeRaw}". Use MCQ, MULTI, TF, AR, SHORT, LONG or IMAGE.`,
      });
      continue;
    }

    const normalisedDifficulty = (difficulty ?? 'MEDIUM').trim().toUpperCase();
    if (!DIFFICULTIES.has(normalisedDifficulty)) {
      issues.push({ row: rowNumber, message: 'Difficulty must be EASY, MEDIUM or HARD.' });
      continue;
    }

    // A blank cell before a filled one would shift the letters ("C" would mean the third filled option).
    const cells = [a, b, c, d].map((value) => (value ?? '').trim());
    const lastFilled = cells.findLastIndex(Boolean);
    if (cells.slice(0, lastFilled).some((value) => !value)) {
      issues.push({ row: rowNumber, message: 'Option cells must be filled from A onwards, with no blank in between.' });
      continue;
    }
    const optionTexts = cells.filter(Boolean);
    const plan = planRow(type, optionTexts, correct ?? '', assertion ?? '', reason ?? '');
    if (typeof plan === 'string') {
      issues.push({ row: rowNumber, message: plan });
      continue;
    }

    // Unknown topics are created on the fly so an import is not blocked by
    // reference data the teacher has not set up yet.
    let topicId: string | null = null;
    if (topicName?.trim()) {
      const key = topicName.trim().toLowerCase();
      let topic = topicsByName.get(key);
      if (!topic) {
        topic = await prisma.topic.create({
          data: { name: topicName.trim(), subjectId: subject.id },
        });
        topicsByName.set(key, topic);
      }
      topicId = topic.id;
    }

    const parsedMarks = Number.parseInt(marks?.trim() || '1', 10);
    if (!Number.isInteger(parsedMarks) || parsedMarks < 1 || parsedMarks > 20) {
      issues.push({ row: rowNumber, message: 'Marks must be a whole number from 1 to 20.' });
      continue;
    }

    const data: Prisma.QuestionUncheckedCreateInput = {
      text: text.trim(),
      type,
      difficulty: normalisedDifficulty as 'EASY' | 'MEDIUM' | 'HARD',
      marks: parsedMarks,
      explanation: explanation?.trim() || null,
      subjectId: subject.id,
      topicId,
      authorId: session.adminId,
      acceptedAnswers: plan.acceptedAnswers,
      assertionText: plan.assertionText,
      reasonText: plan.reasonText,
      ...(plan.options.length > 0 ? { options: { create: plan.options } } : {}),
    };

    const question = await prisma.question.create({ data, select: { id: true } });
    created.push({ id: question.id, row: rowNumber });
    imported += 1;
  }

  await audit({
    action: 'admin.questions_imported',
    userId: session.userId,
    entityType: 'Subject',
    entityId: subject.id,
    context,
    metadata: { imported, rejected: issues.length },
  });

  // Imported either way; the teacher is told which rows look like repeats.
  const repeats = await describeImportRepeats(subject.id, created);

  return ok({ imported, rejected: issues.length, issues: issues.slice(0, 50), ...(repeats ? { repeats } : {}) });
});

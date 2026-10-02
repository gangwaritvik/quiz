import { z } from 'zod';

import { MAX_EXTENSION_MINUTES } from '@/lib/time-extension';

/**
 * Every request body crossing the API boundary is parsed by one of these
 * schemas. Anything not described here is dropped rather than trusted.
 */

const cuid = z.string().min(20).max(40).regex(/^[a-z0-9]+$/i, 'Invalid identifier');

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/** Accepts either a college email or a roll number such as `23CSE041`. */
export const identifierSchema = z
  .string()
  .trim()
  .min(3, 'Enter your student ID or college email')
  .max(120, 'That identifier is too long')
  .regex(
    /^(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9]{4,20})$/,
    'Enter a valid student ID or college email',
  );

export const otpRequestSchema = z.object({
  identifier: identifierSchema,
});

export const otpVerifySchema = z.object({
  identifier: identifierSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

// ---------------------------------------------------------------------------
// Exam
// ---------------------------------------------------------------------------

export const startExamSchema = z.object({
  quizId: cuid,
  acknowledgedRules: z.literal(true, {
    errorMap: () => ({ message: 'You must acknowledge the examination rules.' }),
  }),
  checks: z
    .object({
      fullscreenSupported: z.boolean(),
      cameraReady: z.boolean().optional(),
      microphoneReady: z.boolean().optional(),
    })
    .optional(),
});

/**
 * Every field is optional because the shape of an answer depends on the
 * question's type, and only the server knows that type. The client sends what
 * applies; `saveAnswer` validates it against the question it was actually
 * served and ignores anything that does not belong.
 */
export const saveAnswerSchema = z
  .object({
    attemptQuestionId: cuid,
    selectedOptionId: cuid.nullable().optional(),
    selectedOptionIds: z.array(cuid).max(10).optional(),
    textResponse: z.string().max(20_000).nullable().optional(),
    markedForReview: z.boolean().optional(),
    /** Grows with every edit on this question; lets the server drop stale replays. */
    clientSeq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .refine(
    (data) =>
      data.selectedOptionId !== undefined ||
      data.selectedOptionIds !== undefined ||
      data.textResponse !== undefined ||
      data.markedForReview !== undefined,
    { message: 'No answer content was supplied.' },
  );

export const attachAnswerSchema = z.object({
  attemptQuestionId: cuid,
});

export const flagQuestionSchema = z.object({
  attemptQuestionId: cuid,
  markedForReview: z.boolean(),
});

export const examEventTypeSchema = z.enum([
  'TAB_SWITCH',
  'WINDOW_BLUR',
  'WINDOW_FOCUS',
  'FULLSCREEN_ENTER',
  'FULLSCREEN_EXIT',
  'COPY_ATTEMPT',
  'PASTE_ATTEMPT',
  'CUT_ATTEMPT',
  'CONTEXT_MENU',
  'PRINT_ATTEMPT',
  'SHORTCUT_BLOCKED',
  'NETWORK_OFFLINE',
  'NETWORK_ONLINE',
  'CAMERA_PERMISSION_LOST',
  'CAMERA_STREAM_STOPPED',
  'FACE_NOT_DETECTED',
  'MULTIPLE_FACES',
  'MICROPHONE_LOST',
  'RESIZE_SUSPICIOUS',
  'IDLE_TIMEOUT',
  'MULTIPLE_DISPLAYS_DETECTED',
  'SCREEN_SHARE_STOPPED',
  'SCREEN_SHARE_PERMISSION_LOST',
]);

/** Clients may report only the event types above; server-authored types
 *  (MULTIPLE_SESSION, DEVICE_MISMATCH, ATTEMPT_*) cannot be spoofed. */
export const examEventSchema = z.object({
  type: examEventTypeSchema,
  durationMs: z.number().int().min(0).max(6 * 60 * 60 * 1000).optional(),
  clientTimestamp: z.string().datetime().optional(),
  // Flat and small: at most 10 primitive values, strings capped, no nesting.
  metadata: z
    .record(z.string().max(64), z.union([z.string().max(200), z.number(), z.boolean()]))
    .refine((value) => Object.keys(value).length <= 10, { message: 'Too many metadata keys.' })
    .optional(),
});

export const examEventBatchSchema = z.object({
  events: z.array(examEventSchema).min(1).max(25),
});

export const submitExamSchema = z.object({
  confirm: z.literal(true),
});

// ---------------------------------------------------------------------------
// Admin — quizzes
// ---------------------------------------------------------------------------

export const quizSecuritySchema = z.object({
  randomizeQuestions: z.boolean().default(true),
  randomizeOptions: z.boolean().default(true),
  singleAttempt: z.boolean().default(true),
  requireFullscreen: z.boolean().default(true),
  detectTabSwitch: z.boolean().default(true),
  blockCopyPaste: z.boolean().default(true),
  bindDeviceSession: z.boolean().default(true),
  cameraMonitoring: z.boolean().default(false),
  microphoneMonitoring: z.boolean().default(false),
  lockQuestionNavigation: z.boolean().default(false),
  blockMultipleDisplays: z.boolean().default(false),
  requireScreenShare: z.boolean().default(false),
  releaseResults: z.boolean().default(true),
  releaseAnswers: z.boolean().default(false),
});

/** Quiz-wide marking scheme; null (or absent) leaves each question's own setting. */
const quizMarkingFields = {
  negativeMarkingPct: z.number().int().min(0).max(100).nullable().optional(),
  multiPartialCredit: z.boolean().nullable().optional(),
};

// `createQuizSchema` lives below the question-bank section: a fixed-mode quiz
// carries its own questions, so it depends on `instantQuestionSchema`.

export const updateQuizStatusSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
});

/**
 * Editing a quiz's details. Every field is optional so the same route serves a
 * status flip and a full edit. What a quiz *asks* is not here — the paper is
 * edited through its own route, which has its own freeze rule.
 */
export const updateQuizSchema = z
  .object({
    title: z.string().trim().min(3, 'Quiz name is required').max(120).optional(),
    description: z.string().trim().max(1000).optional().or(z.literal('')),
    durationMinutes: z.coerce.number().int().min(1).max(360).optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    easyPct: z.coerce.number().int().min(0).max(100).optional(),
    mediumPct: z.coerce.number().int().min(0).max(100).optional(),
    hardPct: z.coerce.number().int().min(0).max(100).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
    security: quizSecuritySchema.partial().optional(),
    ...quizMarkingFields,
  })
  .refine(
    (data) =>
      !data.startsAt || !data.endsAt || new Date(data.endsAt) > new Date(data.startsAt),
    { message: 'End date must be after the start date', path: ['endsAt'] },
  )
  .refine(
    (data) => {
      const mix = [data.easyPct, data.mediumPct, data.hardPct];
      return mix.every((value) => value === undefined) || mix.every((value) => value !== undefined) && mix.reduce((sum, value) => sum + value, 0) === 100;
    },
    { message: 'Difficulty distribution must total 100%', path: ['mediumPct'] },
  );

export const assignQuizSchema = z.object({
  studentIds: z.array(cuid).max(2000),
});

/** Heartbeat body; `noticesSince` is the server timestamp of the newest notice already shown. */
export const heartbeatSchema = z.object({
  noticesSince: z.string().datetime({ offset: true }).optional(),
});

/** Faculty broadcast to everyone sitting a quiz. */
export const sendNoticeSchema = z.object({
  message: z.string().trim().min(1, 'Write a message').max(500, 'Keep it under 500 characters'),
});

/** Give one student another attempt at a single-attempt quiz, or take back an unused one. */
export const retakeGrantSchema = z.object({
  studentId: cuid,
  action: z.enum(['grant', 'revoke']),
});

/** Pause or resume one running attempt. */
export const pauseAttemptSchema = z.object({
  action: z.enum(['pause', 'resume']),
});

/** Live grant: add time to one running attempt. */
export const extendAttemptSchema = z.object({
  minutes: z.number().int().min(1).max(MAX_EXTENSION_MINUTES),
});

/** Pre-start accommodation for one assigned student; 0 removes it. */
export const setExtensionSchema = z.object({
  studentId: cuid,
  minutes: z.number().int().min(0).max(MAX_EXTENSION_MINUTES),
});

// ---------------------------------------------------------------------------
// Admin — question bank
// ---------------------------------------------------------------------------

export const questionTypeSchema = z.enum([
  'MCQ_SINGLE',
  'MCQ_MULTI',
  'TRUE_FALSE',
  'ASSERTION_REASON',
  'SHORT_ANSWER',
  'LONG_ANSWER',
  'IMAGE_ANSWER',
]);

/** Option text may be empty when the option is a diagram. */
export const questionOptionSchema = z.object({
  text: z.string().trim().max(500).default(''),
  isCorrect: z.boolean(),
  imageAssetId: cuid.nullable().optional(),
});

const SINGLE_CORRECT_TYPES = ['MCQ_SINGLE', 'TRUE_FALSE', 'ASSERTION_REASON'] as const;
const OPTION_BASED_TYPES = [...SINGLE_CORRECT_TYPES, 'MCQ_MULTI'] as const;

/**
 * Everything that describes a question except where it lives. Bank questions
 * add a subject and topic; questions written inline for one quiz inherit the
 * quiz's subject instead, so the same rules govern both.
 */
const questionBodySchema = z.object({
  text: z.string().trim().min(5, 'Question text is required').max(4000),
  type: questionTypeSchema.default('MCQ_SINGLE'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
  marks: z.coerce.number().int().min(1).max(20).default(1),
  negativeMarks: z.coerce.number().min(0).max(10).default(0),
  explanation: z.string().trim().max(2000).optional().or(z.literal('')),
  imageAssetId: cuid.nullable().optional(),

  // Assertion–reason
  assertionText: z.string().trim().max(2000).optional().or(z.literal('')),
  reasonText: z.string().trim().max(2000).optional().or(z.literal('')),

  // Multi-select
  partialCredit: z.boolean().default(true),

  // Short answer
  acceptedAnswers: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  caseSensitive: z.boolean().default(false),
  numericTolerance: z.coerce.number().min(0).max(1_000_000).nullable().optional(),

  // Written / uploaded answers
  maxWords: z.coerce.number().int().min(10).max(5000).nullable().optional(),
  maxAttachments: z.coerce.number().int().min(1).max(10).default(3),
  modelAnswer: z.string().trim().max(5000).optional().or(z.literal('')),

  options: z.array(questionOptionSchema).max(6).default([]),
});

type QuestionBody = z.infer<typeof questionBodySchema>;

/** Shared so an inline quiz question is marked by exactly the same rules. */
function refineQuestionBody(data: QuestionBody, ctx: z.RefinementCtx) {
  {
    const optionBased = (OPTION_BASED_TYPES as readonly string[]).includes(data.type);

    if (optionBased) {
      if (data.options.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide at least two answer options.',
          path: ['options'],
        });
      }

      // A choice must be readable as text or as a diagram — not neither.
      data.options.forEach((option, index) => {
        if (option.text.length === 0 && !option.imageAssetId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Give this option text or an image.',
            path: ['options', index, 'text'],
          });
        }
      });

      const correctCount = data.options.filter((o) => o.isCorrect).length;

      if ((SINGLE_CORRECT_TYPES as readonly string[]).includes(data.type) && correctCount !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Exactly one option must be marked correct.',
          path: ['options'],
        });
      }

      if (data.type === 'MCQ_MULTI' && correctCount < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Mark at least two options correct, or use single-choice instead.',
          path: ['options'],
        });
      }
    } else if (data.options.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Written and uploaded answers cannot have options.',
        path: ['options'],
      });
    }

    if (data.type === 'ASSERTION_REASON') {
      if (!data.assertionText) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Enter the assertion.',
          path: ['assertionText'],
        });
      }
      if (!data.reasonText) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Enter the reason.',
          path: ['reasonText'],
        });
      }
    }

    if (data.type === 'SHORT_ANSWER' && data.acceptedAnswers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'List at least one accepted answer so this can be marked automatically.',
        path: ['acceptedAnswers'],
      });
    }
  }
}

export const createQuestionSchema = questionBodySchema
  .extend({
    subjectId: cuid,
    topicId: cuid.optional().or(z.literal('')),
  })
  .superRefine(refineQuestionBody);

/** A question written inline on the quiz form; it inherits the quiz's subject. */
export const instantQuestionSchema = questionBodySchema.superRefine(refineQuestionBody);

export const updateQuestionSchema = createQuestionSchema;

// ---------------------------------------------------------------------------
// Admin — quiz creation
//
// Two ways to build a paper:
//   POOL  — name a subject, a size and a difficulty mix; the server draws a
//           different valid paper for each student at exam time.
//   FIXED — write the questions here; everyone sits the same paper.
// ---------------------------------------------------------------------------

export const createQuizSchema = z
  .object({
    title: z.string().trim().min(3, 'Quiz name is required').max(120),
    subjectId: cuid,
    description: z.string().trim().max(1000).optional().or(z.literal('')),
    durationMinutes: z.coerce.number().int().min(1).max(360),
    sourceMode: z.enum(['POOL', 'FIXED']).default('POOL'),
    /** Pool mode only — in fixed mode the count comes from `questions`. */
    questionCount: z.coerce.number().int().min(1).max(200).default(1),
    poolTopicIds: z.array(cuid).default([]),
    easyPct: z.coerce.number().int().min(0).max(100).default(30),
    mediumPct: z.coerce.number().int().min(0).max(100).default(50),
    hardPct: z.coerce.number().int().min(0).max(100).default(20),
    /** Fixed mode only — the paper itself, in order. */
    questions: z.array(instantQuestionSchema).max(100).default([]),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'),
    assignedStudentIds: z.array(cuid).default([]),
    security: quizSecuritySchema,
    ...quizMarkingFields,
  })
  .superRefine((data, ctx) => {
    if (data.sourceMode === 'FIXED') {
      if (data.questions.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Write at least one question for this quiz.',
          path: ['questions'],
        });
      }
      // The difficulty mix and pool topics are meaningless for a fixed paper;
      // they are ignored rather than validated.
      return;
    }

    if (data.easyPct + data.mediumPct + data.hardPct !== 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Difficulty distribution must add up to 100%',
        path: ['mediumPct'],
      });
    }
    if (data.questions.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A pooled quiz draws from the bank and cannot carry its own questions.',
        path: ['questions'],
      });
    }
  })
  .refine((data) => new Date(data.endsAt) > new Date(data.startsAt), {
    message: 'End date must be after the start date',
    path: ['endsAt'],
  });

/** Replaces the written paper of a fixed-mode quiz, in order. */
export const replaceQuizQuestionsSchema = z.object({
  questions: z.array(instantQuestionSchema).min(1, 'A quiz needs at least one question').max(100),
});

/** Faculty marking one descriptive or uploaded answer. */
export const gradeAnswerSchema = z.object({
  awardedMarks: z.coerce.number().min(0).max(100),
  note: z.string().trim().max(2000).optional().or(z.literal('')),
});

export const importQuestionsSchema = z.object({
  subjectId: cuid,
  /** Raw CSV text: question,optionA,optionB,optionC,optionD,correct,difficulty,topic,marks,explanation */
  csv: z.string().min(10).max(500_000),
});

// ---------------------------------------------------------------------------
// Admin — students
// ---------------------------------------------------------------------------

export const createStudentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  rollNumber: z
    .string()
    .trim()
    .min(4)
    .max(20)
    .regex(/^[A-Za-z0-9]+$/, 'Student ID must be alphanumeric')
    .transform((value) => value.toUpperCase()),
  department: z.string().trim().min(2).max(80),
  section: z.string().trim().min(1).max(10),
  semester: z.coerce.number().int().min(1).max(12).default(1),
});

export const updateStudentSchema = createStudentSchema.partial().extend({
  status: z.enum(['ACTIVE', 'DISABLED', 'PENDING']).optional(),
});

export const importStudentsSchema = z.object({
  /** Raw CSV text: name,email,rollNumber,department,section,semester */
  csv: z.string().min(10).max(500_000),
});

// ---------------------------------------------------------------------------
// Admin — integrity review
// ---------------------------------------------------------------------------

export const integrityReviewSchema = z.object({
  outcome: z.enum(['REVIEWED', 'DISMISSED', 'ESCALATED']).default('REVIEWED'),
  note: z.string().trim().max(2000).optional().or(z.literal('')),
});

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export const adminSearchSchema = z.object({
  q: z.string().trim().max(120).default(''),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const questionFilterSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  subjectId: z.string().optional(),
  topicId: z.string().optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  type: questionTypeSchema.optional(),
});

/** Filters for the manual grading queue. */
export const gradingQueueSchema = paginationSchema.extend({
  /** A malformed id is ignored; ownership is still enforced by the route. */
  quizId: cuid.optional().catch(undefined),
  /** Student name or roll number. Oversized input is rejected, not truncated. */
  q: z.string().trim().max(60).default(''),
  /** oldest = longest-waiting first. Unknown values fall back rather than 422. */
  sort: z.enum(['oldest', 'newest', 'student', 'quiz']).catch('oldest'),
  /** Include attempts whose outstanding answers have all been marked. */
  includeCompleted: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

/** Filters for the integrity queue. `risk` is lowest integrity score first. */
export const integrityQueueSchema = z.object({
  status: z.enum(['all', 'needs-review', 'high-risk', 'normal']).catch('needs-review'),
  reviewed: z.enum(['all', 'unreviewed', 'reviewed']).catch('unreviewed'),
  quizId: cuid.optional().catch(undefined),
  sort: z.enum(['risk', 'newest', 'oldest', 'student']).catch('risk'),
  q: z.string().trim().max(60).default(''),
});

export const studentFilterSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  department: z.string().optional(),
  section: z.string().optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'PENDING']).optional(),
});

export type CreateQuizInput = z.infer<typeof createQuizSchema>;
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type ExamEventInput = z.infer<typeof examEventSchema>;

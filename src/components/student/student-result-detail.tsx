'use client';

import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  Circle,
  CircleSlash,
  Clock,
  Hourglass,
  Lock,
  Timer,
  X,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { ErrorState } from '@/components/shared/error-state';
import type { IntegrityStatus } from '@/components/shared/integrity-badge';
import { PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { MathText } from '@/components/shared/math-text';
import { useApi } from '@/hooks/use-api';
import { QUESTION_TYPE_LABEL, type QuestionTypeValue } from '@/lib/question-types';
import { cn, formatDateTime } from '@/lib/utils';

/** Per-question grading fields are only present once answers are released. */
interface ResultQuestion {
  position: number;
  text: string;
  type: QuestionTypeValue;
  topic: string;
  marks: number;
  answered: boolean;
  /** Still with a human marker, so it has no result yet. */
  awaitingMarker: boolean;
  awardedMarks?: number | null;
  isCorrect?: boolean | null;
  explanation?: string | null;
  selectedOptionId?: string | null;
  selectedOptionIds?: string[];
  options?: Array<{ id: string; text: string; isCorrect: boolean }>;
  /** Present for hand-marked answers regardless of the answer-key gate. */
  textResponse?: string | null;
  attachments?: Array<{ id: string; url: string; name: string }>;
  graderNote?: string | null;
}

interface ResultData {
  released: boolean;
  message?: string;
  showAnswers?: boolean;
  provisional?: boolean;
  pendingManualCount?: number;
  attempt?: {
    id: string;
    status: string;
    score: number;
    maxScore: number;
    percentage: number;
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
    startedAt: string;
    submittedAt: string | null;
  };
  quiz: { title: string; subject: string; subjectCode?: string; questionCount?: number };
  integrity?: { score: number; status: IntegrityStatus } | null;
  topicPerformance?: Array<{ topic: string; correct: number; total: number; percentage: number }>;
  questions?: ResultQuestion[];
  submittedAt?: string | null;
}

export function StudentResultDetail({ attemptId }: { attemptId: string }) {
  const { data, error, initialLoading, refetch } = useApi<ResultData>(
    `/api/results/${attemptId}`,
  );

  if (error && !data) {
    return (
      <PageShell>
        <BackLink />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  if (initialLoading || !data) {
    return (
      <PageShell>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-6 h-3 w-32" />
        <Skeleton className="mt-3 h-9 w-full max-w-lg" />
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Skeleton className="h-96 rounded-lg" />
          <Skeleton className="h-72 rounded-lg lg:col-start-2 lg:row-start-1" />
        </div>
      </PageShell>
    );
  }

  if (!data.released || !data.attempt) {
    return (
      <PageShell>
        <BackLink />

        <div className="mx-auto mt-6 max-w-xl rounded-lg border border-border bg-card px-6 py-10 text-center sm:px-10">
          <Lock className="mx-auto size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <h1 className="type-heading mt-4">Results not released</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {data.message ?? 'Your faculty has not released results for this quiz yet.'}
          </p>
          <dl className="mt-6 divide-y divide-border border-y border-border text-left text-sm">
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-muted-foreground">Quiz</dt>
              <dd className="min-w-0 break-words text-right font-medium">{data.quiz.title}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-muted-foreground">Submitted</dt>
              <dd className="tabular text-right font-medium">
                {data.submittedAt ? formatDateTime(data.submittedAt) : '—'}
              </dd>
            </div>
          </dl>
        </div>
      </PageShell>
    );
  }

  const { attempt } = data;
  const questions = data.questions ?? [];
  const durationMinutes = attempt.submittedAt
    ? Math.max(
        1,
        Math.round(
          (new Date(attempt.submittedAt).getTime() - new Date(attempt.startedAt).getTime()) / 60_000,
        ),
      )
    : null;

  return (
    <PageShell>
      <BackLink />

      <motion.header
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        className="border-b border-border pb-6"
      >
        <h1 className="type-title break-words">{data.quiz.title}</h1>

        {/* Head of an answer booklet: the paper's particulars in a ruled grid.
            The candidate name and roll number are not in this payload, so
            those cells are left out rather than guessed. */}
        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
          {[
            { label: 'Paper', value: data.quiz.title },
            {
              label: 'Subject',
              value: data.quiz.subject
                ? `${data.quiz.subject}${data.quiz.subjectCode ? ` · ${data.quiz.subjectCode}` : ''}`
                : null,
            },
            {
              label: 'Date',
              value: attempt.submittedAt ? formatDateTime(attempt.submittedAt) : null,
              numeric: true,
            },
            {
              label: 'Marks',
              value: `${attempt.score} / ${attempt.maxScore}`,
              numeric: true,
              note: data.provisional ? 'Provisional' : null,
            },
          ]
            .filter((cell) => cell.value)
            .map((cell) => (
              <div key={cell.label} className="min-w-0 bg-card px-3 py-2.5">
                <dt className="type-eyebrow">{cell.label}</dt>
                <dd
                  className={cn(
                    'mt-1 break-words text-sm font-medium text-foreground',
                    cell.numeric && 'tabular',
                  )}
                >
                  {cell.value}
                  {cell.note ? (
                    <span className="ml-1.5 font-normal text-muted-foreground">{cell.note}</span>
                  ) : null}
                </dd>
              </div>
            ))}
        </dl>

        {durationMinutes || attempt.status === 'AUTO_SUBMITTED' ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            {durationMinutes ? (
              <span className="tabular flex items-center gap-1.5">
                <Clock className="size-3.5" aria-hidden />
                {durationMinutes} min taken
              </span>
            ) : null}
            {attempt.status === 'AUTO_SUBMITTED' ? (
              <Badge variant="warning">
                <Timer aria-hidden />
                Auto-submitted at time limit
              </Badge>
            ) : null}
          </div>
        ) : null}
      </motion.header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        {/* First in the DOM so the score is read first; moved right on wide screens. */}
        <section
          aria-label="Score summary"
          className="rounded-lg border border-border bg-card p-5 sm:p-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1"
        >
          <p className="text-sm text-muted-foreground">
            {data.provisional ? 'Score so far' : 'Score'}
          </p>
          <p className="tabular mt-1 flex items-baseline gap-2 font-serif text-4xl font-semibold text-foreground">
            {attempt.score}
            <span className="font-sans text-xl font-normal text-muted-foreground">
              / {attempt.maxScore}
            </span>
          </p>
          {/* A percentage computed while answers are unmarked would read as a
              final grade and would be wrong, so it is withheld until marking
              finishes rather than shown with a caveat. */}
          {data.provisional ? (
            <div className="mt-4 rounded-md border border-warning/25 bg-warning-subtle px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
                <Hourglass className="size-3.5 shrink-0" aria-hidden />
                Provisional
              </p>
              <p className="mt-1 text-xs leading-relaxed text-warning">
                {data.pendingManualCount} answer
                {data.pendingManualCount === 1 ? '' : 's'} on this paper still{' '}
                {data.pendingManualCount === 1 ? 'needs' : 'need'} to be marked by your faculty.
                Your total will rise once that is done.
              </p>
            </div>
          ) : (
            <>
              <p className="tabular mt-1 text-lg font-semibold text-foreground">
                {attempt.percentage}%
              </p>
              <Progress value={attempt.percentage} aria-label="Score" className="mt-3 h-1.5" />
            </>
          )}

          <dl className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
            <ScoreRow icon={Check} tone="text-success" label="Correct" value={attempt.correctCount} />
            <ScoreRow icon={X} tone="text-danger" label="Incorrect" value={attempt.incorrectCount} />
            <ScoreRow
              icon={CircleSlash}
              tone="text-muted-foreground"
              label="Unanswered"
              value={attempt.unansweredCount}
            />
          </dl>

          {data.integrity && data.integrity.status !== 'NORMAL' ? (
            <div className="mt-5 border-t border-border pt-4">
              <Badge variant="muted">
                <Hourglass aria-hidden />
                Under review by your faculty
              </Badge>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Your faculty may look at how this attempt went before your result is final. You
                don&apos;t need to do anything; contact your faculty member if you have questions.
              </p>
            </div>
          ) : null}
        </section>

        <div className="min-w-0 space-y-12 lg:col-start-1 lg:row-start-1">
          <section aria-labelledby="topics-heading">
            <h2 id="topics-heading" className="type-heading">
              Performance by topic
            </h2>
            {data.topicPerformance && data.topicPerformance.length > 0 ? (
              <ul className="mt-4 space-y-4">
                {data.topicPerformance.map((topic) => (
                  <li key={topic.topic}>
                    <div className="flex items-baseline justify-between gap-4 text-sm">
                      <span className="min-w-0 break-words font-medium">{topic.topic}</span>
                      <span className="tabular shrink-0 text-muted-foreground">
                        <span className="font-semibold text-foreground">{topic.percentage}%</span>{' '}
                        ({topic.correct}/{topic.total})
                      </span>
                    </div>
                    <Progress
                      value={topic.percentage}
                      aria-label={`${topic.topic} score`}
                      className="mt-2 h-1.5"
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No topic breakdown is available for this paper.
              </p>
            )}
          </section>

          <section aria-labelledby="review-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="review-heading" className="type-heading">
                Question review
              </h2>
              {!data.showAnswers ? (
                <Badge variant="muted">
                  <Lock aria-hidden />
                  Answers withheld
                </Badge>
              ) : null}
            </div>

            {!data.showAnswers ? (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Your faculty has released scores but not the answer key for this quiz. Per-question
                results are withheld too — knowing which questions you got right would reveal the
                key for the paper you sat. Your totals and topic breakdown are shown here.
              </p>
            ) : null}

            {questions.length > 0 ? (
              <ol className="mt-4 divide-y divide-border border-y border-border">
                {questions.map((question) => (
                  <QuestionReviewItem
                    key={question.position}
                    question={question}
                    showAnswers={Boolean(data.showAnswers)}
                  />
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                There are no questions to review for this paper.
              </p>
            )}
          </section>
        </div>
      </div>
    </PageShell>
  );
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-3 mb-4 h-10 text-muted-foreground">
      <Link href="/results">
        <ArrowLeft />
        Results
      </Link>
    </Button>
  );
}

/**
 * One question in the review list.
 *
 * Three states rather than two: marked, withheld (the teacher released scores
 * but not the key), and awaiting a human marker. Conflating the last two would
 * tell a student their essay was wrong when it simply has not been read yet.
 */
function QuestionReviewItem({
  question,
  showAnswers,
}: {
  question: ResultQuestion;
  showAnswers: boolean;
}) {
  const { awaitingMarker } = question;
  const selectedIds = new Set(
    question.selectedOptionIds?.length
      ? question.selectedOptionIds
      : question.selectedOptionId
        ? [question.selectedOptionId]
        : [],
  );

  const marker = (() => {
    if (awaitingMarker) {
      return { className: 'bg-warning-subtle text-warning', icon: <Hourglass className="size-3" /> };
    }
    if (!showAnswers) {
      return { className: 'bg-muted text-muted-foreground', icon: <Lock className="size-3" /> };
    }
    if (question.isCorrect === true) {
      return {
        className: 'bg-success-subtle text-success',
        icon: <Check className="size-3.5" strokeWidth={3} />,
      };
    }
    if (question.answered) {
      return {
        className: 'bg-danger-subtle text-danger',
        icon: <X className="size-3.5" strokeWidth={3} />,
      };
    }
    return { className: 'bg-muted text-muted-foreground', icon: <CircleSlash className="size-3" /> };
  })();

  const status = (() => {
    if (awaitingMarker) return 'Awaiting marking';
    if (!question.answered) return 'Not answered';
    if (!showAnswers) return 'Answered';
    if (question.isCorrect === true) return 'Correct';
    // A partially-credited multi-select is neither simply right nor wrong.
    if ((question.awardedMarks ?? 0) > 0) return 'Partly correct';
    return 'Incorrect';
  })();

  return (
    <li className="py-6">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
            marker.className,
          )}
          aria-hidden
        >
          {marker.icon}
        </span>

        <div className="min-w-0 flex-1">
          <p className="break-words text-[0.9375rem] font-medium leading-relaxed text-foreground">
            <span className="tabular text-muted-foreground">{question.position + 1}. </span>
            <MathText text={question.text} />
          </p>

          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{status}</span>
            <span className="tabular">
              {awaitingMarker || question.awardedMarks === null || question.awardedMarks === undefined
                ? `${question.marks} marks`
                : `${question.awardedMarks} / ${question.marks} marks`}
            </span>
            <Badge variant="outline">{question.topic}</Badge>
            <Badge variant="secondary">{QUESTION_TYPE_LABEL[question.type]}</Badge>
          </p>

          {/* A student's own writing and their marker's feedback are theirs to
              read as soon as results are released — there is no answer key to
              withhold on a hand-marked question. */}
          {question.textResponse ? (
            <div className="mt-4 border-l-2 border-border pl-4">
              <p className="type-eyebrow">Your answer</p>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                {question.textResponse}
              </p>
            </div>
          ) : null}

          {question.attachments && question.attachments.length > 0 ? (
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {question.attachments.map((attachment, index) => (
                <li key={attachment.id} className="overflow-hidden rounded-md border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element -- authorised route */}
                  <img
                    loading="lazy"
                    decoding="async"
                    src={attachment.url}
                    alt={`Your uploaded answer, page ${index + 1}`}
                    // White regardless of theme: these are photographs of paper.
                    className="max-h-48 w-full bg-white object-contain"
                  />
                </li>
              ))}
            </ul>
          ) : null}

          {question.graderNote ? (
            <p className="mt-4 rounded-md border border-primary/25 bg-accent/50 px-3 py-2.5 text-sm leading-relaxed">
              <span className="font-medium text-foreground">Feedback from your faculty. </span>
              <span className="text-muted-foreground">{question.graderNote}</span>
            </p>
          ) : null}

          {showAnswers && question.options && question.options.length > 0 ? (
            <ul className="mt-4 space-y-1.5">
              {question.options.map((option) => {
                const chosen = selectedIds.has(option.id);
                const OptionIcon = option.isCorrect ? Check : chosen ? X : Circle;
                return (
                  <li
                    key={option.id}
                    className={cn(
                      'flex items-start gap-2.5 rounded-md px-3 py-2 text-sm',
                      option.isCorrect && 'bg-success-subtle text-success',
                      chosen && !option.isCorrect && 'bg-danger-subtle text-danger',
                      !option.isCorrect && !chosen && 'text-muted-foreground',
                    )}
                  >
                    <OptionIcon
                      className={cn('mt-0.5 size-4 shrink-0', !option.isCorrect && !chosen && 'size-3.5')}
                      strokeWidth={option.isCorrect || chosen ? 2.5 : 1.75}
                      aria-hidden
                    />
                    <MathText text={option.text} className="min-w-0 flex-1 break-words" />
                    {chosen || option.isCorrect ? (
                      <span className="shrink-0 text-right text-xs font-medium">
                        {[chosen && 'Your answer', option.isCorrect && 'Correct']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {showAnswers && question.explanation ? (
            <p className="mt-4 rounded-md bg-muted/60 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Explanation. </span>
              <MathText text={question.explanation} />
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ScoreRow({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: typeof Check;
  tone: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-2 text-muted-foreground">
        <Icon className={cn('size-4', tone)} aria-hidden />
        {label}
      </dt>
      <dd className="tabular font-semibold">{value}</dd>
    </div>
  );
}

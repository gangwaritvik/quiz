'use client';

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  ImageIcon,
  MinusCircle,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { ErrorState } from '@/components/shared/error-state';
import { MathText } from '@/components/shared/math-text';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/use-api';
import type { QuestionTypeValue } from '@/lib/question-types';
import { QUESTION_TYPE_LABEL } from '@/lib/question-types';
import { cn, formatDateTime } from '@/lib/utils';

interface ReviewQuestion {
  position: number;
  marks: number;
  text: string;
  type: QuestionTypeValue;
  topic: string | null;
  explanation: string | null;
  modelAnswer: string | null;
  maxWords: number | null;
  options: Array<{ id: string; text: string; isCorrect: boolean; imageUrl: string | null }>;
  answer: {
    id: string;
    selectedOptionId: string | null;
    selectedOptionIds: string[];
    textResponse: string | null;
    isCorrect: boolean | null;
    awardedMarks: number | null;
    markedForReview: boolean;
    requiresManualGrading: boolean;
    gradedAt: string | null;
    graderNote: string | null;
    attachments: Array<{ id: string; url: string; name: string }>;
  } | null;
}

interface ReviewData {
  attempt: {
    id: string;
    status: string;
    startedAt: string;
    submittedAt: string | null;
    score: number | null;
    maxScore: number | null;
    percentage: number | null;
    correctCount: number | null;
    incorrectCount: number | null;
    unansweredCount: number | null;
    pendingManualCount: number;
  };
  student: {
    name: string;
    email: string;
    rollNumber: string;
    section: string;
    department: string;
  };
  quiz: { id: string; title: string; subject: string };
  questions: ReviewQuestion[];
}

export function FacultyAttemptReview({ attemptId }: { attemptId: string }) {
  const { data, error, initialLoading, refetch } = useApi<ReviewData>(
    `/api/admin/results/${attemptId}`,
  );

  if (error && !data) {
    return (
      <PageShell>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  if (initialLoading || !data) {
    return (
      <PageShell className="max-w-5xl">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-5 h-9 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        <SkeletonCard className="mt-8 h-64" />
      </PageShell>
    );
  }

  const { attempt, student, quiz, questions } = data;

  return (
    <PageShell className="max-w-5xl">
      <nav aria-label="Back" className="-ml-2 mb-4 flex flex-wrap items-center gap-1">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/quizzes/${quiz.id}`}>
            <ArrowLeft />
            Back to quiz
          </Link>
        </Button>
        <span className="text-muted-foreground" aria-hidden>
          ·
        </span>
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/results">All results</Link>
        </Button>
      </nav>

      <PageHeader
        title={student.name}
        description={
          <>
            Answers to <span className="font-medium text-foreground">{quiz.title}</span> ·{' '}
            <span className="font-mono">{student.rollNumber}</span>
          </>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={`/admin/integrity/${attempt.id}`}>
              <ShieldAlert />
              Integrity report
            </Link>
          </Button>
        }
      />

      <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
        <Fact label="Score">
          <span className="tabular text-2xl font-semibold">
            {attempt.score ?? 0}
            <span className="text-base font-normal text-muted-foreground">
              {' '}
              / {attempt.maxScore ?? 0}
            </span>
          </span>
        </Fact>
        <Fact label="Percentage">
          <span className="tabular text-2xl font-semibold">
            {attempt.percentage === null ? '—' : `${attempt.percentage}%`}
          </span>
        </Fact>
        <Fact label="Marking">
          {attempt.pendingManualCount > 0 ? (
            <Badge variant="warning">
              <Clock3 aria-hidden />
              {attempt.pendingManualCount} awaiting marking
            </Badge>
          ) : (
            <Badge variant="success">
              <CheckCircle2 aria-hidden />
              Fully graded
            </Badge>
          )}
        </Fact>
        <Fact label={attempt.submittedAt ? 'Submitted' : 'Started'}>
          <span className="text-sm font-medium">
            {formatDateTime(attempt.submittedAt ?? attempt.startedAt)}
          </span>
        </Fact>
      </dl>
      <p className="mt-4 text-sm text-muted-foreground">
        {student.email} · Section {student.section} · {student.department}
      </p>

      {questions.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={FileText}
            title="No questions on this attempt"
            description="This paper has no saved question responses."
          />
        </div>
      ) : (
        <div className="mt-8 space-y-5">
          {questions.map((question) => (
            <ReviewQuestionCard key={`${question.position}-${question.text}`} question={question} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 border-t border-border pt-3">
      <dt className="type-eyebrow">{label}</dt>
      <dd className="mt-1.5">{children}</dd>
    </div>
  );
}

/** Small-caps label above each part of a question. */
function PartLabel({ icon: Icon, children }: { icon?: typeof FileText; children: React.ReactNode }) {
  return (
    <p className="type-eyebrow flex items-center gap-1.5">
      {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {children}
    </p>
  );
}

function ReviewQuestionCard({ question }: { question: ReviewQuestion }) {
  const answer = question.answer;
  const selected = new Set(answer?.selectedOptionIds ?? []);
  if (answer?.selectedOptionId) selected.add(answer.selectedOptionId);

  const status = !answer
    ? 'unanswered'
    : answer.requiresManualGrading && !answer.gradedAt
      ? 'pending'
      : answer.isCorrect === true
        ? 'correct'
        : answer.isCorrect === false
          ? 'incorrect'
          : 'unanswered';

  return (
    <article className="rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="tabular font-sans text-sm font-semibold">
            Question {question.position + 1}
          </h2>
          <Badge variant="outline">{QUESTION_TYPE_LABEL[question.type]}</Badge>
          {question.topic ? <Badge variant="secondary">{question.topic}</Badge> : null}
          <span className="text-xs text-muted-foreground">
            {question.marks} mark{question.marks === 1 ? '' : 's'}
          </span>
        </div>
        <AnswerStatus status={status} />
      </header>

      <div className="space-y-5 px-5 pb-6 pt-3 sm:px-6">
        <MathText as="p" text={question.text} className="max-w-prose text-base leading-relaxed" />

        {question.options.length > 0 ? (
          <div>
            <PartLabel>Options and answer key</PartLabel>
            <ul className="mt-2 space-y-1">
              {question.options.map((option) => {
                const chosen = selected.has(option.id);
                const Mark = option.isCorrect ? Check : chosen ? X : Circle;
                return (
                  <li
                    key={option.id}
                    className={cn(
                      'flex items-start gap-3 rounded-md px-3 py-2.5 text-sm',
                      option.isCorrect && 'bg-success-subtle/60',
                      chosen && !option.isCorrect && 'bg-danger-subtle/60',
                    )}
                  >
                    <Mark
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        option.isCorrect
                          ? 'text-success'
                          : chosen
                            ? 'text-danger'
                            : 'text-muted-foreground/50',
                      )}
                      strokeWidth={option.isCorrect || chosen ? 2.5 : 1.5}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <MathText text={option.text || 'Image option'} className="leading-relaxed" />
                      {option.imageUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element -- authorised route */
                        <img
                          loading="lazy"
                          decoding="async"
                          src={option.imageUrl}
                          alt="Option diagram"
                          className="mt-2 max-h-40 rounded-sm border border-border bg-white object-contain"
                        />
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-x-3 gap-y-1 text-xs font-medium">
                      {chosen ? (
                        <span className={option.isCorrect ? 'text-success' : 'text-danger'}>
                          Student selected
                        </span>
                      ) : null}
                      {option.isCorrect ? <span className="text-success">Correct</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {answer?.textResponse?.trim() ? (
          <div>
            <PartLabel icon={FileText}>Student&apos;s written answer</PartLabel>
            <div className="mt-2 rounded-md bg-muted/50 px-4 py-3.5">
              <p className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed">
                {answer.textResponse}
              </p>
              {question.maxWords ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Suggested limit: {question.maxWords} words
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {answer?.attachments.length ? (
          <div>
            <PartLabel icon={ImageIcon}>Uploaded answer sheets</PartLabel>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {answer.attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="overflow-hidden rounded-md border border-border transition-colors duration-fast hover:border-primary"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- authorised route */}
                  <img
                    loading="lazy"
                    decoding="async"
                    src={attachment.url}
                    alt={attachment.name}
                    className="max-h-72 w-full bg-white object-contain"
                  />
                  <span className="block truncate border-t border-border px-3 py-2 text-xs text-muted-foreground">
                    {attachment.name}
                  </span>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {!answer?.textResponse?.trim() && !answer?.attachments.length && question.options.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">No response submitted.</p>
        ) : null}

        {question.modelAnswer ? (
          <div className="rounded-md border border-primary/25 px-3 py-2.5">
            <PartLabel>Faculty rubric / model answer</PartLabel>
            <MathText
              text={question.modelAnswer}
              className="mt-1.5 block max-w-prose text-sm leading-relaxed"
            />
          </div>
        ) : null}

        {answer?.graderNote ? (
          <div className="rounded-md border border-warning/40 px-3 py-2.5">
            <PartLabel>Faculty feedback</PartLabel>
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed">{answer.graderNote}</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function AnswerStatus({ status }: { status: 'correct' | 'incorrect' | 'pending' | 'unanswered' }) {
  const config = {
    correct: { label: 'Correct', icon: CheckCircle2, variant: 'success' },
    incorrect: { label: 'Incorrect', icon: XCircle, variant: 'danger' },
    pending: { label: 'Awaiting marking', icon: Clock3, variant: 'warning' },
    unanswered: { label: 'Unanswered', icon: MinusCircle, variant: 'muted' },
  } as const;
  const { label, icon: Icon, variant } = config[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

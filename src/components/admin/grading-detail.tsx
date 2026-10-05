'use client';

import { ArrowLeft, CheckCircle2, Clock3, FileText, ImageIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { ErrorState } from '@/components/shared/error-state';
import { MathText } from '@/components/shared/math-text';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { QUESTION_TYPE_LABEL, type QuestionTypeValue } from '@/lib/question-types';
import { cn, formatDateTime } from '@/lib/utils';

interface GradableAnswer {
  answerId: string;
  position: number;
  maxMarks: number;
  questionText: string;
  questionType: QuestionTypeValue;
  topic: string | null;
  questionImageUrl: string | null;
  modelAnswer: string | null;
  maxWords: number | null;
  textResponse: string | null;
  attachments: Array<{ id: string; url: string; name: string }>;
  awardedMarks: number | null;
  graderNote: string | null;
  gradedAt: string | null;
  gradedBy: string | null;
}

interface GradingDetailData {
  attempt: {
    id: string;
    submittedAt: string | null;
    score: number | null;
    maxScore: number | null;
    percentage: number | null;
    pendingCount: number;
    completedAt: string | null;
  };
  student: {
    name: string;
    email: string;
    rollNumber: string;
    section: string;
    department: string;
  };
  quiz: { id: string; title: string; subject: string; releaseResults: boolean };
  answers: GradableAnswer[];
}

/** Just what "Save & next" needs from GET /api/admin/grading (the queue's endpoint). */
interface NextQueue {
  attempts: Array<{ attemptId: string; pendingCount: number }>;
}

export function GradingDetail({ attemptId }: { attemptId: string }) {
  const { data, error, initialLoading, refetch } = useApi<GradingDetailData>(
    `/api/admin/grading/${attemptId}`,
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
      <PageShell>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-5 h-9 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        <SkeletonCard className="mt-8 h-80" />
      </PageShell>
    );
  }

  const { attempt, student, quiz, answers } = data;
  const markedCount = answers.filter((answer) => answer.gradedAt !== null).length;

  return (
    <PageShell>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
        <Link href="/admin/grading">
          <ArrowLeft />
          Back to marking queue
        </Link>
      </Button>

      <PageHeader
        title={student.name}
        description={
          <>
            <span className="font-mono">{student.rollNumber}</span> · Section {student.section} ·{' '}
            <span className="font-medium text-foreground">{quiz.title}</span>
          </>
        }
      />

      <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
        <Fact
          label="Marked so far"
          value={`${attempt.score ?? 0} / ${attempt.maxScore ?? 0}`}
          hint={
            attempt.pendingCount > 0
              ? 'Provisional — outstanding answers score nothing yet'
              : 'Final'
          }
        />
        <Fact
          label="Outstanding"
          value={String(attempt.pendingCount)}
          hint={attempt.pendingCount === 0 ? 'Everything is marked' : 'Answers awaiting your mark'}
        />
        <Fact
          label="Submitted"
          value={attempt.submittedAt ? formatDateTime(attempt.submittedAt) : '—'}
          small
        />
        <Fact
          label="Results"
          value={quiz.releaseResults ? 'Released' : 'Withheld'}
          hint={
            quiz.releaseResults ? 'Students can see their marks' : 'Students cannot see marks yet'
          }
          small
        />
      </dl>

      {answers.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={CheckCircle2}
            tone="success"
            title="Nothing to mark on this attempt"
            description="Every question on this paper was marked automatically at submission."
          />
        </div>
      ) : (
        <>
          {/* Progress through this paper, and a way to jump between answers. */}
          <div className="mt-8 flex flex-col gap-3 border-y border-border py-4 md:flex-row md:items-center md:gap-6">
            <div className="flex min-w-0 items-center gap-3 md:w-72">
              <Progress
                value={markedCount}
                max={answers.length}
                className="h-1.5 flex-1"
                aria-label={`${markedCount} of ${answers.length} answers marked`}
              />
              <span className="tabular shrink-0 text-sm text-muted-foreground">
                {markedCount} of {answers.length} marked
              </span>
            </div>
            {answers.length > 1 ? (
              <nav aria-label="Answers on this paper" className="min-w-0 flex-1">
                <ul className="flex flex-wrap gap-2">
                  {answers.map((answer) => (
                    <li key={answer.answerId}>
                      <a
                        href={`#answer-${answer.answerId}`}
                        className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm transition-colors duration-fast hover:bg-accent"
                      >
                        {answer.gradedAt ? (
                          <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                        ) : (
                          <Clock3 className="size-3.5 text-warning" aria-hidden />
                        )}
                        <span className="tabular">Q{answer.position + 1}</span>
                        <span className="sr-only">
                          {answer.gradedAt ? ', marked' : ', awaiting mark'}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </div>

          <div className="mt-6 space-y-6">
            {answers.map((answer) => (
              <AnswerCard
                key={answer.answerId}
                answer={answer}
                remainingAfterSave={Math.max(0, attempt.pendingCount - (answer.gradedAt ? 0 : 1))}
                attemptId={attemptId}
                onGraded={() => void refetch()}
              />
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}

function Fact({
  label,
  value,
  hint,
  small = false,
}: {
  label: string;
  value: string;
  hint?: string;
  small?: boolean;
}) {
  return (
    <div className="min-w-0 border-t border-border pt-3">
      <dt className="type-eyebrow">{label}</dt>
      <dd
        className={cn(
          'tabular mt-1.5 text-foreground',
          small ? 'text-sm font-medium' : 'text-2xl font-semibold leading-none',
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="mt-1.5 text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

function AnswerCard({
  answer,
  attemptId,
  remainingAfterSave,
  onGraded,
}: {
  answer: GradableAnswer;
  attemptId: string;
  /** Unmarked answers left on this attempt once this one is saved. */
  remainingAfterSave: number;
  onGraded: () => void;
}) {
  const router = useRouter();
  const [marks, setMarks] = React.useState(
    answer.awardedMarks === null ? '' : String(answer.awardedMarks),
  );
  const [note, setNote] = React.useState(answer.graderNote ?? '');
  const [saving, setSaving] = React.useState(false);
  const graded = answer.gradedAt !== null;

  const submit = async (andNext = false) => {
    const value = Number.parseFloat(marks);
    if (!Number.isFinite(value) || value < 0 || value > answer.maxMarks) {
      toast.error(`Enter a mark between 0 and ${answer.maxMarks}.`);
      return;
    }

    setSaving(true);
    try {
      await apiFetch(`/api/admin/grading/answers/${answer.answerId}`, {
        method: 'POST',
        body: { awardedMarks: value, note: note.trim() },
      });
      toast.success(graded ? 'Mark updated.' : 'Answer marked.');
      onGraded();

      if (andNext) {
        const queue = await apiFetch<NextQueue>('/api/admin/grading?page=1&pageSize=20');
        const next = queue.attempts.find((a) => a.attemptId !== attemptId && a.pendingCount > 0);
        if (next) {
          router.push(`/admin/grading/${next.attemptId}`);
        } else {
          toast.success('All caught up.');
          router.push('/admin/grading');
        }
      }
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not save that mark.',
      );
    } finally {
      setSaving(false);
    }
  };

  const words = answer.textResponse?.trim()
    ? answer.textResponse.trim().split(/\s+/).length
    : 0;

  const headingId = `answer-${answer.answerId}-heading`;

  return (
    <article
      id={`answer-${answer.answerId}`}
      aria-labelledby={headingId}
      className="scroll-mt-28 rounded-lg border border-border bg-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={headingId} className="tabular font-sans text-sm font-semibold">
            Question {answer.position + 1}
          </h2>
          <Badge variant="outline">{QUESTION_TYPE_LABEL[answer.questionType]}</Badge>
          {answer.topic ? <Badge variant="secondary">{answer.topic}</Badge> : null}
          <span className="tabular text-xs text-muted-foreground">
            {answer.maxMarks} mark{answer.maxMarks === 1 ? '' : 's'}
          </span>
        </div>
        {graded ? (
          <Badge variant="success">
            <CheckCircle2 aria-hidden />
            Marked
          </Badge>
        ) : (
          <Badge variant="warning">
            <Clock3 aria-hidden />
            Awaiting mark
          </Badge>
        )}
      </header>

      {/* Response on the left, rubric and mark entry on the right: on a wide
          screen the marker never scrolls between reading and scoring. */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
        <div className="min-w-0 space-y-6 p-5 sm:p-6">
          <div>
            <MathText
              as="p"
              text={answer.questionText}
              className="max-w-prose text-base leading-relaxed text-foreground"
            />
            {answer.questionImageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- authorised route */
              <img
                loading="lazy"
                decoding="async"
                src={answer.questionImageUrl}
                alt="Diagram accompanying this question"
                className="mt-4 max-h-64 rounded-md border border-border bg-white object-contain"
              />
            ) : null}
          </div>

          <div>
            <p className="type-eyebrow flex items-center gap-1.5">
              {answer.attachments.length > 0 ? (
                <ImageIcon className="size-3.5" aria-hidden />
              ) : (
                <FileText className="size-3.5" aria-hidden />
              )}
              The student&apos;s answer
            </p>

            {answer.textResponse?.trim() ? (
              <div className="mt-2 rounded-md border border-border px-4 py-4 sm:px-5">
                <p className="max-w-prose whitespace-pre-wrap text-base leading-relaxed text-foreground">
                  {answer.textResponse}
                </p>
                <p className="tabular mt-4 text-xs text-muted-foreground">
                  {words} {words === 1 ? 'word' : 'words'}
                  {answer.maxWords ? ` · suggested limit ${answer.maxWords}` : ''}
                </p>
              </div>
            ) : null}

            {answer.attachments.length > 0 ? (
              <ul className="mt-2 grid gap-3 sm:grid-cols-2">
                {answer.attachments.map((attachment, index) => (
                  <li key={attachment.id} className="rounded-md border border-border">
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-t-md"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- authorised route */}
                      <img
                        loading="lazy"
                        decoding="async"
                        src={attachment.url}
                        alt={`Uploaded answer, page ${index + 1}`}
                        className="max-h-80 w-full rounded-t-md bg-white object-contain"
                      />
                    </a>
                    <p className="truncate border-t border-border px-3 py-2 text-xs text-muted-foreground">
                      {attachment.name} · open full size
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}

            {!answer.textResponse?.trim() && answer.attachments.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                The student left this question blank.
              </p>
            ) : null}
          </div>
        </div>

        <aside
          aria-label={`Marking for question ${answer.position + 1}`}
          className="rounded-b-lg border-t border-border bg-muted/40 p-5 sm:p-6 lg:rounded-bl-none lg:border-l lg:border-t-0"
        >
          {/* Sticky so a long answer can be read while the rubric stays in view. */}
          <div className="space-y-6 lg:sticky lg:top-28">
            <div>
              <p className="type-eyebrow">Model answer</p>
              {answer.modelAnswer ? (
                <MathText
                  text={answer.modelAnswer}
                  className="mt-1.5 block text-sm leading-relaxed text-foreground"
                />
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  No model answer was written for this question.
                </p>
              )}
            </div>

            <form
              className="space-y-4 border-t border-border pt-5"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor={`marks-${answer.answerId}`} required>
                  Marks (out of {answer.maxMarks})
                </Label>
                <Input
                  id={`marks-${answer.answerId}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={answer.maxMarks}
                  step={0.5}
                  value={marks}
                  onChange={(event) => setMarks(event.target.value)}
                  className="tabular w-32 text-base"
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  {[
                    { label: '0', value: 0 },
                    { label: `Half marks ${answer.maxMarks / 2}`, value: answer.maxMarks / 2 },
                    { label: `Full marks ${answer.maxMarks}`, value: answer.maxMarks },
                  ].map((preset) => (
                    <Button
                      key={preset.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setMarks(String(preset.value))}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`note-${answer.answerId}`}>Feedback for the student</Label>
                <Textarea
                  id={`note-${answer.answerId}`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  placeholder="Optional. Shown with their result once results are released."
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  variant={remainingAfterSave === 0 ? 'outline' : 'default'}
                  loading={saving}
                  className="flex-1"
                >
                  {graded ? 'Update mark' : 'Save mark'}
                </Button>
                <Button
                  type="button"
                  variant={remainingAfterSave === 0 ? 'default' : 'outline'}
                  loading={saving}
                  className="flex-1"
                  onClick={() => void submit(true)}
                >
                  Save &amp; next
                </Button>
              </div>

              {graded && answer.gradedBy ? (
                <p className="text-xs text-muted-foreground">
                  Marked by {answer.gradedBy}
                  {answer.gradedAt ? ` on ${formatDateTime(answer.gradedAt)}` : ''}.
                </p>
              ) : null}
            </form>
          </div>
        </aside>
      </div>
    </article>
  );
}

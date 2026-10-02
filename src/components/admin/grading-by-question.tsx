'use client';

import { ArrowLeft, CheckCircle2, Clock3, Eye, EyeOff, FileText, ImageIcon } from 'lucide-react';
import Link from 'next/link';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { MAX_ANSWERS, nextQuestionWithPending, nextUnmarked } from '@/lib/grading-by-question';
import { QUESTION_TYPE_LABEL, type QuestionTypeValue } from '@/lib/question-types';
import { cn, formatDateTime } from '@/lib/utils';

const API = '/api/admin/grading/by-question';

interface QuizRow {
  id: string;
  title: string;
  attemptCount: number;
}

interface QuestionRow {
  questionId: string;
  order: number;
  text: string;
  type: QuestionTypeValue;
  maxMarks: number;
  pending: number;
  total: number;
}

interface MarkAnswer {
  answerId: string;
  attemptId: string;
  blindLabel: string;
  student: { rollNumber: string; name: string };
  maxMarks: number;
  textResponse: string | null;
  attachments: Array<{ id: string; url: string; name: string }>;
  awardedMarks: number | null;
  graderNote: string | null;
  gradedAt: string | null;
  submittedAt: string | null;
}

interface AnswersResponse {
  question: {
    id: string;
    text: string;
    type: QuestionTypeValue;
    topic: string | null;
    imageUrl: string | null;
    modelAnswer: string | null;
    maxWords: number | null;
  };
  total: number;
  pending: number;
  truncated: boolean;
  answers: MarkAnswer[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Mark by question.
 *
 * Teachers mark a paper question by question, not student by student: it keeps
 * one standard in mind and, with names hidden, keeps who wrote it out of the
 * judgement. This view walks one question across every student, one answer at
 * a time. Marks are written through the same endpoint as the per-attempt view.
 */
export function GradingByQuestion({ initialQuizId }: { initialQuizId?: string }) {
  const quizzesApi = useApi<{ quizzes: QuizRow[] }>('/api/admin/quizzes');
  const pendingApi = useApi<{ quizzes: Array<{ quizId: string; pending: number }> }>(API);
  const [picked, setPicked] = React.useState<string | null>(initialQuizId ?? null);

  const pendingFor = (id: string) =>
    pendingApi.data?.quizzes.find((q) => q.quizId === id)?.pending ?? 0;

  const loadError = (!quizzesApi.data && quizzesApi.error) || (!pendingApi.data && pendingApi.error);
  const ready = Boolean(quizzesApi.data && pendingApi.data);

  // A quiz nobody has attempted has nothing to mark.
  const quizzes = (quizzesApi.data?.quizzes ?? []).filter((quiz) => quiz.attemptCount > 0);

  // Settle on a quiz once, on arrival: ?quizId, else the first with work left.
  // Done in render, not derived each time, so finishing a quiz's last answer
  // does not make the page jump to a different quiz underneath the marker.
  if (ready && !quizzes.some((quiz) => quiz.id === picked)) {
    const fallback = (quizzes.find((quiz) => pendingFor(quiz.id) > 0) ?? quizzes[0])?.id ?? null;
    if (fallback !== picked) setPicked(fallback);
  }
  const quizId = ready ? picked : null;

  const onMarked = (markedQuizId: string) =>
    pendingApi.setData((prev) =>
      prev
        ? {
            quizzes: prev.quizzes.map((q) =>
              q.quizId === markedQuizId ? { ...q, pending: Math.max(0, q.pending - 1) } : q,
            ),
          }
        : prev,
    );

  return (
    <PageShell>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
        <Link href="/admin/grading">
          <ArrowLeft />
          Back to marking queue
        </Link>
      </Button>

      <PageHeader
        title="Mark by question"
        description="Mark one question across every student before moving to the next. Student names stay hidden until you reveal them."
      />

      {loadError ? (
        <div className="mt-6">
          <ErrorState
            error={loadError}
            onRetry={() => {
              void quizzesApi.refetch();
              void pendingApi.refetch();
            }}
          />
        </div>
      ) : !ready ? (
        <div className="mt-6">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="mt-2 h-10 w-full max-w-md" />
          <SkeletonCard className="mt-8 h-80" />
        </div>
      ) : quizId === null ? (
        <div className="mt-6">
          <EmptyState
            icon={CheckCircle2}
            tone="success"
            title="Nothing to mark"
            description="Once students submit a quiz with descriptive or image answers, you can mark it here a question at a time."
          />
        </div>
      ) : (
        <>
          <div className="mt-6 max-w-md space-y-1.5">
            <Label htmlFor="quiz-select">Quiz</Label>
            <Select value={quizId} onValueChange={setPicked}>
              <SelectTrigger id="quiz-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {quizzes.map((quiz) => {
                  const n = pendingFor(quiz.id);
                  return (
                    <SelectItem key={quiz.id} value={quiz.id}>
                      {n > 0 ? `${quiz.title} (${n} to mark)` : quiz.title}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <QuizPane key={quizId} quizId={quizId} onMarked={() => onMarked(quizId)} />
        </>
      )}
    </PageShell>
  );
}

/** One quiz: its question tabs, and the marking pane for the selected question. */
function QuizPane({ quizId, onMarked }: { quizId: string; onMarked: () => void }) {
  const { data, error, refetch, setData } = useApi<{ questions: QuestionRow[] }>(
    `${API}?quizId=${quizId}`,
  );
  const [pickedQuestion, setPickedQuestion] = React.useState<string | null>(null);

  if (error && !data) {
    return (
      <div className="mt-6">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mt-8">
        <Skeleton className="h-9 w-full max-w-lg" />
        <SkeletonCard className="mt-6 h-80" />
      </div>
    );
  }

  const { questions } = data;

  if (questions.length === 0) {
    return (
      <div className="mt-8">
        <EmptyState
          icon={CheckCircle2}
          tone="success"
          title="Nothing to mark for this quiz"
          description="It has no descriptive or image answers yet. Everything else is marked automatically at submission."
        />
      </div>
    );
  }

  // Settle on a question once (first with work left); see GradingByQuestion.
  const current = questions.find((q) => q.questionId === pickedQuestion);
  if (!current) {
    setPickedQuestion((questions.find((q) => q.pending > 0) ?? questions[0]!).questionId);
    return null;
  }

  const handleMarked = () => {
    setData((prev) =>
      prev
        ? {
            questions: prev.questions.map((q) =>
              q.questionId === current.questionId ? { ...q, pending: Math.max(0, q.pending - 1) } : q,
            ),
          }
        : prev,
    );
    onMarked();
  };

  return (
    <div className="mt-8">
      <Tabs value={current.questionId} onValueChange={setPickedQuestion}>
        <TabsList aria-label="Questions to mark">
          {questions.map((q) => (
            <TabsTrigger key={q.questionId} value={q.questionId}>
              <span className="tabular">Q{q.order}</span>
              {q.pending > 0 ? (
                <Badge variant="warning" className="tabular">
                  {q.pending}
                  <span className="sr-only"> to mark</span>
                </Badge>
              ) : (
                <>
                  <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                  <span className="sr-only">all marked</span>
                </>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <QuestionMarker
        key={current.questionId}
        quizId={quizId}
        question={current}
        nextQuestion={nextQuestionWithPending(questions, current.questionId)}
        onSelectQuestion={setPickedQuestion}
        onMarked={handleMarked}
      />
    </div>
  );
}

/** Loads one question's answers (all of them, so labels and progress are stable). */
function QuestionMarker({
  quizId,
  question,
  nextQuestion,
  onSelectQuestion,
  onMarked,
}: {
  quizId: string;
  question: QuestionRow;
  nextQuestion: QuestionRow | null;
  onSelectQuestion: (questionId: string) => void;
  onMarked: () => void;
}) {
  const { data, error, refetch } = useApi<AnswersResponse>(
    `${API}?quizId=${quizId}&questionId=${question.questionId}&include=all`,
  );

  if (error && !data) {
    return (
      <div className="mt-6">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!data) {
    return <SkeletonCard className="mt-6 h-80" />;
  }

  if (data.answers.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={CheckCircle2}
          tone="success"
          title="Nothing to mark for this question"
          description="No student has submitted an answer to it yet."
        />
      </div>
    );
  }

  return (
    <MarkingPane
      data={data}
      nextQuestion={nextQuestion}
      onSelectQuestion={onSelectQuestion}
      onMarked={onMarked}
    />
  );
}

function MarkingPane({
  data,
  nextQuestion,
  onSelectQuestion,
  onMarked,
}: {
  data: AnswersResponse;
  nextQuestion: QuestionRow | null;
  onSelectQuestion: (questionId: string) => void;
  onMarked: () => void;
}) {
  const [answers, setAnswers] = React.useState(data.answers);
  const [currentId, setCurrentId] = React.useState<string | null>(
    () => data.answers[nextUnmarked(data.answers, -1)]?.answerId ?? null,
  );
  const [announcement, setAnnouncement] = React.useState('');
  // Focus moves to the mark box only once the marker has acted; on arrival it
  // would pull focus out of the question tabs they may still be arrowing along.
  const [autoFocus, setAutoFocus] = React.useState(false);

  const total = answers.length;
  const index = answers.findIndex((a) => a.answerId === currentId);
  const current = index >= 0 ? answers[index] : undefined;
  const marked = answers.filter((a) => a.gradedAt !== null).length;
  const left = total - marked;
  const canSkip = index >= 0 && nextUnmarked(answers, index) !== -1;

  const goTo = (answer: MarkAnswer, prefix = '') => {
    setAutoFocus(true);
    setCurrentId(answer.answerId);
    setAnnouncement(`${prefix} ${answer.blindLabel} of ${total}.`.trim());
  };

  const save = async (awardedMarks: number, note: string) => {
    if (!current) return;
    await apiFetch(`/api/admin/grading/answers/${current.answerId}`, {
      method: 'POST',
      body: { awardedMarks, note },
    });

    const wasPending = current.gradedAt === null;
    const updated = answers.map((a) =>
      a.answerId === current.answerId
        ? { ...a, awardedMarks, graderNote: note || null, gradedAt: new Date().toISOString() }
        : a,
    );
    setAnswers(updated);
    if (wasPending) onMarked();

    const next = nextUnmarked(updated, index);
    setAutoFocus(true);
    setCurrentId(updated[next]?.answerId ?? null);
    setAnnouncement(
      next === -1
        ? 'Saved. All answers to this question are marked.'
        : `Saved. ${updated[next]!.blindLabel} of ${total}.`,
    );
  };

  return (
    <div className="mt-6">
      <div className="flex flex-col gap-3 border-y border-border py-4 md:flex-row md:items-center md:gap-6">
        <div className="flex min-w-0 items-center gap-3 md:w-72">
          <Progress
            value={marked}
            max={total}
            className="h-1.5 flex-1"
            aria-label={`${marked} of ${total} answers marked`}
          />
          <span className="tabular shrink-0 text-sm text-muted-foreground">
            {marked} of {total} marked
          </span>
        </div>
        {total > 1 ? (
          <nav aria-label="Answers to this question" className="min-w-0 flex-1">
            <ul className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
              {answers.map((answer, i) => (
                <li key={answer.answerId}>
                  <button
                    type="button"
                    aria-current={answer.answerId === currentId ? 'true' : undefined}
                    onClick={() => goTo(answer)}
                    className={cn(
                      'inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-md border px-3 text-sm [@media(pointer:coarse)]:min-h-11',
                      'transition-colors duration-fast hover:bg-accent',
                      answer.answerId === currentId
                        ? 'border-primary bg-accent font-medium'
                        : 'border-border bg-card',
                    )}
                  >
                    {answer.gradedAt ? (
                      <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                    ) : (
                      <Clock3 className="size-3.5 text-warning" aria-hidden />
                    )}
                    <span className="tabular">{i + 1}</span>
                    <span className="sr-only">
                      {`Answer ${i + 1}`}
                      {answer.gradedAt ? ', marked' : ', awaiting mark'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>

      {/* Polite, always mounted: a live region must exist before its text changes. */}
      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-muted-foreground">
        {announcement}
      </p>

      {data.truncated ? (
        <p className="mt-1 text-sm text-warning">
          Showing the first {MAX_ANSWERS} answers to this question.
        </p>
      ) : null}

      <div className="mt-3">
        {current ? (
          <AnswerPane
            key={current.answerId}
            answer={current}
            number={index + 1}
            total={total}
            left={left}
            question={data.question}
            canSkip={canSkip}
            autoFocus={autoFocus}
            onSave={save}
            onSkip={() => {
              const next = answers[nextUnmarked(answers, index)];
              if (next) goTo(next, 'Skipped.');
            }}
          />
        ) : (
          <EmptyState
            icon={CheckCircle2}
            tone="success"
            title="All answers to this question are marked"
            description={
              nextQuestion
                ? `Next up is Q${nextQuestion.order}, with ${plural(nextQuestion.pending, 'answer')} left to mark.`
                : 'Nothing else on this quiz is waiting for a mark.'
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {nextQuestion ? (
                  <Button onClick={() => onSelectQuestion(nextQuestion.questionId)}>
                    Go to Q{nextQuestion.order}
                  </Button>
                ) : null}
                <Button asChild variant="outline">
                  <Link href="/admin/grading">Back to marking queue</Link>
                </Button>
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

function AnswerPane({
  answer,
  number,
  total,
  left,
  question,
  canSkip,
  autoFocus,
  onSave,
  onSkip,
}: {
  answer: MarkAnswer;
  number: number;
  total: number;
  left: number;
  question: AnswersResponse['question'];
  canSkip: boolean;
  autoFocus: boolean;
  onSave: (awardedMarks: number, note: string) => Promise<void>;
  onSkip: () => void;
}) {
  const [marks, setMarks] = React.useState(
    answer.awardedMarks === null ? '' : String(answer.awardedMarks),
  );
  const [note, setNote] = React.useState(answer.graderNote ?? '');
  const [revealed, setRevealed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const marksRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!autoFocus) return;
    marksRef.current?.focus();
    marksRef.current?.select();
    // Runs once per answer: the pane is keyed by answer id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const graded = answer.gradedAt !== null;
  const words = answer.textResponse?.trim() ? answer.textResponse.trim().split(/\s+/).length : 0;

  const submit = async () => {
    if (saving) return;
    const value = Number.parseFloat(marks);
    if (!Number.isFinite(value) || value < 0 || value > answer.maxMarks) {
      setProblem(`Enter a mark between 0 and ${answer.maxMarks}.`);
      marksRef.current?.focus();
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      await onSave(value, note.trim());
    } catch (caught) {
      toast.error(caught instanceof ApiClientError ? caught.message : 'We could not save that mark.');
      setSaving(false);
    }
  };

  return (
    <article aria-labelledby="answer-heading" className="rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="answer-heading" className="tabular font-sans text-sm font-semibold">
            Answer {number} of {total}
          </h2>
          <Badge variant="outline">{QUESTION_TYPE_LABEL[question.type]}</Badge>
          {question.topic ? <Badge variant="secondary">{question.topic}</Badge> : null}
          <span className="tabular text-xs text-muted-foreground">
            {plural(answer.maxMarks, 'mark')}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="tabular text-xs text-muted-foreground">{left} left to mark</span>
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
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
        <div className="min-w-0 space-y-6 p-5 sm:p-6">
          <div>
            <MathText
              as="p"
              text={question.text}
              className="max-w-prose text-base leading-relaxed text-foreground"
            />
            {question.imageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- authorised route */
              <img
                loading="lazy"
                decoding="async"
                src={question.imageUrl}
                alt="Diagram accompanying this question"
                className="mt-4 max-h-64 rounded-md border border-border bg-white object-contain"
              />
            ) : null}
          </div>

          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-1.5">
            <p className="min-w-0 text-sm">
              <span className="type-eyebrow mr-2">Student</span>
              {revealed ? (
                <>
                  <span className="font-medium">{answer.student.name}</span>{' '}
                  <span className="font-mono text-xs text-muted-foreground">
                    {answer.student.rollNumber}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Hidden while you mark</span>
              )}
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRevealed((v) => !v)}>
              {revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {revealed ? 'Hide student' : 'Reveal student'}
            </Button>
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
                  {plural(words, 'word')}
                  {question.maxWords ? ` · suggested limit ${question.maxWords}` : ''}
                </p>
              </div>
            ) : null}

            {answer.attachments.length > 0 ? (
              <ul className="mt-2 grid gap-3 sm:grid-cols-2">
                {answer.attachments.map((attachment, i) => (
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
                        alt={`Uploaded answer, page ${i + 1}`}
                        className="max-h-80 w-full rounded-t-md bg-white object-contain"
                      />
                    </a>
                    <p className="truncate border-t border-border px-3 py-2 text-xs text-muted-foreground">
                      {revealed ? `${attachment.name} · ` : ''}open full size
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
          aria-label={`Marking for ${answer.blindLabel}`}
          className="rounded-b-lg border-t border-border bg-muted/40 p-5 sm:p-6 lg:rounded-bl-none lg:border-l lg:border-t-0"
        >
          <div className="space-y-6 lg:sticky lg:top-28">
            <div>
              <p className="type-eyebrow">Model answer</p>
              {question.modelAnswer ? (
                <MathText
                  text={question.modelAnswer}
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
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void submit();
                }
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="marks-input" required>
                  Marks (out of {answer.maxMarks})
                </Label>
                <Input
                  ref={marksRef}
                  id="marks-input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={answer.maxMarks}
                  step={0.5}
                  value={marks}
                  invalid={problem !== null}
                  aria-describedby={problem ? 'marks-problem' : undefined}
                  onChange={(event) => {
                    setMarks(event.target.value);
                    setProblem(null);
                  }}
                  className="tabular w-32 text-base"
                />
                {problem ? (
                  <p id="marks-problem" role="alert" className="text-sm text-danger">
                    {problem}
                  </p>
                ) : null}
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
                      onClick={() => {
                        setMarks(String(preset.value));
                        setProblem(null);
                        marksRef.current?.focus();
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="note-input">Feedback for the student</Label>
                <Textarea
                  id="note-input"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  placeholder="Optional. Shown with their result once results are released."
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={saving} className="flex-1">
                  Save &amp; next
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving || !canSkip}
                  className="flex-1"
                  onClick={onSkip}
                >
                  Skip
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Ctrl+Enter (⌘+Enter on Mac) saves and moves to the next answer.
                {graded && answer.gradedAt ? ` Marked ${formatDateTime(answer.gradedAt)}.` : ''}
              </p>
            </form>
          </div>
        </aside>
      </div>
    </article>
  );
}

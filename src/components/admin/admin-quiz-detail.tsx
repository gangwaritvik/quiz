'use client';

import {
  Archive,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  FileQuestion,
  Lock,
  Pencil,
  Save,
  ScrollText,
  Send,
  ShieldAlert,
  Shuffle,
  TimerOff,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import { AssignStudentsDialog } from '@/components/admin/assign-students-dialog';
import { RetakeButton } from '@/components/admin/retake-button';
import { ItemAnalysis } from '@/components/admin/item-analysis';
import { ExtraTimePanel } from '@/components/admin/extra-time-panel';
import {
  InstantQuestionBuilder,
  blankQuestion,
  fromSavedQuestion,
  toApiQuestion,
  validateQuestion,
  type InstantQuestion,
  type SavedQuestion,
} from '@/components/admin/instant-question-builder';
import { type QuizMarkingValue } from '@/components/admin/marking-settings';
import { QuizEditDialog } from '@/components/admin/quiz-edit-dialog';
import { MathText } from '@/components/shared/math-text';
import { ErrorState } from '@/components/shared/error-state';
import { IntegrityBadge, type IntegrityStatus } from '@/components/shared/integrity-badge';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { formatDateTime } from '@/lib/utils';

interface QuizDetail {
  quiz: {
    id: string;
    title: string;
    description: string | null;
    subject: string;
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    sourceMode: 'POOL' | 'FIXED';
    questionCount: number;
    totalMarks: number;
    durationMinutes: number;
    startsAt: string;
    endsAt: string;
    difficultyMix: { easy: number; medium: number; hard: number };
    security: Record<string, boolean>;
    marking: QuizMarkingValue;
  };
  /** True only for a fixed paper no student has been served yet. */
  editable: boolean;
  questions: SavedQuestion[];
  assignments: Array<{
    studentId: string;
    name: string;
    rollNumber: string;
    section: string;
    extraAttempts: number;
  }>;
  attempts: Array<{
    id: string;
    studentId: string;
    attemptNumber: number;
    studentName: string;
    rollNumber: string;
    status: string;
    score: number | null;
    maxScore: number | null;
    percentage: number | null;
    submittedAt: string | null;
    integrityScore: number | null;
    integrityStatus: IntegrityStatus | null;
  }>;
}

export function AdminQuizDetail({ quizId }: { quizId: string }) {
  const { data, error, initialLoading, refetch } = useApi<QuizDetail>(
    `/api/admin/quizzes/${quizId}`,
  );
  const [updating, setUpdating] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [assigning, setAssigning] = React.useState(false);

  const publish = async () => {
    setUpdating(true);
    try {
      await apiFetch(`/api/admin/quizzes/${quizId}`, {
        method: 'PATCH',
        body: { status: 'PUBLISHED' },
      });
      toast.success('Quiz published.');
      await refetch();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not publish this quiz.',
      );
    } finally {
      setUpdating(false);
    }
  };

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
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-5 h-9 w-full max-w-md" />
        <Skeleton className="mt-3 h-4 w-full max-w-lg" />
        <Skeleton className="mt-8 h-20 w-full rounded-lg" />
        <Skeleton className="mt-8 h-72 rounded-lg" />
      </PageShell>
    );
  }

  const { quiz, assignments, attempts, questions, editable } = data;
  const graded = attempts.filter((a) => a.percentage !== null);
  const average =
    graded.length > 0
      ? Math.round((graded.reduce((sum, a) => sum + (a.percentage ?? 0), 0) / graded.length) * 10) /
        10
      : null;
  const flagged = attempts.filter((a) => a.integrityStatus && a.integrityStatus !== 'NORMAL');

  // Per student: how many attempts, whether one is live, whether an extra attempt
  // is waiting, and which finished attempt is their newest (the retake control sits on it).
  const extraByStudent = new Map(assignments.map((a) => [a.studentId, a.extraAttempts]));
  const madeByStudent = new Map<string, number>();
  const liveStudents = new Set<string>();
  const newestFinished = new Map<string, string>();
  for (const attempt of attempts) {
    madeByStudent.set(attempt.studentId, (madeByStudent.get(attempt.studentId) ?? 0) + 1);
    if (attempt.status === 'IN_PROGRESS') liveStudents.add(attempt.studentId);
    else if (!newestFinished.has(attempt.studentId)) newestFinished.set(attempt.studentId, attempt.id);
  }

  return (
    <PageShell>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4 text-muted-foreground">
        <Link href="/admin/quizzes">
          <ArrowLeft />
          Quizzes
        </Link>
      </Button>

      <PageHeader
        title={<span className="break-words">{quiz.title}</span>}
        description={
          <>
            {quiz.subject} · {quiz.questionCount} questions · {quiz.durationMinutes} minutes
            {quiz.description ? ` — ${quiz.description}` : ''}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:justify-end">
            <dl className="space-y-0.5 text-right text-sm">
              <div className="flex justify-end gap-2">
                <dt className="text-muted-foreground">Opens</dt>
                <dd className="tabular font-medium">{formatDateTime(quiz.startsAt)}</dd>
              </div>
              <div className="flex justify-end gap-2">
                <dt className="text-muted-foreground">Closes</dt>
                <dd className="tabular font-medium">{formatDateTime(quiz.endsAt)}</dd>
              </div>
            </dl>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil />
              Edit details
            </Button>
            {quiz.status === 'DRAFT' ? (
              <Button loading={updating} onClick={() => void publish()}>
                <Send />
                Publish
              </Button>
            ) : quiz.status === 'PUBLISHED' ? (
              <Badge variant="success">
                <CheckCircle2 aria-hidden />
                Published
              </Badge>
            ) : (
              <Badge variant="outline">
                <Archive aria-hidden />
                Archived
              </Badge>
            )}
          </div>
        }
      />

      {/* One ruled strip rather than four separate cards. */}
      <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        <Stat label="Assigned" value={assignments.length} />
        <Stat label="Attempts" value={attempts.length} />
        <Stat label="Average score" value={average === null ? '—' : `${average}%`} />
        <Stat
          label="Flagged for review"
          value={
            flagged.length > 0 ? (
              <span className="inline-flex items-center gap-2 text-warning">
                <ShieldAlert className="size-5" aria-hidden />
                {flagged.length}
              </span>
            ) : (
              flagged.length
            )
          }
        />
      </dl>

      <div className="mt-8">
        <Tabs defaultValue="attempts" className="min-w-0">
          <TabsList aria-label="Quiz detail">
            <TabsTrigger value="attempts">
              Attempts
              <span className="tabular ml-1.5 text-xs text-muted-foreground">
                {attempts.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="assigned">
              Assigned
              <span className="tabular ml-1.5 text-xs text-muted-foreground">
                {assignments.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="questions">
              Questions
              {quiz.sourceMode === 'FIXED' ? (
                <span className="tabular ml-1.5 text-xs text-muted-foreground">
                  {questions.length}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="extra-time">Extra time</TabsTrigger>
            <TabsTrigger value="item-analysis">Item analysis</TabsTrigger>
          </TabsList>

          <TabsContent value="item-analysis">
            <ItemAnalysis quizId={quiz.id} />
          </TabsContent>

          <TabsContent value="extra-time">
            <ExtraTimePanel quizId={quiz.id} durationMinutes={quiz.durationMinutes} />
          </TabsContent>

          <TabsContent value="questions">
            <QuestionsTab
              quiz={quiz}
              questions={questions}
              editable={editable}
              attemptCount={attempts.length}
              onSaved={() => void refetch()}
            />
          </TabsContent>

          <TabsContent value="attempts">
            {attempts.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No attempts yet"
                description="Once students begin this examination their attempts and integrity indicators appear here."
              />
            ) : (
              <div className="rounded-lg border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="hidden 2xl:table-cell">Integrity</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attempts.map((attempt) => (
                      <TableRow key={attempt.id}>
                        <TableCell className="max-w-[14rem]">
                          <p className="truncate font-medium">
                            {attempt.studentName}
                            {attempt.attemptNumber > 1 ? (
                              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                Attempt {attempt.attemptNumber}
                              </span>
                            ) : null}
                          </p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {attempt.rollNumber}
                          </p>
                          {attempt.integrityStatus ? (
                            <div className="mt-1 2xl:hidden">
                              <IntegrityBadge
                                status={attempt.integrityStatus}
                                score={attempt.integrityScore}
                              />
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {attempt.status === 'IN_PROGRESS' ? (
                            <Badge variant="warning">
                              <Clock aria-hidden />
                              In progress
                            </Badge>
                          ) : attempt.status === 'AUTO_SUBMITTED' ? (
                            <Badge variant="muted">
                              <TimerOff aria-hidden />
                              Auto-submitted
                            </Badge>
                          ) : (
                            <Badge variant="success">
                              <CheckCircle2 aria-hidden />
                              Submitted
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="tabular whitespace-nowrap text-right">
                          {attempt.percentage === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <>
                              <span className="font-semibold">{attempt.percentage}%</span>
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                {attempt.score}/{attempt.maxScore}
                              </span>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="hidden 2xl:table-cell">
                          {attempt.integrityStatus ? (
                            <IntegrityBadge
                              status={attempt.integrityStatus}
                              score={attempt.integrityScore}
                            />
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* View full answers — only meaningful once submitted */}
                            {attempt.status !== 'IN_PROGRESS' ? (
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/admin/results/${attempt.id}`}>
                                  <ScrollText />
                                  Answers
                                </Link>
                              </Button>
                            ) : null}
                            {quiz.security.singleAttempt &&
                            attempt.status !== 'IN_PROGRESS' &&
                            newestFinished.get(attempt.studentId) === attempt.id ? (
                              <RetakeButton
                                quizId={quiz.id}
                                quizTitle={quiz.title}
                                studentId={attempt.studentId}
                                name={attempt.studentName}
                                granted={
                                  (extraByStudent.get(attempt.studentId) ?? 0) >
                                  (madeByStudent.get(attempt.studentId) ?? 1) - 1
                                }
                                sitting={liveStudents.has(attempt.studentId)}
                                onChanged={() => void refetch()}
                              />
                            ) : null}
                            <Button asChild variant="ghost" size="sm">
                              <Link
                                href={`/admin/integrity/${attempt.id}`}
                                aria-label={`Integrity report for ${attempt.studentName}`}
                              >
                                <ShieldAlert />
                                <span className="hidden 2xl:inline">Integrity</span>
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="assigned">
            <div className="mb-3 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setAssigning(true)}>
                <Users />
                Edit assigned students
              </Button>
            </div>
            {assignments.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No students assigned"
                description="This quiz is not visible to anyone until students are assigned to it."
              />
            ) : (
              <div className="rounded-lg border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Student ID</TableHead>
                      <TableHead>Section</TableHead>
                      <TableHead>Attempted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((assignment) => {
                      const attempted = attempts.some(
                        (attempt) => attempt.rollNumber === assignment.rollNumber,
                      );
                      return (
                        <TableRow key={assignment.studentId}>
                          <TableCell className="max-w-[14rem] truncate font-medium">
                            {assignment.name}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {assignment.rollNumber}
                          </TableCell>
                          <TableCell>{assignment.section}</TableCell>
                          <TableCell>
                            {attempted ? (
                              <span className="flex items-center gap-1.5 text-sm text-success">
                                <Check className="size-3.5" aria-hidden />
                                Yes
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <X className="size-3.5" aria-hidden />
                                Not yet
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>

      </div>

      <QuizEditDialog
        quiz={
          editing
            ? {
                id: quiz.id,
                title: quiz.title,
                description: quiz.description,
                durationMinutes: quiz.durationMinutes,
                difficultyMix: quiz.difficultyMix,
                startsAt: quiz.startsAt,
                endsAt: quiz.endsAt,
                attemptCount: attempts.length,
                security: quiz.security,
                marking: quiz.marking,
              }
            : null
        }
        onOpenChange={setEditing}
        onSaved={() => {
          setEditing(false);
          void refetch();
        }}
      />

      <AssignStudentsDialog
        open={assigning}
        onOpenChange={setAssigning}
        quizId={quiz.id}
        assignedIds={assignments.map((a) => a.studentId)}
        startedIds={assignments
          .filter((a) => attempts.some((attempt) => attempt.rollNumber === a.rollNumber))
          .map((a) => a.studentId)}
        onSaved={() => void refetch()}
      />
    </PageShell>
  );
}

const TYPE_LABELS: Record<string, string> = {
  MCQ_SINGLE: 'Multiple choice',
  MCQ_MULTI: 'Multiple answers',
  TRUE_FALSE: 'True / false',
  ASSERTION_REASON: 'Assertion & reason',
  SHORT_ANSWER: 'Short answer',
  LONG_ANSWER: 'Long answer',
  IMAGE_ANSWER: 'Photographed work',
};

/**
 * The paper behind a quiz.
 *
 * A pooled quiz has no paper to show — it is composed per student at exam
 * time — so this explains the recipe instead of pretending there is a list.
 */
function QuestionsTab({
  quiz,
  questions,
  editable,
  attemptCount,
  onSaved,
}: {
  quiz: QuizDetail['quiz'];
  questions: SavedQuestion[];
  editable: boolean;
  attemptCount: number;
  onSaved: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<InstantQuestion[]>([]);
  const [showErrors, setShowErrors] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  if (quiz.sourceMode === 'POOL') {
    return (
      <div className="rounded-lg border border-border bg-card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <Shuffle className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <h3 className="type-subheading">Drawn from the question bank</h3>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              This quiz has no fixed paper. When a student starts it, the server selects{' '}
              <span className="font-medium text-foreground">{quiz.questionCount}</span> questions
              from the bank for that student alone, so no two papers are necessarily the same.
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="type-eyebrow">Questions per paper</dt>
            <dd className="tabular mt-1 font-medium">{quiz.questionCount}</dd>
          </div>
          <div className="min-w-0">
            <dt className="type-eyebrow">Subject</dt>
            <dd className="mt-1 break-words font-medium">{quiz.subject}</dd>
          </div>
          <div>
            <dt className="type-eyebrow">Difficulty mix</dt>
            <dd className="tabular mt-1 font-medium">
              {quiz.difficultyMix.easy}/{quiz.difficultyMix.medium}/{quiz.difficultyMix.hard}
            </dd>
          </div>
        </dl>

        <Button asChild variant="outline" className="mt-6">
          <Link href="/admin/questions">
            <FileQuestion />
            Open the question bank
          </Link>
        </Button>
      </div>
    );
  }

  const startEditing = () => {
    setDraft(
      questions.length > 0 ? questions.map(fromSavedQuestion) : [blankQuestion()],
    );
    setShowErrors(false);
    setEditing(true);
  };

  const save = async () => {
    if (draft.some((question) => validateQuestion(question) !== null)) {
      setShowErrors(true);
      toast.error('Some questions still need attention.');
      return;
    }

    setSaving(true);
    try {
      await apiFetch(`/api/admin/quizzes/${quiz.id}/questions`, {
        method: 'PUT',
        body: { questions: draft.map(toApiQuestion) },
      });
      toast.success('Questions saved.');
      setEditing(false);
      onSaved();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not save these questions.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="space-y-4">
        <InstantQuestionBuilder
          questions={draft}
          onChange={setDraft}
          showErrors={showErrors}
        />
        {/* Kept in view while a long paper is being edited. */}
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-overlay backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <Button loading={saving} onClick={() => void save()}>
            <Save />
            Save questions
          </Button>
          <Button variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <span className="tabular font-medium text-foreground">{questions.length}</span> question
          {questions.length === 1 ? '' : 's'} ·{' '}
          <span className="tabular font-medium text-foreground">{quiz.totalMarks}</span> mark
          {quiz.totalMarks === 1 ? '' : 's'} · everyone sits the same paper
        </p>
        {editable ? (
          <Button variant="outline" size="sm" onClick={startEditing}>
            <Pencil />
            Edit questions
          </Button>
        ) : null}
      </div>

      {!editable ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/60 px-4 py-3.5">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">This paper is now fixed.</span>{' '}
            {attemptCount} student{attemptCount === 1 ? ' has' : 's have'} been served it, and their
            answers point at these exact options and marks — editing now would change what they were
            asked after the fact. Duplicate the quiz if you need a corrected version.
          </p>
        </div>
      ) : null}

      {/* The paper itself: one sheet, questions ruled apart. */}
      <ol className="divide-y divide-border rounded-lg border border-border bg-card">
        {questions.map((question, index) => (
          <li key={index} className="p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-4">
              <span className="tabular w-6 shrink-0 pt-0.5 font-serif text-lg font-semibold leading-none text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="muted">{TYPE_LABELS[question.type] ?? question.type}</Badge>
                  <span className="tabular text-xs text-muted-foreground">
                    {question.marks} mark{question.marks === 1 ? '' : 's'}
                  </span>
                </div>

                <MathText
                  text={question.text}
                  className="mt-2.5 block break-words text-[0.9375rem] font-medium leading-relaxed"
                />

                {question.assertionText ? (
                  <dl className="mt-3 space-y-2 border-l-2 border-border pl-3 text-sm">
                    <div>
                      <dt className="type-eyebrow">Assertion (A)</dt>
                      <dd className="mt-0.5 break-words">
                        <MathText text={question.assertionText} />
                      </dd>
                    </div>
                    <div>
                      <dt className="type-eyebrow">Reason (R)</dt>
                      <dd className="mt-0.5 break-words">
                        <MathText text={question.reasonText ?? ''} />
                      </dd>
                    </div>
                  </dl>
                ) : null}

                {question.imageAssetId ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- authorised
                     route, so Next's image optimiser cannot fetch it. */
                  <img
                    loading="lazy"
                    decoding="async"
                    src={`/api/media/${question.imageAssetId}`}
                    alt="Diagram for this question"
                    className="mt-3 max-h-48 max-w-full rounded-md border border-border bg-white object-contain"
                  />
                ) : null}

                {question.options.length > 0 ? (
                  <ul className="mt-3 space-y-1.5">
                    {question.options.map((option, optionIndex) => (
                      <li key={optionIndex} className="flex items-start gap-2 text-sm">
                        <span
                          className={
                            option.isCorrect
                              ? 'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground'
                              : 'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input'
                          }
                          aria-hidden
                        >
                          {option.isCorrect ? <Check className="size-2.5" strokeWidth={3} /> : null}
                        </span>
                        <MathText
                          text={option.text}
                          className={
                            option.isCorrect
                              ? 'min-w-0 break-words font-medium text-success'
                              : 'min-w-0 break-words'
                          }
                        />
                        {option.isCorrect ? <span className="sr-only">(correct answer)</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {question.acceptedAnswers.length > 0 ? (
                  <p className="mt-3 break-words text-sm">
                    <span className="text-xs text-muted-foreground">Accepted: </span>
                    <span className="font-medium text-success">
                      {question.acceptedAnswers.join(', ')}
                    </span>
                  </p>
                ) : null}

                {question.modelAnswer ? (
                  <div className="mt-3 rounded-md bg-muted/60 p-3">
                    <p className="type-eyebrow">Model answer — faculty only</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {question.modelAnswer}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One cell of the summary strip. */
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card px-4 py-4 sm:px-5">
      <dt className="truncate text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="tabular mt-1.5 font-serif text-2xl font-semibold leading-none text-foreground">
        {value}
      </dd>
    </div>
  );
}

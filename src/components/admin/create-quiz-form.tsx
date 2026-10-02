'use client';

import { AlertTriangle, ArrowLeft, Check, Library, PenLine, Save, Send, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import {
  InstantQuestionBuilder,
  blankQuestion,
  toApiQuestion,
  validateQuestion,
  type InstantQuestion,
} from '@/components/admin/instant-question-builder';
import {
  DEFAULT_MARKING,
  MarkingSettings,
  type QuizMarkingValue,
} from '@/components/admin/marking-settings';
import {
  DEFAULT_SECURITY,
  SecuritySettings,
  type QuizSecurity,
} from '@/components/admin/security-settings';
import { SectionChips } from '@/components/admin/section-chips';
import { InlineError } from '@/components/shared/error-state';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { cn } from '@/lib/utils';

interface MetaData {
  subjects: Array<{
    id: string;
    name: string;
    code: string;
    topics: Array<{ id: string; name: string }>;
    pool: { EASY: number; MEDIUM: number; HARD: number; total: number };
  }>;
  departments: string[];
  sections: Array<{ department: string; section: string }>;
}

interface StudentRow {
  id: string;
  name: string;
  rollNumber: string;
  department: string;
  section: string;
  status: string;
}

/** `datetime-local` needs `YYYY-MM-DDTHH:mm` in *local* time. */
function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const emptyErrors: Record<string, string[]> = {};
type ReviewSection = 'content' | 'students' | 'security';

export function CreateQuizForm() {
  const router = useRouter();
  const {
    data: meta,
    error: metaError,
    initialLoading: metaLoading,
  } = useApi<MetaData>('/api/admin/meta');
  const {
    data: studentData,
    error: studentsError,
    initialLoading: studentsLoading,
  } = useApi<{ students: StudentRow[] }>('/api/admin/students?pageSize=100');

  const defaultStart = React.useMemo(() => {
    const start = new Date();
    start.setMinutes(start.getMinutes() + 30, 0, 0);
    return start;
  }, []);

  const [sourceMode, setSourceMode] = React.useState<'POOL' | 'FIXED'>('POOL');
  const [questions, setQuestions] = React.useState<InstantQuestion[]>(() => [blankQuestion()]);

  const [title, setTitle] = React.useState('');
  const [subjectId, setSubjectId] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [durationMinutes, setDurationMinutes] = React.useState('30');
  const [questionCount, setQuestionCount] = React.useState('30');
  const [topicIds, setTopicIds] = React.useState<string[]>([]);
  const [easyPct, setEasyPct] = React.useState(30);
  const [mediumPct, setMediumPct] = React.useState(50);
  const [hardPct, setHardPct] = React.useState(20);
  const [startsAt, setStartsAt] = React.useState(toLocalInputValue(defaultStart));
  const [endsAt, setEndsAt] = React.useState(
    toLocalInputValue(new Date(defaultStart.getTime() + 2 * 60 * 60 * 1000)),
  );
  const [security, setSecurity] = React.useState<QuizSecurity>(DEFAULT_SECURITY);
  const [marking, setMarking] = React.useState<QuizMarkingValue>(DEFAULT_MARKING);
  const [assignedIds, setAssignedIds] = React.useState<string[]>([]);
  const [sectionFilter, setSectionFilter] = React.useState<string[]>([]);
  const [activeSection, setActiveSection] = React.useState<ReviewSection>('content');
  const [reviewedSections, setReviewedSections] = React.useState<Set<ReviewSection>>(
    () => new Set(),
  );

  const [submitting, setSubmitting] = React.useState<'DRAFT' | 'PUBLISHED' | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string[]>>(emptyErrors);
  const [formError, setFormError] = React.useState<string | null>(null);

  const subject = meta?.subjects.find((entry) => entry.id === subjectId);
  const students = studentData?.students ?? [];

  const sections = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const student of students) {
      const key = `${student.department} · ${student.section}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, count]) => ({ label, count }));
  }, [students]);

  const visibleStudents =
    sectionFilter.length === 0
      ? students
      : students.filter((student) =>
          sectionFilter.includes(`${student.department} · ${student.section}`),
        );

  const fixedMode = sourceMode === 'FIXED';
  const pctTotal = easyPct + mediumPct + hardPct;
  const requestedCount = fixedMode ? questions.length : Number.parseInt(questionCount, 10) || 0;

  // Pool sizing is checked as the teacher types, so publishing never fails for
  // a reason they could have seen earlier.
  const poolSize = React.useMemo(() => {
    if (!subject) return 0;
    if (topicIds.length === 0) return subject.pool.total;
    // Per-topic counts are not in the meta payload; fall back to the subject
    // total, which is an upper bound, and let the server do the exact check.
    return subject.pool.total;
  }, [subject, topicIds]);

  // A fixed paper carries its own questions, so the bank's size is irrelevant.
  const poolShortfall = !fixedMode && subject !== undefined && requestedCount > poolSize;

  const questionProblems = fixedMode
    ? questions.filter((question) => validateQuestion(question) !== null).length
    : 0;

  const switchSection = (section: ReviewSection) => {
    setActiveSection(section);
    if (section !== 'content') setReviewedSections((current) => new Set(current).add(section));
    setFormError(null);
  };

  const validate = () => {
    const next: Record<string, string[]> = {};
    if (title.trim().length < 3) next.title = ['Enter a quiz name of at least 3 characters'];
    if (!subjectId) next.subjectId = ['Select a subject'];
    if ((Number.parseInt(durationMinutes, 10) || 0) < 1) {
      next.durationMinutes = ['Enter a duration in minutes'];
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      next.endsAt = ['The end of the window must be after its start'];
    }

    if (fixedMode) {
      if (questions.length === 0) next.questions = ['Write at least one question'];
      if (questionProblems > 0) {
        next.questions = [
          `${questionProblems} question${questionProblems === 1 ? ' needs' : 's need'} attention`,
        ];
      }
    } else {
      if (requestedCount < 1) next.questionCount = ['Enter how many questions to serve'];
      if (pctTotal !== 100) next.mediumPct = ['Difficulty distribution must total 100%'];
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (status: 'DRAFT' | 'PUBLISHED') => {
    setFormError(null);
    if (!validate()) {
      toast.error('Please correct the highlighted fields.');
      return;
    }

    if (status === 'PUBLISHED' && assignedIds.length === 0) {
      setFormError('Assign at least one student before publishing this quiz.');
      switchSection('students');
      return;
    }

    if (status === 'PUBLISHED') {
      const missing = !reviewedSections.has('students')
        ? 'students'
        : !reviewedSections.has('security')
          ? 'security'
          : null;
      if (missing) {
        setFormError('Review both the Students and Security sections before publishing.');
        switchSection(missing);
        return;
      }
    }

    setSubmitting(status);
    try {
      const result = await apiFetch<{ quizId: string }>('/api/admin/quizzes', {
        method: 'POST',
        body: {
          title: title.trim(),
          subjectId,
          description: description.trim(),
          durationMinutes: Number.parseInt(durationMinutes, 10),
          sourceMode,
          // In fixed mode the server counts the questions itself; sending a
          // count here would just be a number it has to ignore.
          questionCount: fixedMode ? 1 : requestedCount,
          questions: fixedMode ? questions.map(toApiQuestion) : [],
          poolTopicIds: fixedMode ? [] : topicIds,
          easyPct,
          mediumPct,
          hardPct,
          // The server stores UTC; `toISOString` converts from the local input.
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          status,
          assignedStudentIds: assignedIds,
          security,
          ...marking,
        },
      });

      toast.success(status === 'PUBLISHED' ? 'Quiz published and assigned.' : 'Draft saved.');
      router.push(`/admin/quizzes/${result.quizId}`);
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        setErrors(caught.details ?? emptyErrors);
        setFormError(caught.message);
        toast.error(caught.message);
      } else {
        setFormError('We could not save this quiz.');
      }
      setSubmitting(null);
    }
  };

  return (
    <PageShell className="max-w-6xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4 text-muted-foreground">
        <Link href="/admin/quizzes">
          <ArrowLeft />
          Quizzes
        </Link>
      </Button>

      <PageHeader
        title="Create quiz"
        description={
          fixedMode
            ? 'Write the paper here. Every student sits the same questions, in the order you set.'
            : 'Questions are drawn from the bank at exam time, so every student receives a different valid paper.'
        }
      />

      <div className="mt-8 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10 xl:gap-14">
        {/* Section nav: a row of three on small screens, a sticky rail on wide ones. */}
        <nav aria-label="Quiz setup" className="lg:sticky lg:top-28 lg:self-start">
          <p className="type-eyebrow mb-3 hidden lg:block">Quiz setup</p>
          <ol className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-card p-1 lg:grid-cols-1 lg:gap-0.5 lg:border-0 lg:bg-transparent lg:p-0">
            {(
              [
                ['content', 'Content', 'Paper and schedule'],
                ['students', 'Students', 'Who sits it'],
                ['security', 'Security', 'Rules and release'],
              ] as const
            ).map(([section, label, hint], index) => {
              const reviewed = section === 'content' || reviewedSections.has(section);
              const active = activeSection === section;
              return (
                <li key={section}>
                  <button
                    type="button"
                    onClick={() => switchSection(section)}
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      'flex min-h-10 w-full items-center justify-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-fast ease-standard lg:justify-start',
                      active
                        ? 'bg-accent font-semibold text-accent-foreground'
                        : 'font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'tabular hidden size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold sm:flex',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-card text-muted-foreground',
                      )}
                      aria-hidden
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{label}</span>
                      <span className="hidden text-xs font-normal text-muted-foreground lg:block">
                        {hint}
                      </span>
                    </span>
                    {reviewed ? (
                      <Check
                        className="size-3.5 shrink-0 text-success lg:ml-auto"
                        strokeWidth={3}
                        aria-label="Reviewed"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="mt-8 min-w-0 lg:mt-0">
          {formError ? (
            <p
              role="alert"
              className="mb-6 flex items-start gap-2 rounded-md border border-danger/20 bg-danger-subtle px-3.5 py-3 text-sm text-danger"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {formError}
            </p>
          ) : null}

          <form
            id="create-quiz-form"
            className="space-y-12"
            onSubmit={(event) => {
              event.preventDefault();
              void submit('PUBLISHED');
            }}
          >
            <div className={activeSection === 'content' ? 'space-y-12' : 'hidden'}>
              <Section
                number={1}
                title="How the paper is built"
                description="Choose this first. It decides what the rest of the form asks for."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <ModeCard
                    icon={Library}
                    title="From the question bank"
                    description="Name a size and difficulty mix. Each student gets a different paper drawn from your bank."
                    selected={!fixedMode}
                    onSelect={() => setSourceMode('POOL')}
                  />
                  <ModeCard
                    icon={PenLine}
                    title="Write questions now"
                    description="Type the questions straight in, like a form. Nothing needs to be in the bank first."
                    selected={fixedMode}
                    onSelect={() => setSourceMode('FIXED')}
                  />
                </div>
              </Section>

              <Section number={2} title="Examination details">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    className="sm:col-span-2"
                    label="Quiz name"
                    required
                    error={errors.title?.[0]}
                    htmlFor="title"
                  >
                    <Input
                      id="title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Unit Test 1"
                      invalid={Boolean(errors.title)}
                    />
                  </Field>

                  <Field label="Subject" required error={errors.subjectId?.[0]} htmlFor="subject">
                    {metaLoading ? (
                      <Skeleton className="h-10 w-full rounded-md" />
                    ) : (
                      <Select
                        value={subjectId}
                        onValueChange={(value) => {
                          setSubjectId(value);
                          setTopicIds([]);
                        }}
                      >
                        <SelectTrigger id="subject">
                          <SelectValue placeholder="Select a subject" />
                        </SelectTrigger>
                        <SelectContent>
                          {meta?.subjects.map((entry) => (
                            <SelectItem key={entry.id} value={entry.id}>
                              {entry.name} ({entry.pool.total} questions)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {metaError && !meta ? <InlineError message={metaError.message} /> : null}
                  </Field>

                  <Field
                    label="Duration (minutes)"
                    required
                    error={errors.durationMinutes?.[0]}
                    htmlFor="duration"
                  >
                    <Input
                      id="duration"
                      type="number"
                      min={1}
                      max={360}
                      value={durationMinutes}
                      onChange={(event) => setDurationMinutes(event.target.value)}
                      invalid={Boolean(errors.durationMinutes)}
                      className="tabular"
                    />
                  </Field>

                  <Field
                    className="sm:col-span-2"
                    label="Description"
                    htmlFor="description"
                    hint="Shown to students on the instructions page."
                  >
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Covers units 1 and 2 — layered architecture and transport protocols."
                      rows={3}
                    />
                  </Field>
                </div>
              </Section>

              {fixedMode ? (
                <Section
                  number={3}
                  title="Questions"
                  description="Everyone sits these, in this order — unless you shuffle them under security settings."
                >
                  <InstantQuestionBuilder
                    questions={questions}
                    onChange={setQuestions}
                    showErrors={Boolean(errors.questions)}
                  />
                  {errors.questions ? (
                    <p
                      role="alert"
                      className="mt-3 flex items-start gap-1.5 text-xs text-destructive"
                    >
                      <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                      {errors.questions[0]}
                    </p>
                  ) : null}
                </Section>
              ) : (
                <Section
                  number={3}
                  title="Question pool"
                  description="The server selects this many questions per student from the pool below."
                >
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field
                      label="Number of questions"
                      required
                      error={errors.questionCount?.[0]}
                      htmlFor="questionCount"
                    >
                      <Input
                        id="questionCount"
                        type="number"
                        min={1}
                        max={200}
                        value={questionCount}
                        onChange={(event) => setQuestionCount(event.target.value)}
                        invalid={Boolean(errors.questionCount) || poolShortfall}
                        className="tabular"
                      />
                    </Field>

                    <Field label="Available in pool" htmlFor="poolSize">
                      <div
                        id="poolSize"
                        className={cn(
                          'tabular flex h-10 items-center gap-2 rounded-md border px-3 text-sm',
                          poolShortfall
                            ? 'border-danger/30 bg-danger-subtle text-danger'
                            : 'border-transparent bg-muted text-muted-foreground',
                        )}
                      >
                        {poolShortfall ? (
                          <AlertTriangle className="size-4 shrink-0" aria-hidden />
                        ) : null}
                        {subject ? `${poolSize} questions` : 'Select a subject first'}
                      </div>
                    </Field>
                  </div>

                  {poolShortfall ? (
                    <InlineError
                      className="mt-3"
                      message={`This subject has ${poolSize} questions but the quiz asks for ${requestedCount}. Add questions to the bank or lower the count.`}
                    />
                  ) : null}

                  {subject && subject.topics.length > 0 ? (
                    <div className="mt-8" role="group" aria-labelledby="pool-topics-label">
                      <p id="pool-topics-label" className="text-sm font-medium text-foreground">
                        Restrict to topics
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Leave all unchecked to draw from every topic in {subject.name}.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {subject.topics.map((topic) => {
                          const checked = topicIds.includes(topic.id);
                          return (
                            <button
                              key={topic.id}
                              type="button"
                              aria-pressed={checked}
                              onClick={() =>
                                setTopicIds((current) =>
                                  checked
                                    ? current.filter((id) => id !== topic.id)
                                    : [...current, topic.id],
                                )
                              }
                              className={cn(
                                'inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-md border px-3 py-1.5 text-left text-sm font-medium transition-colors duration-fast ease-standard sm:min-h-9',
                                checked
                                  ? 'border-primary bg-accent text-accent-foreground'
                                  : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                              )}
                            >
                              {checked ? (
                                <Check className="size-3.5 shrink-0" strokeWidth={3} aria-hidden />
                              ) : null}
                              <span className="break-words">{topic.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-8">
                    <p className="text-sm font-medium text-foreground">Difficulty distribution</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Must total 100%. Shortfalls in one band are backfilled from the rest of the
                      pool.
                    </p>

                    <div className="mt-3 grid max-w-md grid-cols-3 gap-3">
                      <DifficultyInput label="Easy" value={easyPct} onChange={setEasyPct} />
                      <DifficultyInput label="Medium" value={mediumPct} onChange={setMediumPct} />
                      <DifficultyInput label="Hard" value={hardPct} onChange={setHardPct} />
                    </div>

                    <p
                      className={cn(
                        'tabular mt-3 flex items-center gap-1.5 text-xs font-medium',
                        pctTotal === 100 ? 'text-success' : 'text-destructive',
                      )}
                      role={pctTotal === 100 ? undefined : 'alert'}
                    >
                      {pctTotal === 100 ? (
                        <Check className="size-3.5" strokeWidth={3} aria-hidden />
                      ) : (
                        <AlertTriangle className="size-3.5" aria-hidden />
                      )}
                      Total: {pctTotal}%{pctTotal === 100 ? '' : ' — must equal 100%'}
                    </p>
                  </div>
                </Section>
              )}

              <Section number={4} title="Examination window">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Opens" required htmlFor="startsAt">
                    <Input
                      id="startsAt"
                      type="datetime-local"
                      value={startsAt}
                      onChange={(event) => setStartsAt(event.target.value)}
                    />
                  </Field>
                  <Field label="Closes" required error={errors.endsAt?.[0]} htmlFor="endsAt">
                    <Input
                      id="endsAt"
                      type="datetime-local"
                      value={endsAt}
                      onChange={(event) => setEndsAt(event.target.value)}
                      invalid={Boolean(errors.endsAt)}
                    />
                  </Field>
                </div>
                <p className="mt-4 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                  A student&apos;s timer starts when they begin and is capped by the closing time,
                  so a late start cannot run past the window.
                </p>
              </Section>
            </div>

            {activeSection === 'students' ? (
              <Section
                title="Assign students"
                description="The quiz is visible only to the students you tick here."
              >
                {studentsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full max-w-xs rounded-md" />
                    <Skeleton className="h-64 w-full rounded-lg" />
                  </div>
                ) : studentsError && !studentData ? (
                  <InlineError message={studentsError.message} />
                ) : students.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center">
                    <Users
                      className="mx-auto size-6 text-muted-foreground"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <p className="mt-3 text-sm text-muted-foreground">
                      No students on the roster yet.{' '}
                      <Link
                        href="/admin/students"
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        Add students
                      </Link>{' '}
                      before publishing.
                    </p>
                  </div>
                ) : (
                  <>
                    <SectionChips
                      sections={sections}
                      value={sectionFilter}
                      onChange={setSectionFilter}
                    />
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="flex items-center justify-between gap-3 sm:ml-auto sm:justify-end">
                        <Badge variant={assignedIds.length > 0 ? 'default' : 'muted'}>
                          <Users aria-hidden />
                          <span className="tabular">{assignedIds.length}</span> assigned
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-primary"
                          onClick={() => {
                            const visibleIds = visibleStudents.map((student) => student.id);
                            const allSelected = visibleIds.every((id) => assignedIds.includes(id));
                            setAssignedIds((current) =>
                              allSelected
                                ? current.filter((id) => !visibleIds.includes(id))
                                : [...new Set([...current, ...visibleIds])],
                            );
                          }}
                        >
                          {visibleStudents.every((student) => assignedIds.includes(student.id))
                            ? 'Clear visible'
                            : 'Select visible'}
                        </Button>
                      </div>
                    </div>

                    <ul className="scrollbar-slim mt-4 max-h-[28rem] divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card">
                      {visibleStudents.map((student) => {
                        const checked = assignedIds.includes(student.id);
                        const inactive = student.status !== 'ACTIVE';
                        const checkboxId = `assign-${student.id}`;
                        return (
                          <li
                            key={student.id}
                            className={cn(
                              'flex items-center gap-3 px-3 transition-colors duration-fast hover:bg-accent/50',
                              inactive && 'opacity-60',
                            )}
                          >
                            <Checkbox
                              id={checkboxId}
                              checked={checked}
                              disabled={inactive}
                              onCheckedChange={(value) =>
                                setAssignedIds((current) =>
                                  value === true
                                    ? [...current, student.id]
                                    : current.filter((id) => id !== student.id),
                                )
                              }
                            />
                            <label
                              htmlFor={checkboxId}
                              className={cn(
                                'flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 py-2',
                                inactive ? 'cursor-not-allowed' : 'cursor-pointer',
                              )}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-foreground">
                                  {student.name}
                                </span>
                                <span className="block truncate font-mono text-2xs text-muted-foreground">
                                  {student.rollNumber} · {student.section}
                                </span>
                              </span>
                              {inactive ? (
                                <Badge variant="muted" className="shrink-0">
                                  {student.status.charAt(0) + student.status.slice(1).toLowerCase()}
                                </Badge>
                              ) : null}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </Section>
            ) : null}

            {activeSection === 'security' ? (
              <Section
                title="Security settings"
                description="Each control is enforced on the server, not only in the browser. Review these controls before publishing."
              >
                <SecuritySettings value={security} onChange={setSecurity} />
              </Section>
            ) : null}

            {activeSection === 'security' ? (
              <Section
                title="Marking"
                description="Optional. Choose a negative-marking and partial-credit rule for the whole quiz, or leave each question as you set it in the editor."
              >
                <MarkingSettings value={marking} onChange={setMarking} />
              </Section>
            ) : null}

            {/* The one place to finish: always in view, whichever section is open. */}
            <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-overlay backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:flex-row sm:items-center sm:justify-between">
              {poolShortfall ? (
                <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden />
                  The pool is too small to publish.
                </p>
              ) : (
                <p className="tabular min-w-0 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {fixedMode ? 'Written paper' : 'Random-from-pool paper'}
                  </span>{' '}
                  · {requestedCount} question{requestedCount === 1 ? '' : 's'} ·{' '}
                  {Number.parseInt(durationMinutes, 10) || 0} min · {assignedIds.length} assigned
                </p>
              )}
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  loading={submitting === 'DRAFT'}
                  disabled={submitting !== null}
                  onClick={() => void submit('DRAFT')}
                >
                  <Save aria-hidden />
                  Save draft
                </Button>
                <Button
                  type="submit"
                  form="create-quiz-form"
                  className="flex-1 sm:flex-none"
                  loading={submitting === 'PUBLISHED'}
                  disabled={submitting !== null || poolShortfall}
                >
                  <Send aria-hidden />
                  Publish quiz
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </PageShell>
  );
}

/** The two ways to build a paper, chosen before anything else on the form. */
function ModeCard({
  icon: Icon,
  title,
  description,
  selected,
  onSelect,
}: {
  icon: typeof Library;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex h-full w-full items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors duration-fast ease-standard',
        selected
          ? 'border-primary shadow-[inset_0_0_0_1px_hsl(var(--primary))]'
          : 'border-border hover:border-foreground/30 hover:bg-accent/40',
      )}
    >
      {/* A radio-style mark: filled when chosen, so the choice reads without colour. */}
      <span
        className={cn(
          'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-primary' : 'border-input',
        )}
        aria-hidden
      >
        {selected ? <span className="size-2.5 rounded-full bg-primary" /> : null}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon
            className={cn('size-4 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')}
            aria-hidden
          />
          {title}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

/** A numbered form section: serif title on a hairline, no surrounding box. */
function Section({
  number,
  title,
  description,
  children,
}: {
  number?: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id}>
      <div className="border-b border-border pb-3">
        <h2 id={id} className="type-heading flex items-baseline gap-3">
          {number ? (
            <span
              className="tabular font-sans text-sm font-semibold text-muted-foreground"
              aria-hidden
            >
              {String(number).padStart(2, '0')}
            </span>
          ) : null}
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-2', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function DifficultyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = `difficulty-${label.toLowerCase()}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(event) =>
            onChange(Math.max(0, Math.min(100, Number(event.target.value) || 0)))
          }
          className="tabular pr-8"
        />
        <span
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
          aria-hidden
        >
          %
        </span>
      </div>
    </div>
  );
}

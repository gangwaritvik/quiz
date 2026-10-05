'use client';

import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileQuestion,
  Pencil,
  Plus,
  SearchX,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { CsvImportDialog } from '@/components/admin/csv-import-dialog';
import { DuplicateFinder } from '@/components/admin/duplicate-finder';
import { FilterBar, FilterSearch, FilterSelect } from '@/components/admin/filter-select';
import { QuestionEditor, type QuestionRecord } from '@/components/admin/question-editor';
import { StudyMaterials } from '@/components/admin/study-materials';
import { ErrorState } from '@/components/shared/error-state';
import { MathText } from '@/components/shared/math-text';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonRows } from '@/components/ui/skeleton';
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
import {
  BLOOM_LABEL,
  BLOOM_ORDER,
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_ORDER,
  isManuallyMarked,
  isOptionBased,
} from '@/lib/question-types';
import { cn } from '@/lib/utils';

interface QuestionListItem extends QuestionRecord {
  subject: string;
  topic: string | null;
  usageCount: number;
  aiGenerated?: boolean;
}

interface QuestionsResponse {
  total: number;
  page: number;
  pageCount: number;
  questions: QuestionListItem[];
}

interface SubjectMeta {
  id: string;
  name: string;
  code: string;
  topics: Array<{ id: string; name: string; count: number }>;
  /** Questions in the subject that have no topic. */
  noTopic: number;
  pool: { EASY: number; MEDIUM: number; HARD: number; total: number };
}

interface MetaData {
  subjects: SubjectMeta[];
}

const DIFFICULTY_VARIANT = {
  EASY: 'success',
  MEDIUM: 'default',
  HARD: 'warning',
} as const;

/** Signal bars rise with difficulty, so the badge reads without its colour. */
const DIFFICULTY_ICON = {
  EASY: SignalLow,
  MEDIUM: SignalMedium,
  HARD: SignalHigh,
} as const;

const ALL = 'ALL';
/** The topic filter's value for questions that have no topic. */
const NO_TOPIC = 'none';

/**
 * The question bank, one subject at a time. A teacher first picks the subject;
 * only then do they see its questions, with that subject's topics down the
 * side. The chosen subject lives in the URL, so refresh and Back keep it.
 */
export function QuestionBank() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <React.Suspense
      fallback={
        <PageShell>
          <SkeletonRows rows={5} />
        </PageShell>
      }
    >
      <QuestionBankView />
    </React.Suspense>
  );
}

function QuestionBankView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: meta, error, refetch: refetchMeta } = useApi<MetaData>('/api/admin/meta');

  const subjectId = searchParams.get('subject') ?? '';
  const subject = meta?.subjects.find((entry) => entry.id === subjectId);

  if (error && !meta) {
    return (
      <PageShell>
        <ErrorState error={error} onRetry={() => void refetchMeta()} />
      </PageShell>
    );
  }

  if (!meta) {
    return (
      <PageShell>
        <PageHeader title="Question bank" />
        <SkeletonRows rows={4} className="mt-8" />
      </PageShell>
    );
  }

  if (!subject) {
    return (
      <SubjectPicker
        subjects={meta.subjects}
        onPick={(id) => router.push(`${pathname}?subject=${encodeURIComponent(id)}`)}
      />
    );
  }

  return (
    <SubjectBank
      // A fresh set of filters for each subject.
      key={subject.id}
      subject={subject}
      subjects={meta.subjects}
      onBack={() => router.push(pathname)}
      onChanged={() => void refetchMeta()}
    />
  );
}

/** Step one: which subject's bank to open. */
function SubjectPicker({
  subjects,
  onPick,
}: {
  subjects: SubjectMeta[];
  onPick: (subjectId: string) => void;
}) {
  return (
    <PageShell>
      <PageHeader
        title="Question bank"
        description="Choose a subject to see its questions."
      />

      {subjects.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={BookOpen}
            title="No subjects yet"
            description="Questions belong to a subject. Once a subject exists, its bank will appear here."
          />
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {subjects.map((subject) => (
            <li key={subject.id}>
              <button
                type="button"
                onClick={() => onPick(subject.id)}
                className="grid w-full gap-x-6 gap-y-1 px-4 py-3.5 text-left transition-colors duration-fast ease-standard hover:bg-accent/60 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,13rem)_1rem] sm:items-center"
              >
                <span className="min-w-0">
                  <span className="block break-words font-medium text-foreground">{subject.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {subject.code} · {subject.topics.length} topic{subject.topics.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="tabular text-sm text-foreground">
                  {subject.pool.total} question{subject.pool.total === 1 ? '' : 's'}
                </span>
                <span className="tabular text-sm text-muted-foreground">
                  {subject.pool.total === 0
                    ? 'Nothing added yet'
                    : `${subject.pool.EASY} easy · ${subject.pool.MEDIUM} medium · ${subject.pool.HARD} hard`}
                </span>
                <ChevronRight className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

/** Step two: one subject's questions. */
function SubjectBank({
  subject,
  subjects,
  onBack,
  onChanged,
}: {
  subject: SubjectMeta;
  subjects: SubjectMeta[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [topicId, setTopicId] = React.useState(ALL);
  const [difficulty, setDifficulty] = React.useState(ALL);
  const [bloom, setBloom] = React.useState(ALL);
  const [type, setType] = React.useState(ALL);
  const [page, setPage] = React.useState(1);

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<QuestionRecord | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<QuestionListItem | null>(null);

  // Debounce so typing does not fire a request per keystroke.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '20',
      subjectId: subject.id,
    });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (topicId !== ALL) params.set('topicId', topicId);
    if (difficulty !== ALL) params.set('difficulty', difficulty);
    if (bloom !== ALL) params.set('bloom', bloom);
    if (type !== ALL) params.set('type', type);
    return `/api/admin/questions?${params.toString()}`;
  }, [page, subject.id, debouncedSearch, topicId, difficulty, bloom, type]);

  const { data, error, initialLoading, loading, refetch } = useApi<QuestionsResponse>(query);
  const questions = data?.questions ?? [];

  // The editor starts a new question in the first subject it is given, so the
  // open subject goes first. Memoised: the editor resets itself when this changes.
  const editorSubjects = React.useMemo(
    () => [subject, ...subjects.filter((entry) => entry.id !== subject.id)],
    [subject, subjects],
  );

  const changed = () => {
    void refetch();
    onChanged();
  };

  const remove = async (question: QuestionListItem) => {
    try {
      await apiFetch(`/api/admin/questions/${question.id}`, { method: 'DELETE' });
      toast.success('Question retired from the bank.');
      changed();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not remove that question.',
      );
    } finally {
      setDeleting(null);
    }
  };

  const narrowed = debouncedSearch !== '' || difficulty !== ALL || bloom !== ALL || type !== ALL;
  const filtered = narrowed || topicId !== ALL;

  const clearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setTopicId(ALL);
    setDifficulty(ALL);
    setType(ALL);
    setPage(1);
  };

  const pickTopic = (value: string) => {
    setTopicId(value);
    setPage(1);
  };

  const openEditor = (question: QuestionListItem | null) => {
    setEditing(question);
    setEditorOpen(true);
  };

  const topicName =
    topicId === NO_TOPIC
      ? 'No topic'
      : (subject.topics.find((topic) => topic.id === topicId)?.name ?? null);

  if (error && !data) {
    return (
      <PageShell>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Button variant="ghost" size="sm" className="-ml-2 mb-3" onClick={onBack}>
        <ArrowLeft />
        All subjects
      </Button>

      <PageHeader
        title={subject.name}
        description={`${subject.code} · ${subject.pool.total} question${subject.pool.total === 1 ? '' : 's'}`}
        actions={
          <>
            <Button variant="outline" onClick={() => setDuplicatesOpen(true)}>
              <Copy />
              Find repeats
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload />
              Import CSV
            </Button>
            <Button onClick={() => openEditor(null)}>
              <Plus />
              Add question
            </Button>
          </>
        }
      />

      <StudyMaterials subject={{ id: subject.id, name: subject.name }} topics={subject.topics} />

      <div className="mt-8 grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        {/* Topics: a list down the side on wide screens, a row that scrolls on narrow ones. */}
        <nav aria-label={`Topics in ${subject.name}`} className="min-w-0">
          <p className="type-eyebrow hidden lg:block">Topics</p>
          <ul className="scrollbar-slim -mx-1 flex gap-1 overflow-x-auto px-1 pb-2 lg:mx-0 lg:mt-2 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
            <TopicItem
              label="All topics"
              count={subject.pool.total}
              active={topicId === ALL}
              onClick={() => pickTopic(ALL)}
            />
            {subject.topics.map((topic) => (
              <TopicItem
                key={topic.id}
                label={topic.name}
                count={topic.count}
                active={topicId === topic.id}
                onClick={() => pickTopic(topic.id)}
              />
            ))}
            {subject.noTopic > 0 ? (
              <TopicItem
                label="No topic"
                count={subject.noTopic}
                active={topicId === NO_TOPIC}
                onClick={() => pickTopic(NO_TOPIC)}
              />
            ) : null}
          </ul>
        </nav>

        <div className="min-w-0">
          <FilterBar label="Filter questions" className="mt-0">
            <FilterSearch
              id="question-search"
              label="Search"
              value={search}
              onChange={setSearch}
              placeholder="Search question text"
            />

            <FilterSelect
              compact
              id="filter-difficulty"
              label="Difficulty"
              value={difficulty}
              onChange={(value) => {
                setDifficulty(value);
                setPage(1);
              }}
              options={[
                { value: ALL, label: 'All levels' },
                { value: 'EASY', label: 'Easy' },
                { value: 'MEDIUM', label: 'Medium' },
                { value: 'HARD', label: 'Hard' },
              ]}
            />

            <FilterSelect
              compact
              id="filter-bloom"
              label="Thinking level"
              value={bloom}
              onChange={(value) => {
                setBloom(value);
                setPage(1);
              }}
              options={[
                { value: ALL, label: 'Any thinking level' },
                ...BLOOM_ORDER.map((level) => ({ value: level, label: BLOOM_LABEL[level] })),
              ]}
            />

            <FilterSelect
              compact
              id="filter-type"
              label="Type"
              value={type}
              onChange={(value) => {
                setType(value);
                setPage(1);
              }}
              options={[
                { value: ALL, label: 'All types' },
                ...QUESTION_TYPE_ORDER.map((value) => ({
                  value,
                  label: QUESTION_TYPE_LABEL[value],
                })),
              ]}
            />
          </FilterBar>

          {initialLoading ? (
            <SkeletonRows rows={6} className="mt-6" />
          ) : questions.length === 0 ? (
            <div className="mt-6">
              <EmptyState
                icon={filtered ? SearchX : FileQuestion}
                title={filtered ? 'No matching questions' : `No ${subject.name} questions yet`}
                description={
                  filtered
                    ? 'Nothing in this subject matches. Try a broader search, or another topic.'
                    : 'Add questions one at a time or import a CSV. Quizzes cannot be published until the pool is large enough.'
                }
                action={
                  filtered ? (
                    <Button variant="outline" onClick={clearFilters}>
                      <X />
                      Clear filters
                    </Button>
                  ) : (
                    <Button onClick={() => openEditor(null)}>
                      <Plus />
                      Add question
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <div
              aria-busy={loading || undefined}
              className={cn('transition-opacity duration-fast', loading && 'opacity-60')}
            >
              <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                <p className="tabular text-sm text-muted-foreground" aria-live="polite">
                  Showing {questions.length} of {data?.total ?? 0}
                  {topicName ? ` in ${topicName}` : ''}
                </p>
                {filtered ? (
                  <Button variant="link" size="sm" className="h-auto px-1" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : null}
              </div>

              {/* Desktop: a table. */}
              <div className="mt-4 hidden rounded-lg border border-border bg-card md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Question</TableHead>
                      <TableHead>Difficulty</TableHead>
                      <TableHead className="hidden xl:table-cell">Type</TableHead>
                      <TableHead className="text-right">Used</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {questions.map((question) => (
                      <TableRow key={question.id}>
                        <TableCell className="min-w-[18rem] max-w-xl">
                          {/* Rendered rather than shown as source: a bank full of
                              raw `$\text{…}$` is unreadable when scanning. */}
                          <MathText
                            as="p"
                            text={question.text}
                            className="line-clamp-2 break-words text-sm text-foreground"
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            <QuestionFacts question={question} />
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {question.topic ?? 'No topic'}
                            <span className="xl:hidden"> · {QUESTION_TYPE_LABEL[question.type]}</span>
                          </p>
                        </TableCell>
                        <TableCell>
                          <DifficultyBadge difficulty={question.difficulty} />
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground xl:table-cell">
                          {QUESTION_TYPE_LABEL[question.type]}
                        </TableCell>
                        <TableCell className="tabular text-right text-sm">
                          {question.usageCount}
                        </TableCell>
                        <TableCell className="text-right">
                          <RowActions
                            question={question}
                            onEdit={() => openEditor(question)}
                            onRetire={() => setDeleting(question)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: the same facts as a list, nothing to scroll sideways. */}
              <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-card md:hidden">
                {questions.map((question) => (
                  <li key={question.id} className="p-4">
                    <MathText
                      as="p"
                      text={question.text}
                      className="line-clamp-3 break-words text-sm text-foreground"
                    />
                    <p className="mt-1.5 truncate text-xs text-muted-foreground">
                      {question.topic ?? 'No topic'}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <DifficultyBadge difficulty={question.difficulty} />
                      <Badge variant="outline">{QUESTION_TYPE_LABEL[question.type]}</Badge>
                      <span className="tabular text-xs text-muted-foreground">
                        <QuestionFacts question={question} /> · used {question.usageCount}×
                      </span>
                      <div className="ml-auto">
                        <RowActions
                          question={question}
                          onEdit={() => openEditor(question)}
                          onRetire={() => setDeleting(question)}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <nav
                aria-label="Question bank pages"
                className="mt-4 flex flex-wrap items-center justify-end gap-2"
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <ChevronLeft />
                  Previous
                </Button>
                <span className="tabular px-1 text-sm text-muted-foreground">
                  Page {data?.page ?? 1} of {data?.pageCount ?? 1}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= (data?.pageCount ?? 1) || loading}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                  <ChevronRight />
                </Button>
              </nav>
            </div>
          )}
        </div>
      </div>

      <QuestionEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        question={editing}
        subjects={editorSubjects}
        onSaved={changed}
      />

      <DuplicateFinder
        open={duplicatesOpen}
        onOpenChange={setDuplicatesOpen}
        subjectId={subject.id}
        subjectName={subject.name}
        onChanged={changed}
      />

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title={`Import ${subject.name} questions`}
        description="Valid rows are imported and problem rows are reported individually. Topics named in the file are created automatically inside this subject."
        columns="question, optionA, optionB, optionC, optionD, correct, difficulty, topic, marks, explanation, type, assertion, reason — the last three are optional. Type accepts MCQ, MULTI, TF, AR, SHORT, LONG or IMAGE; for MULTI put every correct letter in the correct column (AC), and for SHORT list accepted answers separated by |."
        sample={`Which protocol guarantees ordered delivery?,TCP,UDP,ICMP,ARP,A,MEDIUM,Transport Layer,1,TCP is connection-oriented.,MCQ
Which of these are connectionless?,UDP,TCP,ICMP,SCTP,AC,MEDIUM,Transport Layer,2,,MULTI
Expand the acronym TCP.,,,,,Transmission Control Protocol|TCP protocol,EASY,Transport Layer,1,,SHORT`}
        endpoint="/api/admin/questions/import"
        extraBody={{ subjectId: subject.id }}
        onImported={changed}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire this question?</AlertDialogTitle>
            <AlertDialogDescription>
              It will no longer be drawn into new papers. Past attempts that used it keep their
              record intact, so results and integrity reports stay accurate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && void remove(deleting)}>
              Retire question
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function TopicItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li className="shrink-0 lg:shrink">
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          'flex min-h-10 w-full items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-left text-sm transition-colors duration-fast ease-standard lg:border-transparent',
          active
            ? 'border-primary bg-accent font-medium text-accent-foreground lg:border-transparent'
            : 'border-border bg-card text-muted-foreground hover:text-foreground lg:bg-transparent lg:hover:bg-accent/50',
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className="tabular shrink-0 text-xs opacity-70">{count}</span>
      </button>
    </li>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: QuestionListItem['difficulty'] }) {
  const Icon = DIFFICULTY_ICON[difficulty];
  return (
    <Badge variant={DIFFICULTY_VARIANT[difficulty]}>
      <Icon aria-hidden />
      {difficulty.charAt(0) + difficulty.slice(1).toLowerCase()}
    </Badge>
  );
}

/** How the question is answered and what it is worth, in one line. */
function QuestionFacts({ question }: { question: QuestionListItem }) {
  return (
    <>
      {isOptionBased(question.type)
        ? `${question.options.length} options`
        : isManuallyMarked(question.type)
          ? 'Marked by hand'
          : `${question.acceptedAnswers?.length ?? 0} accepted answers`}
      {' · '}
      {question.marks} mark{question.marks === 1 ? '' : 's'}
      {question.negativeMarks > 0 ? ` · −${question.negativeMarks} negative` : ''}
      {question.bloom ? ` · ${BLOOM_LABEL[question.bloom]}` : ''}
      {question.aiGenerated ? ' · AI-drafted, reviewed' : ''}
    </>
  );
}

function RowActions({
  question,
  onEdit,
  onRetire,
}: {
  question: QuestionListItem;
  onEdit: () => void;
  onRetire: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Edit question: ${question.text.slice(0, 40)}`}
        onClick={onEdit}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hover:bg-danger-subtle hover:text-destructive"
        aria-label={`Retire question: ${question.text.slice(0, 40)}`}
        onClick={onRetire}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

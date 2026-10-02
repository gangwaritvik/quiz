'use client';

import {
  ChevronLeft,
  ChevronRight,
  FileQuestion,
  Pencil,
  Plus,
  Search,
  SignalHigh,
  SignalLow,
  SignalMedium,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { CsvImportDialog } from '@/components/admin/csv-import-dialog';
import { QuestionEditor, type QuestionRecord } from '@/components/admin/question-editor';
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
import { Badge, badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { buildFilterChips } from '@/lib/filter-chips';
import {
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_ORDER,
  type QuestionTypeValue,
  isManuallyMarked,
  isOptionBased,
} from '@/lib/question-types';
import { cn } from '@/lib/utils';

interface QuestionListItem extends QuestionRecord {
  subject: string;
  topic: string | null;
  usageCount: number;
}

interface QuestionsResponse {
  total: number;
  page: number;
  pageCount: number;
  questions: QuestionListItem[];
}

interface MetaData {
  subjects: Array<{
    id: string;
    name: string;
    code: string;
    topics: Array<{ id: string; name: string }>;
    pool: { total: number };
  }>;
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

export function QuestionBank() {
  const { data: meta } = useApi<MetaData>('/api/admin/meta');

  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [subjectId, setSubjectId] = React.useState(ALL);
  const [topicId, setTopicId] = React.useState(ALL);
  const [difficulty, setDifficulty] = React.useState(ALL);
  const [type, setType] = React.useState(ALL);
  const [page, setPage] = React.useState(1);

  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const filtersButtonRef = React.useRef<HTMLButtonElement>(null);

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<QuestionRecord | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [importSubjectId, setImportSubjectId] = React.useState('');
  const [deleting, setDeleting] = React.useState<QuestionListItem | null>(null);

  // Debounce so typing does not fire a request per keystroke.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = React.useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (subjectId !== ALL) params.set('subjectId', subjectId);
    if (topicId !== ALL) params.set('topicId', topicId);
    if (difficulty !== ALL) params.set('difficulty', difficulty);
    if (type !== ALL) params.set('type', type);
    return `/api/admin/questions?${params.toString()}`;
  }, [page, debouncedSearch, subjectId, topicId, difficulty, type]);

  const { data, error, initialLoading, loading, refetch } = useApi<QuestionsResponse>(query);

  const subjects = meta?.subjects ?? [];
  const selectedSubject = subjects.find((entry) => entry.id === subjectId);
  const questions = data?.questions ?? [];

  const remove = async (question: QuestionListItem) => {
    try {
      await apiFetch(`/api/admin/questions/${question.id}`, { method: 'DELETE' });
      toast.success('Question retired from the bank.');
      await refetch();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not remove that question.',
      );
    } finally {
      setDeleting(null);
    }
  };

  if (error && !data) {
    return (
      <PageShell>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  const filtered =
    debouncedSearch !== '' ||
    subjectId !== ALL ||
    topicId !== ALL ||
    difficulty !== ALL ||
    type !== ALL;

  // The search chip follows the applied query, so it matches the list below.
  const chips = buildFilterChips([
    {
      key: 'search',
      label: 'Search',
      value: debouncedSearch,
      display: `“${debouncedSearch}”`,
    },
    { key: 'subject', label: 'Subject', value: subjectId, display: selectedSubject?.name },
    {
      key: 'topic',
      label: 'Topic',
      value: topicId,
      display: selectedSubject?.topics.find((topic) => topic.id === topicId)?.name,
    },
    {
      key: 'difficulty',
      label: 'Difficulty',
      value: difficulty,
      display: difficulty.charAt(0) + difficulty.slice(1).toLowerCase(),
    },
    {
      key: 'type',
      label: 'Type',
      value: type,
      display: QUESTION_TYPE_LABEL[type as QuestionTypeValue],
    },
  ]);
  // Search sits outside the panel, so the button counts only what it reveals.
  const panelFilterCount = chips.filter((chip) => chip.key !== 'search').length;

  const clearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setSubjectId(ALL);
    setTopicId(ALL);
    setDifficulty(ALL);
    setType(ALL);
    setPage(1);
    // The clicked chip or link is about to unmount; keep keyboard focus somewhere sensible.
    filtersButtonRef.current?.focus();
  };

  const removeChip = (key: string) => {
    if (key === 'search') {
      setSearch('');
      setDebouncedSearch('');
    } else if (key === 'subject') {
      setSubjectId(ALL);
      setTopicId(ALL);
    } else if (key === 'topic') {
      setTopicId(ALL);
    } else if (key === 'difficulty') {
      setDifficulty(ALL);
    } else if (key === 'type') {
      setType(ALL);
    }
    setPage(1);
    filtersButtonRef.current?.focus();
  };

  const openEditor = (question: QuestionListItem) => {
    setEditing(question);
    setEditorOpen(true);
  };

  return (
    <PageShell>
      <PageHeader
        title="Question bank"
        description="Quizzes draw their papers from here at exam time. Correct answers never leave the server."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setImportSubjectId(subjectId !== ALL ? subjectId : (subjects[0]?.id ?? ''));
                setImportOpen(true);
              }}
              disabled={subjects.length === 0}
            >
              <Upload />
              Import CSV
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
              disabled={subjects.length === 0}
            >
              <Plus />
              Add question
            </Button>
          </>
        }
      />

      <div role="search" aria-label="Filter questions" className="mt-6">
        <div className="flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Label htmlFor="question-search" className="sr-only">
              Search
            </Label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="question-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search question text"
              className="pl-9"
            />
          </div>

          <Button
            ref={filtersButtonRef}
            variant="outline"
            aria-expanded={filtersOpen}
            aria-controls="question-filters"
            aria-label={panelFilterCount > 0 ? `Filters, ${panelFilterCount} active` : 'Filters'}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal />
            Filters
            {panelFilterCount > 0 ? <Badge className="tabular">{panelFilterCount}</Badge> : null}
          </Button>
        </div>

        {/* Subject, topic, difficulty and type live behind one button. State stays
            mounted while the panel is closed, so nothing resets when it toggles. */}
        <div id="question-filters" hidden={!filtersOpen}>
          <div className="mt-3 grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4">
            <FilterSelect
              id="filter-subject"
              label="Subject"
              value={subjectId}
              onChange={(value) => {
                setSubjectId(value);
                setTopicId(ALL);
                setPage(1);
              }}
              options={[
                { value: ALL, label: 'All subjects' },
                ...subjects.map((entry) => ({ value: entry.id, label: entry.name })),
              ]}
            />

            <FilterSelect
              id="filter-topic"
              label="Topic"
              value={topicId}
              onChange={(value) => {
                setTopicId(value);
                setPage(1);
              }}
              disabled={!selectedSubject}
              hint={selectedSubject ? undefined : 'Choose a subject first.'}
              options={[
                { value: ALL, label: 'Any topic' },
                ...(selectedSubject?.topics ?? []).map((topic) => ({
                  value: topic.id,
                  label: topic.name,
                })),
              ]}
            />

            <FilterSelect
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
          </div>
        </div>

        {chips.length > 0 ? (
          <ul aria-label="Active filters" className="mt-3 flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <li key={chip.key} className="max-w-full">
                <button
                  type="button"
                  aria-label={`Remove filter ${chip.text}`}
                  onClick={() => removeChip(chip.key)}
                  className={cn(
                    badgeVariants({ variant: 'outline' }),
                    'max-w-full cursor-pointer py-1 text-foreground hover:bg-accent [@media(pointer:coarse)]:min-h-11',
                  )}
                >
                  <span className="truncate">{chip.text}</span>
                  <X aria-hidden />
                </button>
              </li>
            ))}
            <li>
              <Button variant="link" size="sm" className="h-auto px-1" onClick={clearFilters}>
                Clear all
              </Button>
            </li>
          </ul>
        ) : null}
      </div>

      {initialLoading ? (
        <SkeletonRows rows={6} className="mt-6" />
      ) : questions.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={FileQuestion}
            title={filtered ? 'No matching questions' : 'The bank is empty'}
            description={
              filtered
                ? 'No questions match your filters. Try a broader search.'
                : 'Add questions manually or import a CSV. Quizzes cannot be published until the pool is large enough.'
            }
            action={
              filtered ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setEditorOpen(true);
                  }}
                >
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
          className={loading ? 'opacity-60 transition-opacity duration-fast' : 'transition-opacity duration-fast'}
        >
          <div className="mt-6 border-b border-border pb-3">
            <p className="tabular text-sm text-muted-foreground" aria-live="polite">
              Showing {questions.length} of {data?.total ?? 0} questions
            </p>
          </div>

          {/* Desktop: a ruled ledger. */}
          <div className="mt-4 hidden rounded-lg border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead className="hidden min-[1340px]:table-cell">Subject</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead className="hidden min-[1340px]:table-cell">Type</TableHead>
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
                      <p className="mt-0.5 truncate text-xs text-muted-foreground min-[1340px]:hidden">
                        {question.subject} · {question.topic ?? 'No topic'} ·{' '}
                        {QUESTION_TYPE_LABEL[question.type]}
                      </p>
                    </TableCell>
                    <TableCell className="hidden max-w-[12rem] min-[1340px]:table-cell">
                      <p className="truncate text-sm">{question.subject}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {question.topic ?? 'No topic'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <DifficultyBadge difficulty={question.difficulty} />
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground min-[1340px]:table-cell">
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
                  {question.subject}
                  {question.topic ? ` · ${question.topic}` : ''}
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

      <QuestionEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        question={editing}
        subjects={subjects}
        onSaved={() => void refetch()}
      />

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import questions"
        description="Valid rows are imported and problem rows are reported individually."
        columns="question, optionA, optionB, optionC, optionD, correct, difficulty, topic, marks, explanation, type, assertion, reason — the last three are optional. Type accepts MCQ, MULTI, TF, AR, SHORT, LONG or IMAGE; for MULTI put every correct letter in the correct column (AC), and for SHORT list accepted answers separated by |."
        sample={`Which protocol guarantees ordered delivery?,TCP,UDP,ICMP,ARP,A,MEDIUM,Transport Layer,1,TCP is connection-oriented.,MCQ
Which of these are connectionless?,UDP,TCP,ICMP,SCTP,AC,MEDIUM,Transport Layer,2,,MULTI
Expand the acronym TCP.,,,,,Transmission Control Protocol|TCP protocol,EASY,Transport Layer,1,,SHORT`}
        endpoint="/api/admin/questions/import"
        extraBody={{ subjectId: importSubjectId }}
        disabled={!importSubjectId}
        onImported={() => void refetch()}
      >
        <div className="space-y-2">
          <Label htmlFor="import-subject" required>
            Import into subject
          </Label>
          <Select value={importSubjectId} onValueChange={setImportSubjectId}>
            <SelectTrigger id="import-subject">
              <SelectValue placeholder="Select a subject" />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Topics named in the file are created automatically inside this subject.
          </p>
        </div>
      </CsvImportDialog>

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

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
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

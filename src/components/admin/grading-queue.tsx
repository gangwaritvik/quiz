'use client';

import {
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ListChecks,
  PenLine,
  RefreshCw,
  SearchX,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { FilterBar, FilterSearch, FilterSelect } from '@/components/admin/filter-select';
import { ErrorState } from '@/components/shared/error-state';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApi } from '@/hooks/use-api';
import { parseSectionLabel, sectionLabel } from '@/lib/section-label';
import { cn, formatDateTime } from '@/lib/utils';

interface QueueAttempt {
  attemptId: string;
  submittedAt: string | null;
  score: number | null;
  maxScore: number | null;
  pendingCount: number;
  completedAt: string | null;
  student: { name: string; rollNumber: string; section: string };
  quiz: { id: string; title: string; subject: string };
}

interface QueueResponse {
  total: number;
  page: number;
  pageCount: number;
  summary: { attemptsPending: number; answersPending: number };
  quizzes: Array<{ id: string; title: string; subjectId: string; pending: number }>;
  subjects: Array<{ id: string; name: string }>;
  sections: Array<{ department: string; section: string }>;
  attempts: QueueAttempt[];
}

const ALL = 'ALL';

const SORTS = {
  oldest: 'Longest waiting',
  newest: 'Newest first',
  student: 'Roll number (A–Z)',
  quiz: 'Quiz title (A–Z)',
} as const;
type Sort = keyof typeof SORTS;
const isSort = (value: string | null): value is Sort =>
  value !== null && (Object.keys(SORTS) as string[]).includes(value);

/** "Waiting 3 days" / "Waiting 5 hours" for an attempt still needing marks. */
function waiting(a: QueueAttempt) {
  if (!a.submittedAt || a.pendingCount === 0) return null;
  const hours = Math.max(0, Math.floor((Date.now() - new Date(a.submittedAt).getTime()) / 3_600_000));
  const [n, unit] = hours >= 24 ? [Math.floor(hours / 24), 'day'] : [hours, 'hour'];
  return <span className="block text-xs">Waiting {n} {unit}{n === 1 ? '' : 's'}</span>;
}

/**
 * The marking queue.
 *
 * Descriptive and uploaded answers cannot be marked by the server, so every
 * attempt containing one waits here. Until it is marked the student's score is
 * provisional, which is why the queue leads with how many people are waiting
 * rather than with how much work is outstanding.
 *
 * Filters, sort and page live in the URL, so refresh and back/forward keep them.
 */
export function GradingQueue() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <React.Suspense
      fallback={
        <PageShell>
          <SkeletonRows rows={5} />
        </PageShell>
      }
    >
      <GradingQueueView />
    </React.Suspense>
  );
}

function GradingQueueView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const q = (searchParams.get('q') ?? '').slice(0, 60);
  const quizId = searchParams.get('quizId') ?? '';
  const subjectId = searchParams.get('subjectId') ?? '';
  const sectionParam = searchParams.get('section') ?? '';
  const sortParam = searchParams.get('sort');
  const sort: Sort = isSort(sortParam) ? sortParam : 'oldest';
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '', 10) || 1);
  const includeCompleted = searchParams.get('includeCompleted') === 'true';

  /** Empty string removes the key. Anything but a page change goes back to page 1. */
  const setParams = React.useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(searchParams.toString());
      if (!('page' in patch)) next.delete('page');
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // The search box types ahead of the URL. `written` is the last value the two
  // agreed on, so the URL echoing our own write never overwrites newer typing,
  // while Clear or a link to the bare page does reset the box.
  const [search, setSearch] = React.useState(q);
  const written = React.useRef(q);
  React.useEffect(() => {
    if (q !== written.current) {
      written.current = q;
      setSearch(q);
    }
  }, [q]);
  React.useEffect(() => {
    const next = search.trim();
    if (next === written.current) return;
    const timer = window.setTimeout(() => {
      written.current = next;
      setParams({ q: next });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, setParams]);

  const query = React.useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20', sort });
    if (q) params.set('q', q);
    if (quizId) params.set('quizId', quizId);
    if (subjectId) params.set('subjectId', subjectId);
    const section = parseSectionLabel(sectionParam);
    if (section) {
      params.set('department', section.department);
      params.set('section', section.section);
    }
    if (includeCompleted) params.set('includeCompleted', 'true');
    return `/api/admin/grading?${params.toString()}`;
  }, [page, sort, q, quizId, subjectId, sectionParam, includeCompleted]);

  const { data, error, initialLoading, loading, refetch } = useApi<QueueResponse>(query);
  const attempts = data?.attempts ?? [];
  // Choosing a subject narrows the quiz list to that subject's quizzes.
  const quizzes = (data?.quizzes ?? []).filter((entry) => !subjectId || entry.subjectId === subjectId);
  const subjects = data?.subjects ?? [];
  const sections = data?.sections ?? [];

  // A page that no longer exists (a stale link, or the last row was just marked).
  React.useEffect(() => {
    if (data && data.page === page && page > data.pageCount) {
      setParams({ page: data.pageCount > 1 ? String(data.pageCount) : '' });
    }
  }, [data, page, setParams]);

  // Group by quiz in the order the server sent them, so the sort decides the
  // group order too: for "longest waiting" that is the oldest waiting attempt
  // first. A roll-number sort is a flat list; grouping would only fight it.
  const groups = React.useMemo(() => {
    if (sort === 'student') return null;
    const byQuiz = new Map<string, { quiz: QueueAttempt['quiz']; rows: QueueAttempt[] }>();
    for (const a of data?.attempts ?? []) {
      const group = byQuiz.get(a.quiz.id) ?? { quiz: a.quiz, rows: [] };
      group.rows.push(a);
      byQuiz.set(a.quiz.id, group);
    }
    return [...byQuiz.values()];
  }, [data, sort]);

  const filtered = q !== '' || quizId !== '' || subjectId !== '' || sectionParam !== '';
  const dirty = filtered || sort !== 'oldest' || includeCompleted;

  const clearFilters = () => {
    written.current = '';
    setSearch('');
    router.replace(pathname, { scroll: false });
  };

  if (error && !data) {
    return (
      <PageShell>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Marking"
        description="Descriptive and uploaded answers need a person. Scores stay provisional until you have marked them."
        actions={
          <>
            <Button asChild variant="outline">
              <Link
                href={
                  quizId
                    ? `/admin/grading/questions?quizId=${encodeURIComponent(quizId)}`
                    : '/admin/grading/questions'
                }
              >
                <ListChecks />
                Mark by question
              </Link>
            </Button>
            <Button variant="outline" onClick={() => void refetch()} loading={loading}>
              <RefreshCw />
              Refresh
            </Button>
          </>
        }
      />

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {initialLoading ? (
          <Skeleton className="h-5 w-64" />
        ) : data && data.summary.answersPending > 0 ? (
          <p className="flex items-center gap-2 text-sm text-foreground">
            <PenLine className="size-4 shrink-0 text-warning" aria-hidden />
            <span>
              <span className="tabular font-semibold">{data.summary.answersPending}</span> answer
              {data.summary.answersPending === 1 ? '' : 's'} to mark across{' '}
              <span className="tabular font-semibold">{data.summary.attemptsPending}</span> attempt
              {data.summary.attemptsPending === 1 ? '' : 's'}
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
            Nothing outstanding
          </p>
        )}

        <div className="flex min-h-10 items-center gap-3">
          <Switch
            id="include-completed"
            checked={includeCompleted}
            onCheckedChange={(value) => setParams({ includeCompleted: value ? 'true' : '' })}
          />
          <Label htmlFor="include-completed" className="cursor-pointer text-sm font-normal">
            Include attempts I have already finished marking
          </Label>
        </div>
      </div>

      <FilterBar label="Filter the marking queue">
        <FilterSearch
          id="queue-search"
          label="Search"
          value={search}
          maxLength={60}
          onChange={setSearch}
          placeholder="Search student name or roll number"
        />

        <FilterSelect
          compact
          id="queue-subject"
          label="Subject"
          value={subjectId || ALL}
          onChange={(value) =>
            // A quiz from another subject would leave the list empty.
            setParams({ subjectId: value === ALL ? '' : value, quizId: '' })
          }
          options={[
            { value: ALL, label: 'All subjects' },
            ...subjects.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
        />

        <FilterSelect
          compact
          className="sm:w-56"
          id="queue-quiz"
          label="Quiz"
          value={quizId || ALL}
          onChange={(value) => setParams({ quizId: value === ALL ? '' : value })}
          options={[
            { value: ALL, label: 'All my quizzes' },
            ...quizzes.map((entry) => ({
              value: entry.id,
              label: `${entry.title} (${entry.pending})`,
            })),
          ]}
        />

        <FilterSelect
          compact
          id="queue-section"
          label="Section"
          value={sectionParam || ALL}
          onChange={(value) => setParams({ section: value === ALL ? '' : value })}
          options={[
            { value: ALL, label: 'All sections' },
            ...sections.map((entry) => ({ value: sectionLabel(entry), label: sectionLabel(entry) })),
          ]}
        />

        <FilterSelect
          compact
          id="queue-sort"
          label="Sort by"
          value={sort}
          onChange={(value) => setParams({ sort: value === 'oldest' ? '' : value })}
          options={(Object.keys(SORTS) as Sort[]).map((value) => ({
            value,
            label: SORTS[value],
          }))}
        />

        {dirty ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X />
            Clear
          </Button>
        ) : null}
      </FilterBar>

      {initialLoading ? (
        <SkeletonRows rows={5} className="mt-5" />
      ) : attempts.length === 0 ? (
        <div className="mt-5">
          {filtered ? (
            <EmptyState
              icon={SearchX}
              title="No attempts match these filters"
              description="Try another name or roll number, a different quiz, or clear the filters to see the whole queue."
              action={
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={CheckCircle2}
              tone="success"
              title="Nothing waiting to be marked"
              description="Descriptive and image answers appear here as soon as a student submits one. Everything else is marked automatically at submission."
            />
          )}
        </div>
      ) : (
        <div
          aria-busy={loading || undefined}
          className={cn('transition-opacity duration-fast', loading && 'opacity-60')}
        >
          <div className="mt-5 rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead className="hidden min-[1340px]:table-cell">Quiz</TableHead>
                  <TableHead className="hidden min-[1340px]:table-cell">Submitted</TableHead>
                  <TableHead className="hidden text-right min-[1340px]:table-cell">Marked so far</TableHead>
                  <TableHead>Outstanding</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups
                  ? groups.map(({ quiz, rows }) => (
                      <React.Fragment key={quiz.id}>
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableCell colSpan={6} className="py-2">
                            <span className="text-sm font-semibold">{quiz.title}</span>
                            <span className="text-xs text-muted-foreground">
                              {' · '}
                              {quiz.subject} ·{' '}
                              <span className="tabular">
                                {rows.reduce((sum, row) => sum + row.pendingCount, 0)}
                              </span>{' '}
                              to mark
                            </span>
                          </TableCell>
                        </TableRow>
                        {rows.map((attempt) => (
                          <AttemptRow key={attempt.attemptId} attempt={attempt} />
                        ))}
                      </React.Fragment>
                    ))
                  : attempts.map((attempt) => (
                      <AttemptRow key={attempt.attemptId} attempt={attempt} />
                    ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Showing {attempts.length} of {data?.total ?? 0} attempts
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setParams({ page: page > 2 ? String(page - 1) : '' })}
              >
                Previous
              </Button>
              <span className="tabular px-1 text-sm text-muted-foreground">
                Page {data?.page ?? 1} of {data?.pageCount ?? 1}
              </span>
              <Button
                variant="outline"
                disabled={page >= (data?.pageCount ?? 1) || loading}
                onClick={() => setParams({ page: String(page + 1) })}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function AttemptRow({ attempt }: { attempt: QueueAttempt }) {
  return (
    <TableRow>
      <TableCell className="max-w-[18rem]">
        <p className="text-sm font-medium">{attempt.student.name}</p>
        <p className="whitespace-nowrap font-mono text-xs text-muted-foreground">
          {attempt.student.rollNumber} · Section {attempt.student.section}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground min-[1340px]:hidden">
          {attempt.quiz.title} ·{' '}
          <span className="tabular">
            {attempt.score ?? 0} / {attempt.maxScore ?? 0}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground min-[1340px]:hidden">{waiting(attempt)}</p>
      </TableCell>
      <TableCell className="hidden max-w-[18rem] min-[1340px]:table-cell">
        <p className="truncate text-sm">{attempt.quiz.title}</p>
        <p className="text-xs text-muted-foreground">{attempt.quiz.subject}</p>
      </TableCell>
      <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground min-[1340px]:table-cell">
        {attempt.submittedAt ? formatDateTime(attempt.submittedAt) : '—'}
        {waiting(attempt)}
      </TableCell>
      <TableCell className="tabular hidden whitespace-nowrap text-right text-sm min-[1340px]:table-cell">
        {attempt.score ?? 0} / {attempt.maxScore ?? 0}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {attempt.pendingCount > 0 ? (
          <Badge variant="warning">
            <Clock3 aria-hidden />
            <span className="tabular">{attempt.pendingCount}</span> to mark
          </Badge>
        ) : (
          <Badge variant="success">
            <CheckCircle2 aria-hidden />
            Done
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button asChild variant="outline">
          <Link
            href={`/admin/grading/${attempt.attemptId}`}
            aria-label={`${attempt.pendingCount > 0 ? 'Mark' : 'Review'} ${attempt.student.name}'s attempt`}
          >
            <ClipboardCheck />
            {attempt.pendingCount > 0 ? 'Mark' : 'Review'}
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

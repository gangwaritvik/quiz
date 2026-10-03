'use client';

import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  Download,
  SearchX,
  ShieldAlert,
  X,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import {
  FilterBar,
  FilterSearch,
  FilterSelect,
  FilterToggle,
} from '@/components/admin/filter-select';
import { ErrorState } from '@/components/shared/error-state';
import { IntegrityBadge, type IntegrityStatus } from '@/components/shared/integrity-badge';
import { PageHeader, PageShell } from '@/components/shared/page-header';
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
import { parseSectionLabel, sectionLabel } from '@/lib/section-label';
import { cn, formatDateTime } from '@/lib/utils';

interface ResultRow {
  attemptId: string;
  studentName: string;
  rollNumber: string;
  section: string;
  quizId: string;
  quizTitle: string;
  subject: string;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  correctCount: number | null;
  incorrectCount: number | null;
  unansweredCount: number | null;
  status: string;
  submittedAt: string | null;
  integrityScore: number | null;
  integrityStatus: IntegrityStatus | null;
}

interface QuizSummary {
  quizId: string;
  title: string;
  subject: string;
  attempts: number;
  average: number | null;
  median: number | null;
  highest: number | null;
  lowest: number | null;
  flagged: number;
}

interface ResultsData {
  /** Everything the caller could filter by, whatever is filtered now. */
  options: {
    subjects: Array<{ id: string; name: string }>;
    quizzes: Array<{ id: string; title: string; subjectId: string }>;
    sections: Array<{ department: string; section: string }>;
  };
  quizSummaries: QuizSummary[];
  results: ResultRow[];
}

const ALL = 'ALL';

export function AdminResults() {
  const [subjectId, setSubjectId] = React.useState('');
  const [selectedQuizId, setSelectedQuizId] = React.useState('');
  const [section, setSection] = React.useState('');
  const [flagged, setFlagged] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');

  // Typing waits a moment so each keystroke is not a request.
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const path = React.useMemo(() => {
    const params = new URLSearchParams();
    if (subjectId) params.set('subjectId', subjectId);
    if (selectedQuizId) params.set('quizId', selectedQuizId);
    const parsed = parseSectionLabel(section);
    if (parsed) {
      params.set('department', parsed.department);
      params.set('section', parsed.section);
    }
    if (flagged) params.set('flagged', 'true');
    if (debouncedSearch) params.set('q', debouncedSearch);
    const qs = params.toString();
    return qs ? `/api/admin/results?${qs}` : '/api/admin/results';
  }, [subjectId, selectedQuizId, section, flagged, debouncedSearch]);
  const { data, error, initialLoading, loading, refetch } = useApi<ResultsData>(path);

  const results = data?.results ?? [];
  const options = data?.options;
  const quizOptions = (options?.quizzes ?? []).filter(
    (quiz) => !subjectId || quiz.subjectId === subjectId,
  );
  const filtered = subjectId !== '' || section !== '' || flagged || debouncedSearch !== '';

  const clearFilters = () => {
    setSubjectId('');
    setSection('');
    setFlagged(false);
    setSearch('');
    setDebouncedSearch('');
  };

  /** Client-side CSV export of whatever the filters leave, so no extra endpoint. */
  const exportCsv = () => {
    const header = [
      'Student ID',
      'Name',
      'Section',
      'Quiz',
      'Subject',
      'Score',
      'Max',
      'Percentage',
      'Correct',
      'Incorrect',
      'Unanswered',
      'Submitted',
      'Integrity score',
      'Integrity status',
    ];

    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const lines = [
      header.join(','),
      ...results.map((row) =>
        [
          row.rollNumber,
          row.studentName,
          row.section,
          row.quizTitle,
          row.subject,
          row.score,
          row.maxScore,
          row.percentage,
          row.correctCount,
          row.incorrectCount,
          row.unansweredCount,
          row.submittedAt ? new Date(row.submittedAt).toISOString() : '',
          row.integrityScore,
          row.integrityStatus,
        ]
          .map(escape)
          .join(','),
      ),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `securequiz-results-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${results.length} result${results.length === 1 ? '' : 's'}.`);
  };

  if (error && !data) {
    return (
      <PageShell>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  const selected = selectedQuizId
    ? data?.quizSummaries.find((summary) => summary.quizId === selectedQuizId)
    : undefined;
  const selectedTitle =
    selected?.title ?? options?.quizzes.find((quiz) => quiz.id === selectedQuizId)?.title;

  return (
    <PageShell>
      <PageHeader
        title="Results"
        description="Graded attempts across your quizzes, with the integrity indicator alongside each score."
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={results.length === 0}>
            <Download />
            Export CSV
          </Button>
        }
      />

      {initialLoading ? (
        <SkeletonRows rows={6} className="mt-8" />
      ) : !options || options.quizzes.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={BarChart3}
            title="No graded attempts yet"
            description="Results appear as students submit. Every attempt is graded on the server against the stored answer key."
            action={
              <Button asChild variant="outline">
                <Link href="/admin/quizzes">View quizzes</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <FilterBar label="Filter results">
            <FilterSearch
              id="results-search"
              label="Search"
              value={search}
              maxLength={60}
              onChange={setSearch}
              placeholder="Search student, roll number or quiz"
            />

            <FilterSelect
              compact
              id="results-subject"
              label="Subject"
              value={subjectId || ALL}
              onChange={(value) => {
                setSubjectId(value === ALL ? '' : value);
                // A quiz from another subject would leave nothing to show.
                setSelectedQuizId('');
              }}
              options={[
                { value: ALL, label: 'All subjects' },
                ...options.subjects.map((entry) => ({ value: entry.id, label: entry.name })),
              ]}
            />

            <FilterSelect
              compact
              className="sm:w-56"
              id="results-quiz"
              label="Quiz"
              value={selectedQuizId || ALL}
              onChange={(value) => setSelectedQuizId(value === ALL ? '' : value)}
              options={[
                { value: ALL, label: 'All quizzes' },
                ...quizOptions.map((entry) => ({ value: entry.id, label: entry.title })),
              ]}
            />

            <FilterSelect
              compact
              id="results-section"
              label="Section"
              value={section || ALL}
              onChange={(value) => setSection(value === ALL ? '' : value)}
              options={[
                { value: ALL, label: 'All sections' },
                ...options.sections.map((entry) => ({
                  value: sectionLabel(entry),
                  label: sectionLabel(entry),
                })),
              ]}
            />

            <FilterToggle pressed={flagged} onPressedChange={setFlagged} icon={<ShieldAlert />}>
              Flagged only
            </FilterToggle>

            {filtered || selectedQuizId ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearFilters();
                  setSelectedQuizId('');
                }}
              >
                <X />
                Clear
              </Button>
            ) : null}
          </FilterBar>

          <div
            aria-busy={loading || undefined}
            className={cn('transition-opacity duration-fast', loading && 'opacity-60')}
          >
            {!selectedQuizId ? (
              <section aria-labelledby="choose-quiz-heading" className="mt-8">
                <h2 id="choose-quiz-heading" className="type-heading">
                  Quizzes
                </h2>
                <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
                  {data && data.quizSummaries.length > 0
                    ? 'Select a quiz to see the students who attempted it and review their answers.'
                    : 'Nothing matches these filters.'}
                </p>

                {data && data.quizSummaries.length > 0 ? (
                  <ul className="stagger mt-5 divide-y divide-border rounded-lg border border-border bg-card">
                    {data.quizSummaries.map((summary) => (
                      <li key={summary.quizId}>
                        <button
                          type="button"
                          onClick={() => setSelectedQuizId(summary.quizId)}
                          className="group grid w-full gap-x-8 gap-y-3 px-5 py-4 text-left transition-colors duration-fast ease-standard hover:bg-accent/40 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">
                              {summary.title}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                              {summary.subject}
                              {summary.flagged > 0 ? (
                                <span className="inline-flex items-center gap-1 text-warning">
                                  <ShieldAlert className="size-3.5" aria-hidden />
                                  {summary.flagged} flagged for review
                                </span>
                              ) : null}
                            </span>
                          </span>

                          <QuizFigures summary={summary} />

                          <ChevronRight
                            className="hidden size-4 text-muted-foreground transition-transform duration-fast ease-standard group-hover:translate-x-0.5 md:block"
                            aria-hidden
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-5">
                    <NoMatches onClear={clearFilters} />
                  </div>
                )}
              </section>
            ) : (
              <section aria-labelledby="selected-quiz-heading" className="mt-6">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2"
                  onClick={() => setSelectedQuizId('')}
                >
                  <ArrowLeft />
                  All quizzes
                </Button>

                <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div className="min-w-0">
                    {selected ? <p className="type-eyebrow">{selected.subject}</p> : null}
                    <h2 id="selected-quiz-heading" className="type-heading mt-1">
                      {selectedTitle ?? 'Selected quiz'}
                    </h2>
                  </div>
                  {selected ? <QuizFigures summary={selected} /> : null}
                </div>

                {results.length === 0 ? (
                  <div className="mt-6">
                    {filtered ? (
                      <NoMatches onClear={clearFilters} />
                    ) : (
                      <EmptyState
                        icon={BarChart3}
                        title="No students have attempted this quiz"
                        description="Student submissions will appear here after they finish the examination."
                      />
                    )}
                  </div>
                ) : (
                  <>
                    <p className="tabular mt-6 text-sm text-muted-foreground" aria-live="polite">
                      {results.length} attempt{results.length === 1 ? '' : 's'}
                    </p>
                    <div className="mt-3 rounded-lg border border-border bg-card">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Student</TableHead>
                            <TableHead className="text-right">Score</TableHead>
                            <TableHead className="hidden text-right md:table-cell">
                              Breakdown
                            </TableHead>
                            <TableHead className="hidden lg:table-cell">Submitted</TableHead>
                            <TableHead>Integrity</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {results.map((row) => (
                            <TableRow key={row.attemptId}>
                              <TableCell>
                                <Link
                                  href={`/admin/results/${row.attemptId}`}
                                  className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
                                >
                                  {row.studentName}
                                </Link>
                                <p className="font-mono text-xs text-muted-foreground">
                                  {row.rollNumber} · {row.section}
                                </p>
                              </TableCell>
                              <TableCell className="tabular whitespace-nowrap text-right">
                                <span className="font-semibold text-foreground">
                                  {row.percentage === null ? '—' : `${row.percentage}%`}
                                </span>
                                <p className="text-xs text-muted-foreground">
                                  {row.score}/{row.maxScore}
                                </p>
                              </TableCell>
                              <TableCell className="tabular hidden whitespace-nowrap text-right text-xs text-muted-foreground md:table-cell">
                                {row.correctCount} correct · {row.incorrectCount} wrong ·{' '}
                                {row.unansweredCount} blank
                              </TableCell>
                              <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground lg:table-cell">
                                {row.submittedAt ? formatDateTime(row.submittedAt) : '—'}
                                {row.status === 'AUTO_SUBMITTED' ? (
                                  <Badge variant="muted" className="ml-1.5">
                                    Auto
                                  </Badge>
                                ) : null}
                              </TableCell>
                              <TableCell>
                                {row.integrityStatus ? (
                                  <Link
                                    href={`/admin/integrity/${row.attemptId}`}
                                    className="inline-flex rounded-sm"
                                    title="Open the integrity report"
                                  >
                                    <IntegrityBadge
                                      status={row.integrityStatus}
                                      score={row.integrityScore}
                                    />
                                  </Link>
                                ) : (
                                  <span className="text-sm text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      icon={SearchX}
      title="No results match these filters"
      description="Try another name, a different quiz or section, or clear the filters."
      action={
        <Button variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  );
}

/** Average, median, range and count, aligned as a small ledger. */
function QuizFigures({ summary }: { summary: QuizSummary }) {
  const figures = [
    { label: 'Average', value: summary.average === null ? '—' : `${summary.average}%` },
    { label: 'Median', value: summary.median === null ? '—' : `${summary.median}%` },
    {
      label: 'Range',
      value: summary.lowest === null ? '—' : `${summary.lowest}–${summary.highest}%`,
    },
    { label: 'Attempts', value: String(summary.attempts) },
  ];

  return (
    <dl className="tabular grid shrink-0 grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid-cols-[4.5rem_4.5rem_8rem_4.5rem] sm:gap-x-5">
      {figures.map((figure, index) => (
        <div key={figure.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{figure.label}</dt>
          <dd
            className={cn(
              'mt-0.5 whitespace-nowrap leading-6 text-foreground',
              index === 0 ? 'font-serif text-lg font-semibold' : 'font-medium',
            )}
          >
            {figure.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

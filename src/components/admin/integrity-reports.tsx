'use client';

import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Info,
  Search,
  SearchX,
  ShieldCheck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { ErrorState } from '@/components/shared/error-state';
import { IntegrityBadge, type IntegrityStatus } from '@/components/shared/integrity-badge';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SkeletonRows } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApi } from '@/hooks/use-api';
import { cn, formatDateTime } from '@/lib/utils';

interface IntegrityReport {
  attemptId: string;
  score: number;
  status: IntegrityStatus;
  reviewed: boolean;
  studentName: string;
  rollNumber: string;
  section: string;
  quizTitle: string;
  subject: string;
  submittedAt: string | null;
  eventCount: number;
  reviewCount: number;
}

interface ReportsData {
  summary: { normal: number; review: number; highRisk: number };
  total: number;
  quizzes: Array<{ id: string; title: string }>;
  reports: IntegrityReport[];
}

const ALL = 'ALL';

/** The allowed values, with their labels. Defaults are in DEFAULTS and match the route's schema. */
const STATUSES = {
  'needs-review': 'Needs review',
  'high-risk': 'High risk',
  normal: 'Normal',
  all: 'All statuses',
} as const;
const REVIEWED = {
  unreviewed: 'Not yet reviewed',
  reviewed: 'Reviewed',
  all: 'Any',
} as const;
const SORTS = {
  risk: 'Highest risk first',
  newest: 'Newest submitted',
  oldest: 'Oldest submitted',
  student: 'Roll number (A–Z)',
} as const;

const DEFAULTS = { status: 'needs-review', reviewed: 'unreviewed', sort: 'risk' } as const;

const pick = <T extends string>(value: string | null, allowed: Record<T, string>, fallback: T): T =>
  value !== null && (Object.keys(allowed) as string[]).includes(value) ? (value as T) : fallback;

const optionsOf = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

/**
 * The integrity queue. Status, review state, quiz, sort and search live in the
 * URL, so refresh and back/forward keep them.
 */
export function IntegrityReports() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <React.Suspense
      fallback={
        <PageShell>
          <SkeletonRows rows={5} />
        </PageShell>
      }
    >
      <IntegrityReportsView />
    </React.Suspense>
  );
}

function IntegrityReportsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const q = (searchParams.get('q') ?? '').slice(0, 60);
  const quizId = searchParams.get('quizId') ?? '';
  const status = pick(searchParams.get('status'), STATUSES, DEFAULTS.status);
  const reviewed = pick(searchParams.get('reviewed'), REVIEWED, DEFAULTS.reviewed);
  const sort = pick(searchParams.get('sort'), SORTS, DEFAULTS.sort);

  /** Empty string removes the key, so the URL only carries what differs from the defaults. */
  const setParams = React.useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(searchParams.toString());
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

  const path = React.useMemo(() => {
    const params = new URLSearchParams({ status, reviewed, sort });
    if (q) params.set('q', q);
    if (quizId) params.set('quizId', quizId);
    return `/api/admin/integrity?${params.toString()}`;
  }, [status, reviewed, sort, q, quizId]);

  const { data, error, initialLoading, loading, refetch } = useApi<ReportsData>(path);

  const reports = data?.reports ?? [];
  const quizzes = data?.quizzes ?? [];
  const everything = data ? data.summary.normal + data.summary.review + data.summary.highRisk : 0;

  const filtered =
    q !== '' ||
    quizId !== '' ||
    status !== DEFAULTS.status ||
    reviewed !== DEFAULTS.reviewed;
  const dirty = filtered || sort !== DEFAULTS.sort;

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
        title="Integrity reports"
        description="Attempts with integrity signals, highest risk first."
      />

      <aside
        aria-label="How to read these scores"
        className="mt-6 flex max-w-3xl items-start gap-3 rounded-md border border-border bg-card px-4 py-3"
      >
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm leading-relaxed text-muted-foreground">
          The score counts technical events such as losing focus, leaving fullscreen, clipboard
          use and dropped connections. Each can have an ordinary explanation, so read the
          timeline before deciding anything.
        </p>
      </aside>

      <section aria-label="Summary" className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Normal"
          value={data?.summary.normal ?? 0}
          hint="No follow-up suggested"
          icon={ShieldCheck}
          tone="success"
          loading={initialLoading}
        />
        <StatCard
          label="Review recommended"
          value={data?.summary.review ?? 0}
          hint="Worth reading the timeline"
          icon={AlertTriangle}
          tone="warning"
          loading={initialLoading}
        />
        <StatCard
          label="High risk"
          value={data?.summary.highRisk ?? 0}
          hint="Several strong signals; still needs a person to review"
          icon={AlertOctagon}
          tone="warning"
          loading={initialLoading}
        />
      </section>

      <div
        role="search"
        aria-label="Filter integrity reports"
        className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_6rem] lg:items-end"
      >
        <div className="space-y-2 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="integrity-search">Search</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="integrity-search"
              type="search"
              value={search}
              maxLength={60}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Student name or roll number"
              className="pl-9"
            />
          </div>
        </div>

        <FilterSelect
          id="integrity-status"
          label="Status"
          value={status}
          onChange={(value) => setParams({ status: value === DEFAULTS.status ? '' : value })}
          options={optionsOf(STATUSES)}
        />

        <FilterSelect
          id="integrity-reviewed"
          label="Review"
          value={reviewed}
          onChange={(value) => setParams({ reviewed: value === DEFAULTS.reviewed ? '' : value })}
          options={optionsOf(REVIEWED)}
        />

        <FilterSelect
          id="integrity-quiz"
          label="Quiz"
          value={quizId || ALL}
          onChange={(value) => setParams({ quizId: value === ALL ? '' : value })}
          options={[
            { value: ALL, label: 'All my quizzes' },
            ...quizzes.map((entry) => ({ value: entry.id, label: entry.title })),
          ]}
        />

        <FilterSelect
          id="integrity-sort"
          label="Sort by"
          value={sort}
          onChange={(value) => setParams({ sort: value === DEFAULTS.sort ? '' : value })}
          options={optionsOf(SORTS)}
        />

        <div className={cn('sm:col-span-2 lg:col-span-1', !dirty && 'hidden lg:block')}>
          {dirty ? (
            <Button variant="ghost" onClick={clearFilters}>
              <X />
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {initialLoading ? (
        <SkeletonRows rows={5} className="mt-5" />
      ) : reports.length === 0 ? (
        <div className="mt-5">
          {filtered && everything > 0 ? (
            <EmptyState
              icon={SearchX}
              title="No attempts match these filters"
              description="Try another name or roll number, a different quiz or status, or clear the filters to see the whole queue."
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
              title="Nothing needs review"
              description="No attempt currently carries enough signals to warrant a look. This is the expected steady state."
            />
          )}
        </div>
      ) : (
        <div
          aria-busy={loading || undefined}
          className={cn('transition-opacity duration-fast', loading && 'opacity-60')}
        >
          <p className="tabular mt-5 text-sm text-muted-foreground" aria-live="polite">
            Showing {reports.length} of {everything} attempts
          </p>

          <div className="mt-3 rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead className="hidden min-[1340px]:table-cell">Quiz</TableHead>
                  <TableHead>Integrity indicator</TableHead>
                  <TableHead className="hidden text-right min-[1340px]:table-cell">Events</TableHead>
                  <TableHead className="hidden min-[1340px]:table-cell">Review</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Open</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.attemptId}>
                    <TableCell className="max-w-[18rem]">
                      <p className="font-medium">{report.studentName}</p>
                      <p className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {report.rollNumber} · {report.section}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground min-[1340px]:hidden">
                        {report.quizTitle} · {report.reviewed ? 'Reviewed' : 'Not yet reviewed'}
                      </p>
                    </TableCell>
                    <TableCell className="hidden max-w-[18rem] min-[1340px]:table-cell">
                      <p className="truncate text-sm">{report.quizTitle}</p>
                      <p className="text-xs text-muted-foreground">
                        {report.subject} ·{' '}
                        {report.submittedAt ? formatDateTime(report.submittedAt) : 'In progress'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <IntegrityBadge status={report.status} score={report.score} />
                    </TableCell>
                    <TableCell className="tabular hidden text-right text-sm text-muted-foreground min-[1340px]:table-cell">
                      {report.eventCount}
                    </TableCell>
                    <TableCell className="hidden min-[1340px]:table-cell">
                      {report.reviewed ? (
                        <Badge variant="success">
                          <CheckCircle2 aria-hidden />
                          Reviewed
                        </Badge>
                      ) : (
                        <Badge variant="muted">
                          <CircleDashed aria-hidden />
                          Not yet reviewed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button asChild variant="outline">
                        <Link
                          href={`/admin/integrity/${report.attemptId}`}
                          aria-label={`Open report for ${report.studentName}`}
                        >
                          Open report
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
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
    </div>
  );
}

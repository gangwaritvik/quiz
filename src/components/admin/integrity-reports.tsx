'use client';

import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed, Info, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { ErrorState } from '@/components/shared/error-state';
import { IntegrityBadge, type IntegrityStatus } from '@/components/shared/integrity-badge';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApi } from '@/hooks/use-api';
import { formatDateTime } from '@/lib/utils';

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
  reports: IntegrityReport[];
}

type Filter = 'NEEDS_REVIEW' | 'HIGH_RISK' | 'REVIEWED' | 'ALL';

export function IntegrityReports() {
  const [filter, setFilter] = React.useState<Filter>('NEEDS_REVIEW');

  const path = React.useMemo(() => {
    if (filter === 'HIGH_RISK') return '/api/admin/integrity?status=HIGH_RISK';
    if (filter === 'REVIEWED') return '/api/admin/integrity?reviewed=true';
    if (filter === 'NEEDS_REVIEW') return '/api/admin/integrity?reviewed=false';
    return '/api/admin/integrity?status=ALL';
  }, [filter]);

  const { data, error, initialLoading, refetch } = useApi<ReportsData>(path);

  // "Needs review" is about attention, not accusation: normal attempts that
  // simply have not been looked at are excluded from this queue.
  const reports = (data?.reports ?? []).filter((report) =>
    filter === 'NEEDS_REVIEW' ? report.status !== 'NORMAL' : true,
  );

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
        description="A queue of attempts worth a closer look, ordered by score."
      />

      <aside
        aria-label="How to read these scores"
        className="mt-6 flex max-w-3xl items-start gap-3 rounded-md border border-border bg-card px-4 py-3"
      >
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">How to read these scores.</span> The
          integrity engine counts technical events — losing focus, leaving fullscreen, clipboard
          use, dropped connections. Each has ordinary explanations, and the score is designed to
          prompt a human look, not to reach a conclusion. Open the timeline before deciding
          anything, and treat a low score as a question rather than an answer.
        </p>
      </aside>

      <section aria-label="Summary" className="mt-8 grid gap-4 sm:grid-cols-3">
        <StatCard
          index={0}
          label="Normal"
          value={data?.summary.normal ?? 0}
          hint="No follow-up suggested"
          icon={ShieldCheck}
          tone="success"
          loading={initialLoading}
        />
        <StatCard
          index={1}
          label="Review recommended"
          value={data?.summary.review ?? 0}
          hint="Worth reading the timeline"
          icon={AlertTriangle}
          tone="warning"
          loading={initialLoading}
        />
        <StatCard
          index={2}
          label="High risk"
          value={data?.summary.highRisk ?? 0}
          hint="Several strong signals recorded — still needs a person"
          icon={AlertOctagon}
          tone="warning"
          loading={initialLoading}
        />
      </section>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)} className="mt-8">
        <TabsList aria-label="Filter reports">
          <TabsTrigger value="NEEDS_REVIEW">Needs review</TabsTrigger>
          <TabsTrigger value="HIGH_RISK">High risk</TabsTrigger>
          <TabsTrigger value="REVIEWED">Reviewed</TabsTrigger>
          <TabsTrigger value="ALL">All attempts</TabsTrigger>
        </TabsList>
      </Tabs>

      {initialLoading ? (
        <SkeletonRows rows={5} className="mt-5" />
      ) : reports.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={CheckCircle2}
            tone="success"
            title={filter === 'REVIEWED' ? 'Nothing reviewed yet' : 'Nothing needs review'}
            description={
              filter === 'REVIEWED'
                ? 'Attempts you mark as reviewed will be listed here with your notes.'
                : 'No attempt currently carries enough signals to warrant a look. This is the expected steady state.'
            }
          />
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead className="hidden xl:table-cell">Quiz</TableHead>
                <TableHead>Integrity indicator</TableHead>
                <TableHead className="hidden text-right xl:table-cell">Events</TableHead>
                <TableHead className="hidden xl:table-cell">Review</TableHead>
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
                    <p className="mt-0.5 truncate text-xs text-muted-foreground xl:hidden">
                      {report.quizTitle} · {report.reviewed ? 'Reviewed' : 'Not yet reviewed'}
                    </p>
                  </TableCell>
                  <TableCell className="hidden max-w-[18rem] xl:table-cell">
                    <p className="truncate text-sm">{report.quizTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      {report.subject} ·{' '}
                      {report.submittedAt ? formatDateTime(report.submittedAt) : 'In progress'}
                    </p>
                  </TableCell>
                  <TableCell>
                    <IntegrityBadge status={report.status} score={report.score} />
                  </TableCell>
                  <TableCell className="tabular hidden text-right text-sm text-muted-foreground xl:table-cell">
                    {report.eventCount}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
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
      )}
    </PageShell>
  );
}

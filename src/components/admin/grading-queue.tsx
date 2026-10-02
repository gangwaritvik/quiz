'use client';

import { CheckCircle2, ClipboardCheck, Clock3, PenLine, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

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
import { formatDateTime } from '@/lib/utils';

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
  attempts: QueueAttempt[];
}

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
 */
export function GradingQueue() {
  const [page, setPage] = React.useState(1);
  const [includeCompleted, setIncludeCompleted] = React.useState(false);

  const query = React.useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (includeCompleted) params.set('includeCompleted', 'true');
    return `/api/admin/grading?${params.toString()}`;
  }, [page, includeCompleted]);

  const { data, error, initialLoading, loading, refetch } = useApi<QueueResponse>(query);
  const attempts = data?.attempts ?? [];

  // Group by quiz (groups ordered by their oldest submission), oldest first within each.
  const groups = React.useMemo(() => {
    const at = (a: QueueAttempt) => (a.submittedAt ? new Date(a.submittedAt).getTime() : Infinity);
    const byQuiz = new Map<string, { quiz: QueueAttempt['quiz']; rows: QueueAttempt[] }>();
    for (const a of [...(data?.attempts ?? [])].sort((x, y) => at(x) - at(y))) {
      const group = byQuiz.get(a.quiz.id) ?? { quiz: a.quiz, rows: [] };
      group.rows.push(a);
      byQuiz.set(a.quiz.id, group);
    }
    return [...byQuiz.values()];
  }, [data]);

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
          <Button variant="outline" onClick={() => void refetch()} loading={loading}>
            <RefreshCw />
            Refresh
          </Button>
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
            onCheckedChange={(value) => {
              setIncludeCompleted(value);
              setPage(1);
            }}
          />
          <Label htmlFor="include-completed" className="cursor-pointer text-sm font-normal">
            Include attempts I have already finished marking
          </Label>
        </div>
      </div>

      {initialLoading ? (
        <SkeletonRows rows={5} className="mt-5" />
      ) : attempts.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={CheckCircle2}
            tone="success"
            title="Nothing waiting to be marked"
            description="Descriptive and image answers appear here as soon as a student submits one. Everything else is marked automatically at submission."
          />
        </div>
      ) : (
        <>
          <div className="mt-5 rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead className="hidden xl:table-cell">Quiz</TableHead>
                  <TableHead className="hidden xl:table-cell">Submitted</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">Marked so far</TableHead>
                  <TableHead>Outstanding</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map(({ quiz, rows }) => (
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
                  <TableRow key={attempt.attemptId}>
                    <TableCell className="max-w-[18rem]">
                      <p className="text-sm font-medium">{attempt.student.name}</p>
                      <p className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {attempt.student.rollNumber} · Section {attempt.student.section}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground xl:hidden">
                        {attempt.quiz.title} ·{' '}
                        <span className="tabular">
                          {attempt.score ?? 0} / {attempt.maxScore ?? 0}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground xl:hidden">
                        {waiting(attempt)}
                      </p>
                    </TableCell>
                    <TableCell className="hidden max-w-[18rem] xl:table-cell">
                      <p className="truncate text-sm">{attempt.quiz.title}</p>
                      <p className="text-xs text-muted-foreground">{attempt.quiz.subject}</p>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground xl:table-cell">
                      {attempt.submittedAt ? formatDateTime(attempt.submittedAt) : '—'}
                      {waiting(attempt)}
                    </TableCell>
                    <TableCell className="tabular hidden whitespace-nowrap text-right text-sm xl:table-cell">
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
                    ))}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {attempts.length} of {data?.total ?? 0} attempts
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </Button>
              <span className="tabular px-1 text-sm text-muted-foreground">
                Page {data?.page ?? 1} of {data?.pageCount ?? 1}
              </span>
              <Button
                variant="outline"
                disabled={page >= (data?.pageCount ?? 1) || loading}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}

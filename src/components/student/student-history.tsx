'use client';

import {
  Ban,
  CheckCircle2,
  CircleSlash,
  History,
  Hourglass,
  Info,
  Lock,
  type LucideIcon,
  Timer,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { ErrorState } from '@/components/shared/error-state';
import type { IntegrityStatus } from '@/components/shared/integrity-badge';
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
import { formatDateTime, pluralize } from '@/lib/utils';

interface HistoryAttempt {
  id: string;
  quizTitle: string;
  subject: string;
  subjectCode: string;
  status: string;
  attemptNumber: number;
  startedAt: string;
  submittedAt: string | null;
  resultsReleased: boolean;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  integrityScore: number | null;
  integrityStatus: IntegrityStatus | null;
  eventCount: number;
}

const STATUS_LABEL: Record<
  string,
  { label: string; icon: LucideIcon; variant: 'success' | 'warning' | 'muted' | 'danger' }
> = {
  SUBMITTED: { label: 'Submitted', icon: CheckCircle2, variant: 'success' },
  AUTO_SUBMITTED: { label: 'Auto-submitted', icon: Timer, variant: 'warning' },
  IN_PROGRESS: { label: 'In progress', icon: Hourglass, variant: 'warning' },
  EXPIRED: { label: 'Expired', icon: CircleSlash, variant: 'muted' },
  TERMINATED: { label: 'Terminated', icon: Ban, variant: 'danger' },
};

export function StudentHistory() {
  const { data, error, initialLoading, refetch } = useApi<{ attempts: HistoryAttempt[] }>(
    '/api/student/history',
  );

  const attempts = data?.attempts ?? [];

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
        title="Exam History"
        description="A complete record of your attempts."
      />

      <p className="mt-6 flex max-w-3xl items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
        <Info className="mt-1 size-4 shrink-0" aria-hidden />
        <span>
          Some attempts show &ldquo;Under review by your faculty&rdquo;. Your faculty may look at how
          the attempt went before your result is final. You don&apos;t need to do anything; contact
          your faculty member if you have questions.
        </span>
      </p>

      {initialLoading ? (
        <SkeletonRows rows={5} className="mt-8" />
      ) : attempts.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={History}
          title="No attempts yet"
          description="Your examination history will build up here as you complete quizzes."
          action={
            <Button asChild variant="outline">
              <Link href="/quizzes">View my quizzes</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop: a ruled ledger. */}
          <div className="mt-8 hidden rounded-lg border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quiz</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts.map((attempt) => (
                  <TableRow key={attempt.id}>
                    <TableCell className="min-w-[14rem] max-w-sm">
                      <p className="break-words font-medium">{attempt.quizTitle}</p>
                      <p className="text-xs text-muted-foreground">
                        {attempt.subject}
                        {attempt.attemptNumber > 1 ? ` · Attempt ${attempt.attemptNumber}` : ''}
                      </p>
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(attempt.startedAt)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={attempt.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <AttemptScore attempt={attempt} />
                    </TableCell>
                    <TableCell>
                      <AttemptIntegrity attempt={attempt} />
                    </TableCell>
                    <TableCell className="tabular text-right text-sm text-muted-foreground">
                      {attempt.eventCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: the same facts as a stacked list. */}
          <ul className="mt-8 divide-y divide-border rounded-lg border border-border bg-card md:hidden">
            {attempts.map((attempt) => (
              <li key={attempt.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">{attempt.quizTitle}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {attempt.subject}
                      {attempt.attemptNumber > 1 ? ` · Attempt ${attempt.attemptNumber}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <AttemptScore attempt={attempt} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusBadge status={attempt.status} />
                  <AttemptIntegrity attempt={attempt} />
                </div>
                <p className="tabular mt-2 text-xs text-muted-foreground">
                  Started {formatDateTime(attempt.startedAt)} ·{' '}
                  {pluralize(attempt.eventCount, 'event')}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </PageShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_LABEL[status];
  if (!config) return <Badge variant="muted">{status}</Badge>;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant}>
      <Icon aria-hidden />
      {config.label}
    </Badge>
  );
}

/** The score only appears once faculty releases it. */
function AttemptScore({ attempt }: { attempt: HistoryAttempt }) {
  if (attempt.resultsReleased && attempt.percentage !== null) {
    return (
      <Link
        href={`/results/${attempt.id}`}
        className="tabular inline-flex min-h-10 items-center font-medium text-primary underline-offset-4 hover:underline md:min-h-0"
      >
        {attempt.percentage}%
      </Link>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
      <Lock className="size-3.5 shrink-0" aria-hidden />
      Not released
    </span>
  );
}

/** Flagged attempts get one neutral note; no score, no risk wording, nothing when clear. */
function AttemptIntegrity({ attempt }: { attempt: HistoryAttempt }) {
  if (!attempt.integrityStatus || attempt.integrityStatus === 'NORMAL') return null;
  return (
    <Badge variant="muted">
      <Hourglass aria-hidden />
      Under review by your faculty
    </Badge>
  );
}

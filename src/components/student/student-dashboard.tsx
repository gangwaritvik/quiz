'use client';

import { CalendarCheck, ChevronRight, Hourglass, Lock } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { ErrorState } from '@/components/shared/error-state';
import type { IntegrityStatus } from '@/components/shared/integrity-badge';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { QuizCard, type QuizState, type StudentQuizSummary } from '@/components/student/quiz-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/use-api';
import { formatDateTime, formatRelativeDay, greeting, pluralize } from '@/lib/utils';

interface DashboardData {
  student: {
    name: string;
    rollNumber: string | null;
    department: string | null;
    section: string | null;
  };
  stats: {
    upcomingCount: number;
    completed: number;
    averageScore: number | null;
    integrityScore: number;
    integrityStatus: IntegrityStatus;
  };
  upcoming: StudentQuizSummary[];
  recentResults: RecentResult[];
}

interface RecentResult {
  attemptId: string;
  title: string;
  subject: string;
  submittedAt: string | null;
  released: boolean;
  percentage: number | null;
  awaitingMarking: boolean;
}

/** Display order: what needs action now comes first. */
const URGENCY: Record<QuizState, number> = {
  IN_PROGRESS: 0,
  AVAILABLE: 1,
  SCHEDULED: 2,
  CLOSED: 3,
  COMPLETED: 4,
};

/** One sentence that answers "what do I need to do next?". */
function nextStep(quizzes: StudentQuizSummary[]) {
  const inProgress = quizzes.filter((quiz) => quiz.state === 'IN_PROGRESS').length;
  if (inProgress > 0) {
    return `You have ${inProgress === 1 ? 'an exam' : `${inProgress} exams`} in progress. Resume before the window closes.`;
  }
  const open = quizzes.filter((quiz) => quiz.state === 'AVAILABLE').length;
  if (open > 0) {
    return `${pluralize(open, 'exam')} open now. Read the rules and run the checks before you start.`;
  }
  const next = quizzes
    .filter((quiz) => quiz.state === 'SCHEDULED')
    .reduce<StudentQuizSummary | null>(
      (soonest, quiz) => (!soonest || quiz.startsAt < soonest.startsAt ? quiz : soonest),
      null,
    );
  return next ? `Your next exam opens ${formatRelativeDay(next.startsAt)}.` : null;
}

export function StudentDashboard() {
  const { data, error, initialLoading, refetch } = useApi<DashboardData>(
    '/api/student/dashboard',
    { refreshInterval: 60_000 },
  );

  const firstName = data?.student.name.split(' ')[0] ?? 'there';
  const stats = data?.stats;

  // Completed quizzes stay in the feed for the day; the header list only shows
  // what the student still has to do.
  const upcoming = (data?.upcoming ?? [])
    .filter((quiz) => quiz.state !== 'COMPLETED')
    .sort((a, b) => URGENCY[a.state] - URGENCY[b.state]);
  const summary = nextStep(upcoming);

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
        title={
          initialLoading ? (
            <Skeleton className="h-8 w-64 max-w-full" />
          ) : (
            <>
              {greeting()}, {firstName}
            </>
          )
        }
        description={
          initialLoading ? undefined : (
            <>
              {data?.student.rollNumber ? `${data.student.rollNumber} · ` : ''}
              {data?.student.department}
              {data?.student.section ? ` · Section ${data.student.section}` : ''}
            </>
          )
        }
      />

      <section aria-labelledby="upcoming-heading" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h2 id="upcoming-heading" className="type-heading">
              Up next
            </h2>
            {initialLoading ? (
              <Skeleton className="mt-2 h-4 w-72 max-w-full" />
            ) : summary ? (
              <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
            ) : null}
          </div>
          <Link
            href="/quizzes"
            className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            All quizzes
          </Link>
        </div>

        {initialLoading ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SkeletonCard className="h-60" />
            <SkeletonCard className="h-60" />
            <SkeletonCard className="hidden h-60 xl:block" />
          </div>
        ) : upcoming.length === 0 ? (
          <EmptyState
            className="mt-5"
            icon={CalendarCheck}
            tone="success"
            title="No upcoming examinations"
            description="You have nothing scheduled at the moment. New quizzes assigned by your faculty will appear here automatically."
            action={
              <Button asChild variant="outline">
                <Link href="/history">Review past attempts</Link>
              </Button>
            }
          />
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {upcoming.map((quiz, index) => (
              <QuizCard key={quiz.id} quiz={quiz} index={index} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="glance-heading" className="mt-12">
        <h2 id="glance-heading" className="type-heading">
          At a glance
        </h2>
        {/* Hairlines between cells come from the 1px gap over a border-coloured
            backdrop, so they reflow correctly at every column count. */}
        <dl className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
          <Stat
            label="Upcoming quizzes"
            loading={initialLoading}
            value={stats?.upcomingCount ?? 0}
            hint={
              stats?.upcomingCount
                ? `${stats.upcomingCount === 1 ? 'One exam' : `${stats.upcomingCount} exams`} assigned to you`
                : 'Nothing scheduled right now'
            }
          />
          <Stat
            label="Completed"
            loading={initialLoading}
            value={stats?.completed ?? 0}
            hint="Quizzes you have submitted"
          />
          <Stat
            label="Average score"
            loading={initialLoading}
            value={stats?.averageScore === null ? '—' : `${stats?.averageScore ?? 0}%`}
            hint={
              stats?.averageScore === null
                ? 'Available after your first result'
                : 'Across released results'
            }
          />
        </dl>
      </section>

      <RecentResults results={data?.recentResults ?? []} loading={initialLoading} />
    </PageShell>
  );
}

function Stat({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  hint: React.ReactNode;
  loading: boolean;
}) {
  return (
    <div className="min-w-0 bg-card p-4 sm:p-5">
      <dt className="truncate text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="tabular mt-1.5 font-serif text-2xl font-semibold leading-tight text-foreground">
        {loading ? <Skeleton className="h-7 w-14" /> : value}
      </dd>
      <dd className="mt-1.5 text-xs text-muted-foreground">
        {loading ? <Skeleton className="h-3 w-28" /> : hint}
      </dd>
    </div>
  );
}

/**
 * The last few submitted papers.
 *
 * The score obeys the same two gates as the results page: nothing is shown
 * until faculty releases it, and a paper still with a marker says so rather
 * than showing a total that will move.
 */
function RecentResults({ results, loading }: { results: RecentResult[]; loading: boolean }) {
  if (!loading && results.length === 0) return null;

  return (
    <section aria-labelledby="recent-results-heading" className="mt-12">
      <div className="flex items-end justify-between gap-4">
        <h2 id="recent-results-heading" className="type-heading">
          Recent results
        </h2>
        <Link
          href="/results"
          className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          All results
        </Link>
      </div>

      {loading ? (
        <SkeletonCard className="mt-4 h-40" />
      ) : (
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {results.map((result) => (
            <li key={result.attemptId}>
              <Link
                href={`/results/${result.attemptId}`}
                className="flex items-center gap-4 px-4 py-3.5 transition-colors duration-fast ease-standard hover:bg-accent/40 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{result.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {result.subject}
                    {result.submittedAt ? ` · ${formatDateTime(result.submittedAt)}` : ''}
                  </p>
                </div>

                {result.released && typeof result.percentage === 'number' ? (
                  <span className="tabular shrink-0 text-right font-serif text-lg font-semibold text-foreground">
                    {result.percentage}%
                    {result.awaitingMarking ? (
                      <span className="block font-sans text-xs font-medium text-muted-foreground">
                        Provisional
                      </span>
                    ) : null}
                  </span>
                ) : result.awaitingMarking ? (
                  <Badge variant="warning">
                    <Hourglass aria-hidden />
                    Being marked
                  </Badge>
                ) : (
                  <Badge variant="muted">
                    <Lock aria-hidden />
                    Not released
                  </Badge>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

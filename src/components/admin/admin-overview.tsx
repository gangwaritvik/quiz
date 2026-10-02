'use client';

import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FilePlus2,
  MonitorPlay,
  PenLine,
  ShieldAlert,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { ChartFrame } from '@/components/admin/charts/chart-frame';
import {
  AverageScoreChart,
  ParticipationChart,
  type DashboardCharts,
} from '@/components/admin/charts/dashboard-charts';
import { ErrorState } from '@/components/shared/error-state';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { useApi } from '@/hooks/use-api';
import { cn, formatDateTime, greeting, longDate, relativeTime } from '@/lib/utils';

interface RecentQuiz {
  id: string;
  title: string;
  subject: string;
  questionCount: number;
  assigned: number;
  attempts: number;
  startsAt: string;
  endsAt: string;
  state: 'LIVE' | 'SCHEDULED' | 'CLOSED';
}

interface MarkingQueueItem {
  quizId: string;
  title: string;
  papers: number;
  answers: number;
  waitingSince: string | null;
}

interface AtRiskStudent {
  studentId: string;
  name: string;
  rollNumber: string | null;
  section: string | null;
  average: number | null;
  attempts: number;
  missed: number;
}

interface ActivityItem {
  id: string;
  kind: 'SUBMISSION' | 'PUBLISHED' | 'FLAGGED' | 'MARKING';
  text: string;
  detail: string | null;
  href: string;
  at: string;
}

interface OverviewData {
  faculty: { name: string };
  activity: ActivityItem[];
  stats: {
    activeExams: number;
    studentsTakingExams: number;
    completedAttempts: number;
    flaggedAttempts: number;
    answersAwaitingMarking: number;
    averageScore: number | null;
    scoreTrend: number | null;
  };
  charts: DashboardCharts;
  recentQuizzes: RecentQuiz[];
  markingQueue: MarkingQueueItem[];
  atRiskStudents: AtRiskStudent[];
}

const QUIZ_STATE: Record<RecentQuiz['state'], { label: string; variant: 'success' | 'secondary' | 'muted' }> = {
  LIVE: { label: 'Live', variant: 'success' },
  SCHEDULED: { label: 'Scheduled', variant: 'secondary' },
  CLOSED: { label: 'Closed', variant: 'muted' },
};

export function AdminOverview() {
  const { data, error, initialLoading, refetch } = useApi<OverviewData>('/api/admin/overview', {
    refreshInterval: 30_000,
  });

  // The clock is read after mount, never during render. The server and the
  // browser do not share an instant or a timezone, so formatting "now" inline
  // produces markup that cannot hydrate cleanly.
  const [today, setToday] = React.useState<Date | null>(null);
  React.useEffect(() => setToday(new Date()), []);

  if (error && !data) {
    return (
      <PageShell>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  const stats = data?.stats;
  const firstName = data?.faculty.name ?? 'there';

  return (
    <PageShell>
      <PageHeader
        title={
          initialLoading || !today ? (
            <Skeleton className="h-9 w-72 max-w-full" />
          ) : (
            `${greeting(today)}, ${firstName}`
          )
        }
        description={
          <>
            {today ? (
              <time dateTime={today.toISOString()} className="font-medium text-foreground">
                {longDate(today)}.{' '}
              </time>
            ) : null}
            Here&apos;s what&apos;s happening with your exams today.
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/admin/live">
                <MonitorPlay />
                Live exams
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/quizzes/new">
                <FilePlus2 />
                Create quiz
              </Link>
            </Button>
          </>
        }
      />

      <section
        aria-label="Summary"
        className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          index={0}
          label="Answers to mark"
          value={stats?.answersAwaitingMarking ?? 0}
          hint={stats?.answersAwaitingMarking ? 'Students are waiting' : 'Nothing outstanding'}
          icon={PenLine}
          tone={stats?.answersAwaitingMarking ? 'warning' : 'default'}
          href="/admin/grading"
          loading={initialLoading}
        />
        <StatCard
          index={1}
          label="Flagged attempts"
          value={stats?.flaggedAttempts ?? 0}
          hint={stats?.flaggedAttempts ? 'Awaiting review' : 'Nothing awaiting review'}
          icon={ShieldAlert}
          href="/admin/integrity"
          tone={stats?.flaggedAttempts ? 'warning' : 'default'}
          loading={initialLoading}
        />
        <StatCard
          index={2}
          label="Active exams"
          value={stats?.activeExams ?? 0}
          hint="Published and inside their window"
          icon={MonitorPlay}
          href="/admin/quizzes"
          loading={initialLoading}
        />
        <StatCard
          index={3}
          label="Sitting now"
          value={stats?.studentsTakingExams ?? 0}
          hint={
            stats?.studentsTakingExams ? 'Open live monitoring' : 'No attempts in progress'
          }
          icon={Users}
          tone={stats?.studentsTakingExams ? 'success' : 'default'}
          href="/admin/live"
          loading={initialLoading}
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <AverageScoreChart
          data={data?.charts.averageScoreByQuiz ?? []}
          loading={initialLoading}
        />
        <ParticipationChart
          data={data?.charts.participation ?? []}
          closed={data?.recentQuizzes.filter((quiz) => quiz.state === 'CLOSED').map((quiz) => quiz.title)}
          loading={initialLoading}
        />
        <MarkingQueue items={data?.markingQueue ?? []} loading={initialLoading} />
        <RecentActivity items={data?.activity ?? []} loading={initialLoading} />
        <RecentQuizzes
          quizzes={data?.recentQuizzes ?? []}
          loading={initialLoading}
          className="lg:col-span-2"
        />
      </div>
    </PageShell>
  );
}

/** Rows inside a panel: full-width hit area, hairline between, ≥44px tall. */
const ROW_LINK =
  '-mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-fast ease-standard hover:bg-accent/60';

const ACTIVITY_STYLE: Record<ActivityItem['kind'], { icon: typeof PenLine; tone: string }> = {
  SUBMISSION: { icon: CheckCircle2, tone: 'text-muted-foreground' },
  PUBLISHED: { icon: BookOpen, tone: 'text-muted-foreground' },
  FLAGGED: { icon: ShieldAlert, tone: 'text-warning' },
  MARKING: { icon: PenLine, tone: 'text-warning' },
};

/**
 * What has happened lately, newest first.
 *
 * Assembled from real rows — submissions, publications, integrity flags — each
 * with its own timestamp, so nothing here is invented to fill the panel.
 */
function RecentActivity({ items, loading }: { items: ActivityItem[]; loading: boolean }) {
  return (
    <ChartFrame
      title="Recent activity"
      description="Submissions, publications and flags, newest first"
      height="auto"
      loading={loading}
      isEmpty={items.length === 0}
      emptyState={
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing has happened yet. Submissions and publications appear here.
        </p>
      }
      toolbar={
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/results">
            View results
            <ArrowRight />
          </Link>
        </Button>
      }
    >
      <ul className="divide-y divide-border">
        {items.map((item) => {
          const style = ACTIVITY_STYLE[item.kind];
          return (
            <li key={item.id}>
              <Link href={item.href} className={cn(ROW_LINK, 'items-start')}>
                <style.icon className={cn('mt-0.5 size-4 shrink-0', style.tone)} aria-hidden />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium text-foreground">{item.text}</span>
                  {item.detail ? (
                    <span className="block truncate text-muted-foreground">{item.detail}</span>
                  ) : null}
                </span>
                <span className="mt-0.5 shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  {relativeTime(item.at)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </ChartFrame>
  );
}

/**
 * Papers waiting on a person, oldest first.
 *
 * A bar chart of backlog counts would be decoration — what a marker needs is
 * which paper, how many answers, how long someone has been waiting, and a way
 * in. So this is a list with a link, not a plot.
 */
function MarkingQueue({ items, loading }: { items: MarkingQueueItem[]; loading: boolean }) {
  const answers = items.reduce((sum, item) => sum + item.answers, 0);

  return (
    <ChartFrame
      title="Waiting to be marked"
      description="Papers with answers only a person can mark, longest wait first"
      height="auto"
      loading={loading}
      isEmpty={items.length === 0}
      emptyState={
        <EmptyState
          icon={CheckCircle2}
          tone="success"
          title="Nothing to mark"
          description="Every descriptive and uploaded answer has been marked. Students are seeing final scores."
          className="border-0 py-8"
        />
      }
      toolbar={
        items.length > 0 ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/grading">
              Start marking
              <ArrowRight />
            </Link>
          </Button>
        ) : null
      }
      footer={
        <p className="text-xs text-muted-foreground">
          <span className="tabular font-medium text-foreground">{answers}</span> answer
          {answers === 1 ? '' : 's'} across{' '}
          <span className="tabular font-medium text-foreground">{items.length}</span> quiz
          {items.length === 1 ? '' : 'zes'}. Those students see a provisional score until you
          finish.
        </p>
      }
    >
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.quizId}>
            <Link href="/admin/grading" className={ROW_LINK}>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 break-words text-sm font-medium">{item.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {item.papers} paper{item.papers === 1 ? '' : 's'}
                  {item.waitingSince ? ` · waiting since ${formatDateTime(item.waitingSince)}` : ''}
                </span>
              </span>
              <span className="tabular shrink-0 text-sm text-foreground">
                <span className="font-semibold">{item.answers}</span>
                <span className="text-muted-foreground">
                  {' '}
                  answer{item.answers === 1 ? '' : 's'}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}

/**
 * The most recent published quizzes and how far through them the cohort is.
 *
 * The underlying query already ran for the participation chart, so this panel
 * costs nothing extra — it just gives the page a floor instead of ending on a
 * row of charts.
 */
function RecentQuizzes({
  quizzes,
  loading,
  className,
}: {
  quizzes: RecentQuiz[];
  loading: boolean;
  className?: string;
}) {
  return (
    <ChartFrame
      title="Recent quizzes"
      description="Published papers, newest first, with how much of the cohort has sat them"
      height="auto"
      loading={loading}
      isEmpty={quizzes.length === 0}
      className={className}
      emptyState={
        <p className="py-8 text-center text-sm text-muted-foreground">
          No published quizzes yet. Create one to see it here.
        </p>
      }
      toolbar={
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/quizzes">
            All quizzes
            <ArrowRight />
          </Link>
        </Button>
      }
    >
      <ul className="divide-y divide-border">
        {quizzes.map((quiz) => {
          const state = QUIZ_STATE[quiz.state];
          const rate =
            quiz.assigned > 0 ? Math.round((quiz.attempts / quiz.assigned) * 100) : 0;

          return (
            // Stacked on narrow screens; three aligned columns once there is room.
            <li key={quiz.id}>
              <Link
                href={`/admin/quizzes/${quiz.id}`}
                className={cn(
                  ROW_LINK,
                  'grid gap-x-6 gap-y-2 md:grid-cols-[minmax(0,1fr)_7rem_minmax(10rem,14rem)]',
                )}
              >
                <span className="min-w-0">
                  <span className="line-clamp-2 break-words text-sm font-medium">{quiz.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {quiz.subject} · {quiz.questionCount} questions
                  </span>
                </span>

                <span>
                  <Badge variant={state.variant}>{state.label}</Badge>
                </span>

                <span className="flex items-center gap-3">
                  <Progress
                    value={rate}
                    className="h-1.5 flex-1"
                    aria-label={`${quiz.title}: ${quiz.attempts} of ${quiz.assigned} students have sat it`}
                  />
                  <span className="tabular shrink-0 text-xs text-muted-foreground">
                    {quiz.attempts} / {quiz.assigned} sat
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </ChartFrame>
  );
}

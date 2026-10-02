'use client';

import { ArrowRight, ChevronRight, FilePlus2, MonitorPlay } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import {
  AverageScoreChart,
  ParticipationChart,
  type DashboardCharts,
} from '@/components/admin/charts/dashboard-charts';
import { ErrorState, InlineError } from '@/components/shared/error-state';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/use-api';
import { insightsSummary, type AttentionItem, type QuizWord } from '@/lib/dashboard-attention';
import { cn, formatDateTime, greeting, longDate } from '@/lib/utils';

interface ListedQuiz {
  id: string;
  title: string;
  state: QuizWord;
  assigned: number;
  attempts: number;
  startsAt: string;
}

interface OverviewData {
  faculty: { name: string };
  stats: { averageScore: number | null; scoredAttempts: number };
  attention: AttentionItem[];
  nextScheduled: { id: string; title: string; startsAt: string } | null;
  ownedQuizCount: number;
  yourQuizzes: ListedQuiz[];
  charts: DashboardCharts;
}

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

  const firstName = data?.faculty.name ?? 'there';
  // Someone with no quizzes at all has nothing to be told about yet; they get
  // the way in instead.
  const firstRun = data !== null && data.ownedQuizCount === 0;

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
            {firstRun
              ? 'Three steps to your first exam.'
              : 'Here’s what needs you today.'}
          </>
        }
        actions={
          firstRun ? undefined : (
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
          )
        }
      />

      {/* A failed refresh keeps the last good figures on screen. */}
      {error && data ? (
        <InlineError
          message="We could not refresh this page. Showing what loaded last."
          className="mt-6"
        />
      ) : null}

      {firstRun ? (
        <FirstRun />
      ) : (
        <div className="mt-8 space-y-10">
          <Attention
            items={data?.attention ?? []}
            next={data?.nextScheduled ?? null}
            loading={initialLoading}
          />
          <YourQuizzes quizzes={data?.yourQuizzes ?? []} loading={initialLoading} />
          <Insights data={data} loading={initialLoading} />
        </div>
      )}
    </PageShell>
  );
}

/** Hairline-ruled list: rules above, between and below, no boxes. */
const RULED = 'mt-3 divide-y divide-border border-y border-border';

function Attention({
  items,
  next,
  loading,
}: {
  items: AttentionItem[];
  next: OverviewData['nextScheduled'];
  loading: boolean;
}) {
  return (
    <section aria-labelledby="attention-heading">
      <h2 id="attention-heading" className="type-subheading">
        Needs your attention
      </h2>

      {loading ? (
        <SkeletonRows rows={3} className="mt-3" />
      ) : items.length === 0 ? (
        <div className="mt-3 border-y border-border py-6">
          <p className="text-sm font-medium text-foreground">Nothing needs you right now.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {next ? (
              <>
                Next up:{' '}
                <Link
                  href={`/admin/quizzes/${next.id}`}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {next.title}
                </Link>
                , opens {formatDateTime(next.startsAt, { year: undefined })}.
              </>
            ) : (
              'No quizzes are scheduled.'
            )}
          </p>
        </div>
      ) : (
        <ul className={RULED}>
          {items.map((item) => (
            // Count, sentence, link. On a phone the link drops under the
            // sentence rather than squeezing it.
            <li
              key={item.id}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3 py-4 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:items-center"
            >
              <span className="tabular font-serif text-2xl font-semibold leading-none text-foreground">
                {item.count}
              </span>
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-foreground">{item.text}</p>
                {item.detail ? (
                  <p className="mt-0.5 break-words text-sm text-muted-foreground">{item.detail}</p>
                ) : null}
              </div>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="col-start-2 justify-self-start sm:col-start-auto sm:justify-self-end"
              >
                <Link href={item.href} aria-label={`${item.action}: ${item.count} ${item.text}`}>
                  {item.action}
                  <ArrowRight />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const QUIZ_BADGE: Record<QuizWord, 'success' | 'default' | 'muted'> = {
  Live: 'success',
  Scheduled: 'default',
  Draft: 'muted',
  Closed: 'muted',
};

function quizFigure(quiz: ListedQuiz) {
  if (quiz.state === 'Scheduled') {
    return `Starts ${formatDateTime(quiz.startsAt, { year: undefined })} · ${quiz.assigned} assigned`;
  }
  if (quiz.state === 'Draft') return `${quiz.assigned} assigned`;
  return `${quiz.attempts} of ${quiz.assigned} attempted`;
}

/** Live and upcoming first, then drafts, then what closed most recently. */
function YourQuizzes({ quizzes, loading }: { quizzes: ListedQuiz[]; loading: boolean }) {
  return (
    <section aria-labelledby="quizzes-heading">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id="quizzes-heading" className="type-subheading">
          Your quizzes
        </h2>
        <Button asChild variant="ghost" size="sm" className="-mr-3">
          <Link href="/admin/quizzes">
            View all quizzes
            <ArrowRight />
          </Link>
        </Button>
      </div>

      {loading ? (
        <SkeletonRows rows={4} className="mt-3" />
      ) : quizzes.length === 0 ? (
        <EmptyState
          icon={FilePlus2}
          title="No quizzes to show"
          description="Your quizzes are archived. Create a new one, or open the full list."
          className="mt-3 py-8"
        />
      ) : (
        <ul className={RULED}>
          {quizzes.map((quiz) => (
            <li key={quiz.id}>
              {/* Stacked on a phone; title, status and figure in columns from md up. */}
              <Link
                href={`/admin/quizzes/${quiz.id}`}
                className="-mx-2 grid min-h-11 gap-x-6 gap-y-1.5 px-2 py-3 transition-colors duration-fast ease-standard hover:bg-accent/60 md:grid-cols-[minmax(0,1fr)_6rem_minmax(11rem,16rem)] md:items-center"
              >
                <span className="line-clamp-2 break-words text-sm font-medium text-foreground">
                  {quiz.title}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
                  <span>
                    <Badge variant={QUIZ_BADGE[quiz.state]}>{quiz.state}</Badge>
                  </span>
                  <span className="tabular text-sm text-muted-foreground">{quizFigure(quiz)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Analytics, out of the way until asked for. */
function Insights({ data, loading }: { data: OverviewData | null; loading: boolean }) {
  const closed = data?.charts.participation.filter((row) => row.closed).map((row) => row.quiz);

  return (
    <details className="group border-y border-border">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground group-open:rotate-90"
          aria-hidden
        />
        <h2 className="type-subheading">Insights</h2>
        {loading || !data ? (
          <Skeleton className="h-4 w-56 max-w-full" />
        ) : (
          <span className="text-sm text-muted-foreground">
            {insightsSummary({
              averageScore: data.stats.averageScore,
              scoredAttempts: data.stats.scoredAttempts,
              participation: data.charts.participation,
            })}
          </span>
        )}
      </summary>

      <div className="grid gap-6 pb-6 pt-2 lg:grid-cols-2">
        <AverageScoreChart data={data?.charts.averageScoreByQuiz ?? []} loading={loading} />
        <ParticipationChart
          data={data?.charts.participation ?? []}
          closed={closed}
          loading={loading}
        />
      </div>
    </details>
  );
}

const STEP_LINK =
  'inline-flex min-h-11 items-center text-sm font-medium text-foreground underline-offset-4 hover:underline';

/** Shown instead of everything above when there are no quizzes at all. */
function FirstRun() {
  return (
    <section aria-labelledby="first-run-heading" className="mt-8">
      <h2 id="first-run-heading" className="type-subheading">
        Set up your first quiz
      </h2>

      <ol className={cn(RULED, 'max-w-2xl')}>
        <li className="flex items-center gap-4 py-3">
          <span aria-hidden className="tabular w-5 shrink-0 text-sm text-muted-foreground">
            1.
          </span>
          <Button asChild>
            <Link href="/admin/quizzes/new">
              <FilePlus2 />
              Create a quiz
            </Link>
          </Button>
        </li>
        <li className="flex items-center gap-4 py-1">
          <span aria-hidden className="tabular w-5 shrink-0 text-sm text-muted-foreground">
            2.
          </span>
          <Link href="/admin/questions" className={STEP_LINK}>
            Add questions (or import from the question bank)
          </Link>
        </li>
        <li className="flex items-center gap-4 py-1">
          <span aria-hidden className="tabular w-5 shrink-0 text-sm text-muted-foreground">
            3.
          </span>
          <Link href="/admin/quizzes" className={STEP_LINK}>
            Assign students and publish
          </Link>
        </li>
      </ol>

      <p className="mt-4 text-sm text-muted-foreground">
        Need students first?{' '}
        <Link
          href="/admin/students"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Import them from the Students page
        </Link>
      </p>
    </section>
  );
}

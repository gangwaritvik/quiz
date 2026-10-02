'use client';

import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartFrame, ChartMetric, ChartTooltip } from '@/components/admin/charts/chart-frame';
import { CHART, DIFFICULTY_COLOR, axisProps, gridProps } from '@/components/admin/charts/chart-theme';
import { cn } from '@/lib/utils';

export interface DashboardCharts {
  averageScoreByQuiz: Array<{ quiz: string; average: number; attempts: number }>;
  participation: Array<{ quiz: string; assigned: number; attempted: number; closed?: boolean }>;
  scoreDistribution: Array<{ band: string; count: number; failing: boolean }>;
  difficultyDistribution: Array<{ difficulty: 'EASY' | 'MEDIUM' | 'HARD'; count: number }>;
  integrityEvents: Array<{ type: string; count: number }>;
  provisionalAttempts: number;
}

/**
 * Recharts animates bars in from zero width. On a dashboard that refetches
 * every 30 seconds that means every panel replays its entrance on each poll,
 * and a chart whose container is measured mid-mount can settle at zero width
 * and never recover. Static bars avoid both.
 */
const BAR_ANIMATION = { isAnimationActive: false } as const;

const CURSOR = { fill: CHART.grid, fillOpacity: 0.5 } as const;

/**
 * A row of the ranked bar lists.
 *
 * These are built in HTML rather than as a Recharts category axis on purpose:
 * quiz titles are long, and a fixed label gutter either truncates them
 * mid-word or steals half the plot. Giving the name its own full-width line
 * above the bar removes the constraint entirely — and a zero value still
 * renders a visible stub, where an SVG bar of width 0 draws nothing at all
 * and reads as a broken chart.
 */
function BarRow({
  label,
  meta,
  value,
  display,
  tone = 'series',
  max = 100,
}: {
  label: string;
  meta?: React.ReactNode;
  value: number;
  display: string;
  tone?: 'series' | 'muted';
  max?: number;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;

  return (
    <li className="group">
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 break-words text-sm font-medium text-foreground" title={label}>
          {label}
        </p>
        <span className="tabular shrink-0 text-sm font-semibold text-foreground">{display}</span>
      </div>

      <div className="mt-1.5 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-slow ease-standard',
              tone === 'muted' ? 'bg-muted-foreground/40' : 'bg-[--bar]',
            )}
            // A floor of 2px so a genuine zero is still visible as a mark
            // rather than vanishing into the track.
            style={{ width: `max(0.5rem, ${pct}%)`, ['--bar' as string]: CHART.series }}
          />
        </div>
        {meta ? (
          <span className="tabular shrink-0 text-xs text-muted-foreground">{meta}</span>
        ) : null}
      </div>
    </li>
  );
}

export function AverageScoreChart({
  data,
  loading,
}: {
  data: DashboardCharts['averageScoreByQuiz'];
  loading: boolean;
}) {
  const overall =
    data.length > 0
      ? Math.round((data.reduce((sum, row) => sum + row.average, 0) / data.length) * 10) / 10
      : 0;
  const totalAttempts = data.reduce((sum, row) => sum + row.attempts, 0);

  return (
    <ChartFrame
      title="Average score"
      description="Mean percentage across graded attempts, weakest first"
      loading={loading}
      isEmpty={data.length === 0}
      emptyMessage="Scores appear here once students submit their first graded attempt."
      height="auto"
      toolbar={
        !loading && data.length > 0 ? <ChartMetric value={`${overall}%`} label="Overall" /> : null
      }
      footer={
        <p className="text-xs text-muted-foreground">
          Across <span className="tabular font-medium text-foreground">{totalAttempts}</span> graded
          attempt{totalAttempts === 1 ? '' : 's'} in{' '}
          <span className="tabular font-medium text-foreground">{data.length}</span> quiz
          {data.length === 1 ? '' : 'zes'}.
        </p>
      }
    >
      <ul className="space-y-4" aria-label="Average score by quiz">
        {data.map((row) => (
          <BarRow
            key={row.quiz}
            label={row.quiz}
            value={row.average}
            display={`${row.average}%`}
            meta={`${row.attempts} attempt${row.attempts === 1 ? '' : 's'}`}
          />
        ))}
      </ul>
    </ChartFrame>
  );
}

export function ParticipationChart({
  data,
  closed = [],
  loading,
}: {
  data: DashboardCharts['participation'];
  /** Titles of quizzes whose window has ended. */
  closed?: string[];
  loading: boolean;
}) {
  // Attempted is a subset of assigned, so a participation *rate* is the honest
  // single measure — grouped bars would invite reading them as independent.
  const rows = data
    .map((row) => ({
      quiz: row.quiz,
      rate: row.assigned > 0 ? Math.round((row.attempted / row.assigned) * 100) : 0,
      attempted: row.attempted,
      assigned: row.assigned,
    }))
    .sort((a, b) => a.rate - b.rate);

  const assigned = data.reduce((sum, row) => sum + row.assigned, 0);
  const attempted = data.reduce((sum, row) => sum + row.attempted, 0);
  const overallRate = assigned > 0 ? Math.round((attempted / assigned) * 100) : 0;

  return (
    <ChartFrame
      title="Quiz participation"
      description="Share of assigned students who have sat each exam that has opened"
      loading={loading}
      isEmpty={rows.length === 0}
      emptyMessage="No exam has opened yet. Participation appears once one does."
      height="auto"
      toolbar={
        !loading && rows.length > 0 ? <ChartMetric value={`${overallRate}%`} label="Overall" /> : null
      }
      footer={
        <p className="text-xs text-muted-foreground">
          <span className="tabular font-medium text-foreground">{attempted}</span> of{' '}
          <span className="tabular font-medium text-foreground">{assigned}</span> assignments taken
          {assigned - attempted > 0 ? <> · {assigned - attempted} yet to sit a paper</> : null}
          <span className="mt-1 block">
            Quizzes that have not opened are excluded — they are not a shortfall.
          </span>
        </p>
      }
    >
      <ul className="space-y-4" aria-label="Participation by quiz">
        {rows.map((row) => (
          <BarRow
            key={row.quiz}
            label={row.quiz}
            value={row.rate}
            display={`${row.rate}%`}
            meta={
              <>
                {row.attempted} / {row.assigned}
                {closed.includes(row.quiz) ? <span className="ml-1.5">Closed</span> : null}
              </>
            }
          />
        ))}
      </ul>
    </ChartFrame>
  );
}

const DIFFICULTY_LABELS = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' } as const;

export function DifficultyChart({
  data,
  loading,
}: {
  data: DashboardCharts['difficultyDistribution'];
  loading: boolean;
}) {
  const total = data.reduce((sum, row) => sum + row.count, 0);

  return (
    <ChartFrame
      title="Question difficulty"
      description="How the question bank is distributed"
      loading={loading}
      isEmpty={total === 0}
      emptyMessage="Add active questions to see the bank's difficulty mix."
      height={230}
      toolbar={!loading && total > 0 ? <ChartMetric value={total} label="Questions" /> : null}
      footer={
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {(['EASY', 'MEDIUM', 'HARD'] as const).map((difficulty) => {
            const count = data.find((row) => row.difficulty === difficulty)?.count ?? 0;
            const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <span key={difficulty} className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-sm" aria-hidden style={{ backgroundColor: DIFFICULTY_COLOR[difficulty] }} />
                {DIFFICULTY_LABELS[difficulty]} <strong className="text-foreground">{percentage}%</strong>
              </span>
            );
          })}
        </div>
      }
    >
      <div className="flex h-full items-end justify-around gap-5 px-3 pb-1 pt-4">
        {(['EASY', 'MEDIUM', 'HARD'] as const).map((difficulty) => {
          const count = data.find((row) => row.difficulty === difficulty)?.count ?? 0;
          const max = Math.max(...data.map((row) => row.count), 1);
          return (
            <div key={difficulty} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
              <span className="tabular text-sm font-semibold">{count}</span>
              <div className="flex h-32 w-full max-w-16 items-end rounded-t-sm bg-muted">
                <div
                  className="w-full rounded-t-sm transition-[height] duration-slow ease-standard"
                  style={{ height: `${Math.max(8, (count / max) * 100)}%`, backgroundColor: DIFFICULTY_COLOR[difficulty] }}
                />
              </div>
              <span className="text-xs text-muted-foreground">{DIFFICULTY_LABELS[difficulty]}</span>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}

const EVENT_LABELS: Record<string, string> = {
  FULLSCREEN_EXIT: 'Exited fullscreen',
  TAB_SWITCH: 'Switched browser tab',
  NETWORK_OFFLINE: 'Network disconnected',
  WINDOW_BLUR: 'Window lost focus',
  COPY_ATTEMPT: 'Copy attempt blocked',
  PASTE_ATTEMPT: 'Paste attempt blocked',
  MULTIPLE_SESSION: 'Second active session detected',
};

export function IntegrityEventsChart({
  data,
  loading,
}: {
  data: DashboardCharts['integrityEvents'];
  loading: boolean;
}) {
  const rows = data.filter((row) => EVENT_LABELS[row.type]);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const max = Math.max(...rows.map((row) => row.count), 1);

  return (
    <ChartFrame
      title="Integrity events"
      description="Signals recorded across all attempts"
      loading={loading}
      isEmpty={rows.length === 0}
      emptyMessage="No integrity signals have been recorded."
      height="auto"
      toolbar={!loading && rows.length > 0 ? <ChartMetric value={total} label="Signals" /> : null}
      footer={
        <p className="text-xs leading-relaxed text-muted-foreground">
          Counts, not conclusions. Every signal has an innocent explanation and requires human
          review.
        </p>
      }
    >
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.type}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-foreground">{EVENT_LABELS[row.type]}</span>
              <span className="tabular font-semibold text-foreground">{row.count}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-[width] duration-slow ease-standard"
                style={{ width: `${Math.max(4, (row.count / max) * 100)}%`, backgroundColor: CHART.series }}
              />
            </div>
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}

/**
 * The shape of a cohort's results.
 *
 * A mean hides everything that matters here: 50% average is a very different
 * teaching problem when it is everyone at 50 than when it is half the class at
 * zero. The failing band wears the status red and every band is named on the
 * axis, so the colour is emphasis rather than the only thing carrying meaning.
 */
export function ScoreDistributionChart({
  data,
  provisional,
  loading,
}: {
  data: DashboardCharts['scoreDistribution'];
  provisional: number;
  loading: boolean;
}) {
  const total = data.reduce((sum, row) => sum + row.count, 0);
  const failing = data.find((row) => row.failing)?.count ?? 0;
  const failRate = total > 0 ? Math.round((failing / total) * 100) : 0;

  return (
    <ChartFrame
      title="Score distribution"
      description="How marks are spread across all graded attempts"
      loading={loading}
      isEmpty={total === 0}
      emptyMessage="Once attempts are marked, the spread of results appears here."
      height={230}
      toolbar={
        !loading && total > 0 ? (
          <ChartMetric value={`${failRate}%`} label="Below 40" />
        ) : null
      }
      footer={
        <div className="text-xs leading-relaxed text-muted-foreground">
          <span className="tabular font-medium text-foreground">{total}</span> marked attempt
          {total === 1 ? '' : 's'}.
          {provisional > 0 ? (
            <>
              {' '}
              <span className="tabular font-medium text-foreground">{provisional}</span> more
              excluded while marking is unfinished — their scores are provisional.
            </>
          ) : null}
          <details className="mt-2">
            <summary className="cursor-pointer font-medium text-foreground">View as table</summary>
            <table className="mt-2 w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-1 font-medium">Band</th>
                  <th scope="col" className="py-1 text-right font-medium">Attempts</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.band} className="border-b border-border last:border-0">
                    <td className="py-1">
                      {row.band}
                      {row.failing ? ' (below pass)' : ''}
                    </td>
                    <td className="tabular py-1 text-right text-foreground">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 22, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="band" {...axisProps} />
          <YAxis allowDecimals={false} {...axisProps} />
          <Tooltip cursor={CURSOR} content={<ChartTooltip />} />
          <Bar dataKey="count" name="Attempts" radius={[3, 3, 0, 0]} barSize={56} {...BAR_ANIMATION}>
            {data.map((row) => (
              <Cell key={row.band} fill={row.failing ? CHART.critical : CHART.series} />
            ))}
            <LabelList
              dataKey="count"
              position="top"
              style={{ fill: 'hsl(var(--foreground))', fontSize: 12, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

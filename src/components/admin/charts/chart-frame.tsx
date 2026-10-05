'use client';

import { BarChart3 } from 'lucide-react';
import * as React from 'react';

import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ChartFrameProps {
  title: string;
  description?: string;
  loading?: boolean;
  isEmpty?: boolean;
  emptyMessage?: string;
  /** Replaces the default "nothing to chart" panel, for non-chart panels. */
  emptyState?: React.ReactNode;
  /** Rendered in the header, right-aligned; use for a headline figure. */
  toolbar?: React.ReactNode;
  /** Rendered below the plot, above the card edge; use for a legend or totals. */
  footer?: React.ReactNode;
  /**
   * A fixed plot height for SVG charts, which need one to lay out. `'auto'`
   * lets the card grow with its content — right for the HTML bar lists, which
   * would otherwise sit in a tall box with dead space beneath them.
   */
  height?: number | 'auto';
  children: React.ReactNode;
  className?: string;
}

/**
 * One panel per chart: heading, content and an optional footer. Every overview
 * panel uses it so they align.
 */
export function ChartFrame({
  title,
  description,
  loading,
  isEmpty,
  emptyMessage = 'No data has been recorded yet.',
  emptyState,
  toolbar,
  footer,
  height = 260,
  children,
  className,
}: ChartFrameProps) {
  return (
    <section
      className={cn('flex min-w-0 flex-col rounded-lg border border-border bg-card', className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pb-4 pt-5">
        <div className="min-w-0 flex-1">
          <h2 className="type-subheading">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
      </header>

      <div
        className={cn('border-t border-border', height === 'auto' ? 'px-5 py-4' : 'px-3 pt-4')}
        style={height === 'auto' ? undefined : { height }}
      >
        {loading ? (
          <Skeleton className={cn('rounded-md', height === 'auto' ? 'h-40 w-full' : 'size-full')} />
        ) : isEmpty ? (
          (emptyState ?? (
            <EmptyState
              icon={BarChart3}
              title="Nothing to chart yet"
              description={emptyMessage}
              className={cn('border-0 py-8', height === 'auto' ? '' : 'h-full py-0')}
            />
          ))
        ) : (
          children
        )}
      </div>

      {footer && !loading && !isEmpty ? (
        <div className="mt-auto border-t border-border px-5 py-3">{footer}</div>
      ) : null}
    </section>
  );
}

/**
 * A headline number for the chart header. Keeps the figure in text tokens — the
 * plot carries the colour, the number does not compete with it.
 */
export function ChartMetric({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="text-right">
      <p className="tabular text-2xl font-semibold leading-none text-foreground">
        {value}
      </p>
      <p className="type-eyebrow mt-1.5">{label}</p>
    </div>
  );
}

/**
 * Tooltip body shared by every chart. Values keep text tokens rather than the
 * series colour; a small swatch beside them carries identity.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  valueSuffix = '',
  describe,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; payload?: unknown }>;
  label?: string | number;
  valueSuffix?: string;
  /** Optional second line drawn from the row, e.g. the raw counts behind a rate. */
  describe?: (row: unknown) => string;
}) {
  if (!active || !payload?.length) return null;

  const detail = describe && payload[0]?.payload ? describe(payload[0].payload) : null;

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground shadow-overlay">
      {label !== undefined ? (
        <p className="text-xs font-medium text-foreground">{label}</p>
      ) : null}
      <ul className="mt-1 space-y-0.5">
        {payload.map((entry, index) => (
          <li key={index} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className="size-2 shrink-0 rounded-sm"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            {entry.name ? <span>{entry.name}</span> : null}
            <span className="tabular ml-auto font-medium text-foreground">
              {entry.value}
              {valueSuffix}
            </span>
          </li>
        ))}
      </ul>
      {detail ? <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

'use client';

import { motion } from 'framer-motion';
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { CountUp } from '@/components/ui/count-up';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'success' | 'warning' | 'danger';

/**
 * Tone colours only the small icon. The label and value stay in text colours,
 * so a card never depends on its tint to be read — the icon and wording carry
 * the meaning and the colour is reinforcement.
 */
const TONE_STYLES: Record<Tone, string> = {
  default: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: LucideIcon;
  tone?: Tone;
  loading?: boolean;
  /** Staggers the entrance so a row of cards resolves left to right. */
  index?: number;
  /** Makes the whole card a link, with an arrow affordance. */
  href?: string;
  /**
   * Percentage change against the previous period. Omitted rather than shown
   * as zero when there is nothing to compare against — a delta against no
   * data is not a delta.
   */
  trend?: number | null;
  /** What a rise means here. Scores up is good; flagged attempts up is not. */
  trendGoodWhen?: 'up' | 'down';
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  loading = false,
  index = 0,
  href,
  trend = null,
  trendGoodWhen = 'up',
}: StatCardProps) {
  const rising = (trend ?? 0) > 0;
  const good = trendGoodWhen === 'up' ? rising : !rising;

  const body = (
    <>
      <div className="flex items-start gap-2">
        <Icon className={cn('size-4 shrink-0', TONE_STYLES[tone])} aria-hidden />
        <p className="min-w-0 flex-1 text-xs font-medium leading-4 text-muted-foreground">
          {label}
        </p>
        {href ? (
          <ArrowRight
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-fast ease-standard group-hover:translate-x-0.5 group-hover:text-primary"
            aria-hidden
          />
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="mt-3 h-8 w-16" />
      ) : (
        <p className="tabular mt-2.5 flex flex-wrap items-baseline gap-2 font-serif text-3xl font-semibold leading-none text-foreground">
          {typeof value === 'number' || typeof value === 'string' ? <CountUp value={value} /> : value}
          {trend !== null ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 font-sans text-2xs font-semibold',
                good ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger',
              )}
            >
              {rising ? (
                <TrendingUp className="size-3" aria-hidden />
              ) : (
                <TrendingDown className="size-3" aria-hidden />
              )}
              {Math.abs(trend)}%
              <span className="sr-only">{rising ? 'up' : 'down'} against the previous week</span>
            </span>
          ) : null}
        </p>
      )}

      {hint ? (
        <div className="mt-2.5 text-xs text-muted-foreground">
          {loading ? <Skeleton className="h-3 w-28" /> : hint}
        </div>
      ) : null}
    </>
  );

  const className = cn(
    'group block h-full rounded-lg border border-border bg-card p-5',
    href && 'transition-colors duration-fast ease-standard hover:border-primary/40 hover:bg-accent/30',
  );

  return (
    <motion.div
      className="h-full"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04, ease: [0.2, 0, 0, 1] }}
    >
      {href ? (
        <Link href={href} className={className}>
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </motion.div>
  );
}

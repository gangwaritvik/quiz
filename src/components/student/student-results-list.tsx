'use client';

import { ChevronRight, GraduationCap, Lock } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { ErrorState } from '@/components/shared/error-state';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/use-api';
import { formatDateTime, pluralize } from '@/lib/utils';

interface HistoryAttempt {
  id: string;
  quizTitle: string;
  subject: string;
  subjectCode: string;
  status: string;
  submittedAt: string | null;
  resultsReleased: boolean;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  /** Optional: true while a marker still has answers to grade (score may move). */
  awaitingMarking?: boolean;
  /** Set when results are held until the quiz window closes. */
  releasesAt?: string | null;
}

export function StudentResultsList() {
  const { data, error, initialLoading, refetch } = useApi<{ attempts: HistoryAttempt[] }>(
    '/api/student/history',
  );

  const submitted = (data?.attempts ?? []).filter(
    (attempt) => attempt.status === 'SUBMITTED' || attempt.status === 'AUTO_SUBMITTED',
  );
  const released = submitted.filter((attempt) => attempt.resultsReleased);
  const withheld = submitted.filter((attempt) => !attempt.resultsReleased);
  // Provisional scores are shown but never averaged: they can still change.
  const final = released.filter((attempt) => !attempt.awaitingMarking);
  const provisional = released.length - final.length;

  const average =
    final.length > 0
      ? Math.round(
          (final.reduce((sum, a) => sum + (a.percentage ?? 0), 0) / final.length) * 10,
        ) / 10
      : null;

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
        title="Results"
        description="Scores appear once your faculty has released them and the quiz has closed."
      />

      {initialLoading ? (
        <SkeletonRows rows={4} className="mt-8" />
      ) : released.length === 0 && withheld.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={GraduationCap}
          title="No results yet"
          description="Once you complete an examination and your faculty releases the results, your score and topic breakdown will appear here."
          action={
            <Button asChild variant="outline">
              <Link href="/quizzes">View my quizzes</Link>
            </Button>
          }
        />
      ) : (
        <>
          {average !== null ? (
            <section aria-label="Average" className="mt-8 max-w-md">
              <p className="text-sm text-muted-foreground">Average across released results</p>
              <p className="tabular mt-1 font-serif text-4xl font-semibold text-foreground">
                {average}%
              </p>
              <Progress value={average} aria-label="Average score" className="mt-3 h-1.5" />
              <p className="mt-2 text-xs text-muted-foreground">
                {pluralize(final.length, 'final result')} counted
                {provisional > 0 ? ` · ${provisional} provisional, not counted` : ''}
                {withheld.length > 0 ? ` · ${withheld.length} not yet released` : ''}
              </p>
            </section>
          ) : null}

          <ul className="mt-8 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {released.map((attempt) => (
              <li key={attempt.id}>
                <Link
                  href={`/results/${attempt.id}`}
                  className="flex items-center gap-4 px-4 py-4 transition-colors duration-fast ease-standard hover:bg-accent/40 sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="type-eyebrow truncate">{attempt.subject}</p>
                    <p className="mt-1 break-words font-medium text-foreground">
                      {attempt.quizTitle}
                    </p>
                    <p className="tabular mt-1 text-xs text-muted-foreground">
                      Submitted {attempt.submittedAt ? formatDateTime(attempt.submittedAt) : '—'}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="tabular font-serif text-2xl font-semibold leading-none text-foreground">
                      {attempt.percentage}%
                    </p>
                    {attempt.awaitingMarking ? (
                      <p className="mt-1 text-xs font-medium text-muted-foreground">Provisional</p>
                    ) : null}
                    <p className="tabular mt-1.5 text-xs text-muted-foreground">
                      {attempt.score} / {attempt.maxScore} marks
                    </p>
                  </div>

                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}

            {withheld.map((attempt) => (
              <li key={attempt.id} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="type-eyebrow truncate">{attempt.subject}</p>
                  <p className="mt-1 break-words font-medium text-muted-foreground">
                    {attempt.quizTitle}
                  </p>
                  <p className="tabular mt-1 text-xs text-muted-foreground">
                    Submitted {attempt.submittedAt ? formatDateTime(attempt.submittedAt) : '—'}
                  </p>
                  {attempt.releasesAt ? (
                    <p className="tabular mt-1 text-xs text-muted-foreground">
                      Quiz closes {formatDateTime(attempt.releasesAt)}
                    </p>
                  ) : null}
                </div>
                {/* Wraps to two lines on a phone so the title keeps its room. */}
                <Badge
                  variant="muted"
                  className="max-w-[9rem] shrink-0 whitespace-normal leading-tight sm:max-w-none sm:whitespace-nowrap"
                >
                  <Lock aria-hidden />
                  {attempt.releasesAt
                    ? 'Available after the quiz closes'
                    : 'Awaiting release by your faculty'}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </PageShell>
  );
}

'use client';

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Info,
  Laptop,
  MessageSquarePlus,
  MinusCircle,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import { ErrorState } from '@/components/shared/error-state';
import {
  IntegrityBadge,
  IntegrityMeter,
  type IntegrityStatus,
} from '@/components/shared/integrity-badge';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { SEVERITY_STYLES, type EventSeverity } from '@/lib/event-labels';
import { cn, formatDateTime, formatDuration, formatTime } from '@/lib/utils';

interface ReportDetail {
  attempt: {
    id: string;
    status: string;
    startedAt: string;
    submittedAt: string | null;
    score: number | null;
    maxScore: number | null;
    percentage: number | null;
    deviceLabel: string;
    trustedDevice: boolean;
  };
  student: {
    id: string;
    name: string;
    email: string;
    rollNumber: string;
    department: string;
    section: string;
  };
  quiz: { id?: string; title: string; subject: string; durationMinutes: number };
  integrity: {
    score: number;
    status: IntegrityStatus;
    breakdown: Array<{
      type: string;
      label: string;
      count: number;
      penalty: number;
      totalDurationMs: number;
    }>;
    clean: string[];
    reviewed: boolean;
  };
  timeline: Array<{
    id: string;
    type: string;
    label: string;
    severity: EventSeverity;
    occurredAt: string;
    durationMs: number | null;
    metadata: unknown;
  }>;
  reviews: Array<{
    id: string;
    outcome: string;
    note: string | null;
    adminName: string;
    createdAt: string;
  }>;
}

const OUTCOME_LABEL: Record<string, string> = {
  REVIEWED: 'Reviewed — no further action',
  DISMISSED: 'Dismissed — signals explained',
  ESCALATED: 'Escalated to the examination committee',
};

export function IntegrityReportDetail({ attemptId }: { attemptId: string }) {
  const { data, error, initialLoading, refetch } = useApi<ReportDetail>(
    `/api/admin/integrity/${attemptId}`,
  );

  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [outcome, setOutcome] = React.useState('REVIEWED');
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const submitReview = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/admin/integrity/${attemptId}`, {
        method: 'POST',
        body: { outcome, note: note.trim() },
      });
      toast.success('Review recorded.');
      setReviewOpen(false);
      setNote('');
      await refetch();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not save your review.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (error && !data) {
    return (
      <PageShell>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  if (initialLoading || !data) {
    return (
      <PageShell>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-10 w-96 max-w-full" />
        <Skeleton className="mt-8 h-96 rounded-lg" />
      </PageShell>
    );
  }

  const { attempt, student, quiz, integrity, timeline, reviews } = data;
  const deduction = integrity.breakdown.reduce((sum, signal) => sum + signal.penalty, 0);
  const startedAt = new Date(attempt.startedAt).getTime();
  const signalCount = timeline.filter((event) => event.severity !== 'INFO').length;

  return (
    <PageShell>
      <nav aria-label="Back" className="-ml-2 mb-4 flex flex-wrap items-center gap-1">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/integrity">
            <ArrowLeft />
            Integrity reports
          </Link>
        </Button>
        {quiz.id ? (
          <>
            <span className="text-muted-foreground" aria-hidden>
              ·
            </span>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/admin/quizzes/${quiz.id}`}>Back to quiz</Link>
            </Button>
          </>
        ) : null}
      </nav>

      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3">
            {student.name}
            <span className="font-mono text-lg font-normal text-muted-foreground">
              {student.rollNumber}
            </span>
          </span>
        }
        description={
          <>
            {quiz.title} · {quiz.subject} · {student.department}, Section {student.section}
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/admin/results/${attemptId}`}>
                <ScrollText />
                View student answers
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setReviewOpen(true)}>
              <MessageSquarePlus />
              Add note
            </Button>
            <Button
              onClick={() => setReviewOpen(true)}
              disabled={integrity.reviewed && reviews.length > 0}
            >
              <Check />
              {integrity.reviewed ? 'Reviewed' : 'Mark reviewed'}
            </Button>
          </>
        }
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        {/* One sheet: the number, what it is not, and how it was reached. */}
        <aside className="divide-y divide-border rounded-lg border border-border bg-card">
          <section aria-labelledby="score-heading" className="p-5 sm:p-6">
            <h2 id="score-heading" className="type-eyebrow flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" aria-hidden />
              Integrity score
            </h2>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <p className="tabular font-serif text-4xl font-semibold leading-none text-foreground">
                {integrity.score}
                <span className="ml-1 font-sans text-base font-normal text-muted-foreground">
                  / 100
                </span>
              </p>
              <IntegrityBadge status={integrity.status} />
            </div>
            <IntegrityMeter score={integrity.score} status={integrity.status} className="mt-4" />

            {/* The caveat sits beside the number, not in a footnote. */}
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">This score is not a finding.</span> It
              summarises automated signals, each of which has innocent explanations — a
              notification stealing focus, unstable campus Wi-Fi, a laptop lid closing. Read the
              timeline and speak with the student before drawing any conclusion.
            </p>
          </section>

          <section aria-labelledby="derivation-heading" className="p-5 sm:p-6">
            <h2 id="derivation-heading" className="type-subheading">
              How the score was reached
            </h2>

            <ol className="tabular mt-3 text-sm">
              <li className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-muted-foreground">Every attempt starts at</span>
                <span className="font-medium">100</span>
              </li>
              {integrity.breakdown.map((signal) => (
                <li key={signal.type} className="flex items-start gap-2.5 py-1.5">
                  {signal.penalty > 0 ? (
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                  ) : (
                    <MinusCircle
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-foreground">{signal.count}×</span>{' '}
                    {signal.label}
                    {signal.totalDurationMs > 0 ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · {Math.round(signal.totalDurationMs / 1000)}s total
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {signal.penalty > 0 ? `−${signal.penalty}` : 'tolerated'}
                  </span>
                </li>
              ))}
              <li className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
                <span className="font-medium">Integrity score</span>
                <span className="font-semibold">
                  {integrity.score}
                  {100 - deduction < 0 ? (
                    <span className="font-normal text-muted-foreground"> (floored at 0)</span>
                  ) : null}
                </span>
              </li>
            </ol>

            {integrity.breakdown.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No scored signals were recorded for this attempt.
              </p>
            ) : null}

            {integrity.clean.length > 0 ? (
              <ul className="mt-4 space-y-1.5 border-t border-border pt-4">
                {integrity.clean.map((statement) => (
                  <li key={statement} className="flex items-start gap-2.5 text-sm">
                    <Check
                      className="mt-0.5 size-3.5 shrink-0 text-success"
                      strokeWidth={3}
                      aria-hidden
                    />
                    <span className="text-muted-foreground">{statement}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section aria-labelledby="attempt-heading" className="p-5 sm:p-6">
            <h2 id="attempt-heading" className="type-subheading">
              Attempt details
            </h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <Row label="Started" value={formatDateTime(attempt.startedAt)} />
              <Row
                label="Submitted"
                value={attempt.submittedAt ? formatDateTime(attempt.submittedAt) : 'In progress'}
              />
              <Row
                label="Score"
                value={
                  attempt.percentage === null
                    ? 'Not graded'
                    : `${attempt.percentage}% (${attempt.score}/${attempt.maxScore})`
                }
              />
              <Row
                label="Status"
                value={
                  attempt.status === 'AUTO_SUBMITTED'
                    ? 'Auto-submitted at time limit'
                    : attempt.status === 'IN_PROGRESS'
                      ? 'In progress'
                      : 'Submitted'
                }
              />
              <div className="flex items-start justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <Laptop className="size-3.5" aria-hidden />
                  Device
                </dt>
                <dd className="text-right">
                  <span className="font-medium">{attempt.deviceLabel}</span>
                  {attempt.trustedDevice ? (
                    <Badge variant="outline" className="ml-1.5">
                      Remembered
                    </Badge>
                  ) : null}
                </dd>
              </div>
            </dl>
          </section>
        </aside>

        <div className="min-w-0 space-y-6">
          <section
            aria-labelledby="timeline-heading"
            className="rounded-lg border border-border bg-card p-5 sm:p-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="timeline-heading" className="type-heading">
                Event timeline
              </h2>
              <p className="tabular text-sm text-muted-foreground">
                {timeline.length} event{timeline.length === 1 ? '' : 's'} · {signalCount} scored
                signal{signalCount === 1 ? '' : 's'}
              </p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Every recorded event, in order. Times are recorded by the server, not the
              student&apos;s browser; the second column is time since the exam started.
            </p>

            {timeline.length === 0 ? (
              <p className="mt-5 rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No events were recorded for this attempt.
              </p>
            ) : (
              <ol className="mt-6">
                {timeline.map((event, index) => {
                  const severity = SEVERITY_STYLES[event.severity];
                  const info = event.severity === 'INFO';
                  const elapsed = (new Date(event.occurredAt).getTime() - startedAt) / 1000;
                  return (
                    <li
                      key={event.id}
                      className="grid grid-cols-[auto_1rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[auto_auto_1rem_minmax(0,1fr)]"
                    >
                      <time
                        className="tabular w-[5.75rem] pt-px font-mono text-xs text-muted-foreground"
                        dateTime={event.occurredAt}
                      >
                        {formatTime(event.occurredAt)}
                      </time>
                      <span className="tabular hidden w-14 pt-px font-mono text-xs text-muted-foreground sm:block">
                        +{formatDuration(Math.max(0, elapsed))}
                      </span>
                      <span className="relative flex justify-center" aria-hidden>
                        {index < timeline.length - 1 ? (
                          <span className="absolute top-3 h-full w-px bg-border" />
                        ) : null}
                        <span
                          className={cn(
                            'relative mt-1 rounded-full ring-4 ring-card',
                            info ? 'size-2 opacity-60' : 'size-2.5',
                            severity.dot,
                          )}
                        />
                      </span>
                      <div className="min-w-0 pb-5">
                        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-sm">
                          <span
                            className={info ? 'text-muted-foreground' : 'font-medium text-foreground'}
                          >
                            {event.label}
                          </span>
                          {!info ? (
                            <span
                              className={cn(
                                'text-2xs font-semibold uppercase tracking-wide',
                                severity.text,
                              )}
                            >
                              <span className="sr-only">Severity: </span>
                              {severity.label}
                            </span>
                          ) : null}
                        </p>
                        {event.durationMs ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Duration: {(event.durationMs / 1000).toFixed(1)} seconds
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section
            aria-labelledby="reviews-heading"
            className="rounded-lg border border-border bg-card p-5 sm:p-6"
          >
            <h2 id="reviews-heading" className="type-heading">
              Review history
            </h2>

            {reviews.length === 0 ? (
              <p className="mt-3 flex items-start gap-2.5 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                No one has reviewed this attempt yet. Recording your assessment — including a
                decision that nothing happened — keeps the account complete.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {reviews.map((review) => (
                  <li key={review.id} className="py-4 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          review.outcome === 'ESCALATED'
                            ? 'warning'
                            : review.outcome === 'DISMISSED'
                              ? 'muted'
                              : 'success'
                        }
                      >
                        <CheckCircle2 aria-hidden />
                        {OUTCOME_LABEL[review.outcome] ?? review.outcome}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {review.adminName} · {formatDateTime(review.createdAt)}
                      </span>
                    </div>
                    {review.note ? (
                      <p className="mt-2.5 max-w-prose whitespace-pre-wrap text-sm leading-relaxed">
                        {review.note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <Dialog open={reviewOpen} onOpenChange={saving ? undefined : setReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record your review</DialogTitle>
            <DialogDescription>
              Your assessment is stored alongside the attempt. The integrity score itself is never
              overwritten, so the original signals remain auditable.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="review-outcome">Outcome</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger id="review-outcome">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REVIEWED">Reviewed — no further action</SelectItem>
                  <SelectItem value="DISMISSED">Dismissed — signals explained</SelectItem>
                  <SelectItem value="ESCALATED">Escalate to examination committee</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="review-note">Note</Label>
              <Textarea
                id="review-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={4}
                placeholder="Spoke with the student — the fullscreen exit was a low-battery notification. No concern."
              />
              <p className="text-xs text-muted-foreground">
                Describe what you observed and what you did. Avoid recording a conclusion the
                evidence does not support.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submitReview()} loading={saving}>
              Save review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

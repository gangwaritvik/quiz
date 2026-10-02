'use client';

import { CheckCircle2, MessageSquare, ScrollText } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import { ErrorState, InlineError } from '@/components/shared/error-state';
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
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SkeletonRows } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { formatDateTime } from '@/lib/utils';

interface Appeal {
  id: string;
  attemptId: string;
  reason: string;
  status: 'OPEN' | 'UPHELD' | 'REJECTED';
  facultyNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  studentName: string;
  rollNumber: string;
  section: string;
  quizId: string;
  quizTitle: string;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
}

interface PaperQuestion {
  position: number;
  marks: number;
  text: string;
  answer: { id: string; awardedMarks: number | null } | null;
}

interface PaperData {
  questions: PaperQuestion[];
}

const STATUS_BADGE = {
  OPEN: { variant: 'warning', label: 'Waiting' },
  UPHELD: { variant: 'success', label: 'Upheld' },
  REJECTED: { variant: 'muted', label: 'Not upheld' },
} as const;

/**
 * Students' requests to have a released result re-checked. Faculty read the
 * request, look at the paper, and either change marks (upholding) or explain
 * why the result stands. Every answer is recorded and the student sees it.
 */
export function AdminAppeals() {
  const [scope, setScope] = React.useState<'open' | 'all'>('open');
  const { data, error, initialLoading, refetch } = useApi<{ appeals: Appeal[] }>(
    `/api/admin/appeals?status=${scope}`,
  );
  const [answering, setAnswering] = React.useState<Appeal | null>(null);

  const appeals = data?.appeals ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Appeals"
        description="Students asking for a released result to be re-checked."
      />

      <Tabs value={scope} onValueChange={(value) => setScope(value as 'open' | 'all')} className="mt-6">
        <TabsList aria-label="Which appeals to show">
          <TabsTrigger value="open">Waiting</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-5">
        {error && !data ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : initialLoading ? (
          <SkeletonRows rows={4} />
        ) : appeals.length === 0 ? (
          <EmptyState
            icon={scope === 'open' ? CheckCircle2 : MessageSquare}
            tone={scope === 'open' ? 'success' : undefined}
            title={scope === 'open' ? 'Nothing waiting' : 'No appeals yet'}
            description="When a student asks for a result to be re-checked, it appears here."
          />
        ) : (
          <ul className="stagger divide-y divide-border rounded-lg border border-border bg-card">
            {appeals.map((appeal) => {
              const badge = STATUS_BADGE[appeal.status];
              return (
                <li key={appeal.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {appeal.studentName}{' '}
                        <span className="font-mono text-xs font-normal text-muted-foreground">
                          {appeal.rollNumber}
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {appeal.quizTitle}
                        {appeal.percentage !== null
                          ? ` · ${appeal.score}/${appeal.maxScore} (${appeal.percentage}%)`
                          : ''}
                        {' · asked '}
                        {formatDateTime(appeal.createdAt)}
                      </p>
                    </div>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>

                  <blockquote className="border-l-2 border-border pl-3 text-sm leading-relaxed">
                    {appeal.reason}
                  </blockquote>

                  {appeal.status !== 'OPEN' && appeal.facultyNote ? (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Your answer: </span>
                      {appeal.facultyNote}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/results/${appeal.attemptId}`}>
                        <ScrollText />
                        View answers
                      </Link>
                    </Button>
                    {appeal.status === 'OPEN' ? (
                      <Button size="sm" onClick={() => setAnswering(appeal)}>
                        Answer
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AnswerDialog
        appeal={answering}
        onOpenChange={(open) => {
          if (!open) setAnswering(null);
        }}
        onDone={() => {
          setAnswering(null);
          void refetch();
        }}
      />
    </PageShell>
  );
}

function AnswerDialog({
  appeal,
  onOpenChange,
  onDone,
}: {
  appeal: Appeal | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const last = React.useRef(appeal);
  if (appeal) last.current = appeal;
  const shown = appeal ?? last.current;

  return (
    <Dialog open={appeal !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        {shown ? <AnswerForm key={shown.id} appeal={shown} onCancel={() => onOpenChange(false)} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AnswerForm({
  appeal,
  onCancel,
  onDone,
}: {
  appeal: Appeal;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { data, error } = useApi<PaperData>(`/api/admin/results/${appeal.attemptId}`);
  const [outcome, setOutcome] = React.useState<'UPHELD' | 'REJECTED'>('REJECTED');
  const [note, setNote] = React.useState('');
  const [marks, setMarks] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  const questions = (data?.questions ?? []).filter((question) => question.answer);

  const submit = async () => {
    setProblem(null);
    if (note.trim().length === 0) {
      setProblem('Explain the decision in a sentence; the student will read it.');
      return;
    }
    const adjustments: Array<{ answerId: string; awardedMarks: number }> = [];
    if (outcome === 'UPHELD') {
      for (const question of questions) {
        const raw = marks[question.answer!.id];
        if (raw === undefined || raw.trim() === '') continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0 || value > question.marks) {
          setProblem(`Q${question.position + 1}: enter marks from 0 to ${question.marks}.`);
          return;
        }
        adjustments.push({ answerId: question.answer!.id, awardedMarks: value });
      }
    }

    setBusy(true);
    try {
      await apiFetch(`/api/admin/appeals/${appeal.id}`, {
        method: 'POST',
        body: { status: outcome, note: note.trim(), adjustments },
      });
      toast.success(
        outcome === 'UPHELD'
          ? adjustments.length > 0
            ? 'Appeal upheld and marks updated.'
            : 'Appeal upheld.'
          : 'Reply sent. The result stands.',
      );
      onDone();
    } catch (caught) {
      setProblem(
        caught instanceof ApiClientError ? caught.message : 'We could not save that decision.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Answer {appeal.studentName}
        </DialogTitle>
        <DialogDescription>{appeal.quizTitle}</DialogDescription>
      </DialogHeader>

      <blockquote className="border-l-2 border-border pl-3 text-sm leading-relaxed">
        {appeal.reason}
      </blockquote>

      <div className="space-y-2">
        <Label htmlFor="appeal-outcome">Decision</Label>
        <Select value={outcome} onValueChange={(value) => setOutcome(value as 'UPHELD' | 'REJECTED')}>
          <SelectTrigger id="appeal-outcome" aria-label="Decision">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="REJECTED">The result stands</SelectItem>
            <SelectItem value="UPHELD">Uphold, and change marks if needed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {outcome === 'UPHELD' ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Change marks (leave blank to keep)</p>
          {error && !data ? (
            <InlineError message={error.message} />
          ) : !data ? (
            <SkeletonRows rows={3} />
          ) : (
            <ul className="scrollbar-slim max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {questions.map((question) => (
                <li key={question.answer!.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="tabular w-8 shrink-0 text-sm text-muted-foreground">
                    Q{question.position + 1}
                  </span>
                  <span className="line-clamp-1 min-w-0 flex-1 text-sm">{question.text}</span>
                  <span className="tabular shrink-0 text-xs text-muted-foreground">
                    now {question.answer!.awardedMarks ?? 0} / {question.marks}
                  </span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={question.marks}
                    step="0.25"
                    value={marks[question.answer!.id] ?? ''}
                    onChange={(event) =>
                      setMarks((current) => ({ ...current, [question.answer!.id]: event.target.value }))
                    }
                    aria-label={`New marks for question ${question.position + 1}`}
                    className="w-20 shrink-0"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="appeal-note" required>
          Your reply to the student
        </Label>
        <Textarea
          id="appeal-note"
          value={note}
          maxLength={1000}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {problem ? <InlineError message={problem} /> : null}

      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button loading={busy} onClick={() => void submit()}>
          Send decision
        </Button>
      </DialogFooter>
    </>
  );
}

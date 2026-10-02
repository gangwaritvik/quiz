'use client';

import { MessageSquareText } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { InlineError } from '@/components/shared/error-state';
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
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { formatDateTime } from '@/lib/utils';

export interface ResultAppealView {
  id: string;
  status: 'OPEN' | 'UPHELD' | 'REJECTED';
  reason: string;
  facultyNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const OUTCOME = {
  UPHELD: { variant: 'success', label: 'Upheld', line: 'Your faculty upheld your request.' },
  REJECTED: {
    variant: 'muted',
    label: 'Result stands',
    line: 'Your faculty looked again and the result stands.',
  },
} as const;

/**
 * The student's way to ask for a released result to be re-checked, and where
 * they see the answer. Free text: which question, and why.
 */
export function AppealSection({
  attemptId,
  appeal,
  canAppeal,
  onChanged,
}: {
  attemptId: string;
  appeal: ResultAppealView | null;
  canAppeal: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  if (!appeal && !canAppeal) return null;

  const send = async () => {
    setProblem(null);
    if (reason.trim().length < 10) {
      setProblem('Say which question and why, in a sentence or two.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/results/${attemptId}/appeal`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      toast.success('Sent to your faculty. You will see their answer here.');
      setOpen(false);
      setReason('');
      onChanged();
    } catch (caught) {
      setProblem(
        caught instanceof ApiClientError ? caught.message : 'We could not send that request.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Ask for a re-check"
      className="mt-6 rounded-lg border border-border bg-card px-4 py-3.5 sm:px-5"
    >
      {appeal?.status === 'OPEN' ? (
        <div className="space-y-1.5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <MessageSquareText className="size-4 text-muted-foreground" aria-hidden />
            Your re-check request is with your faculty
            <Badge variant="warning">Waiting</Badge>
          </p>
          <p className="text-sm text-muted-foreground">
            Sent {formatDateTime(appeal.createdAt)}: &ldquo;{appeal.reason}&rdquo;
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            {appeal ? (
              <>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <MessageSquareText className="size-4 text-muted-foreground" aria-hidden />
                  {OUTCOME[appeal.status as 'UPHELD' | 'REJECTED'].line}
                  <Badge variant={OUTCOME[appeal.status as 'UPHELD' | 'REJECTED'].variant}>
                    {OUTCOME[appeal.status as 'UPHELD' | 'REJECTED'].label}
                  </Badge>
                </p>
                {appeal.facultyNote ? (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">They wrote: </span>
                    {appeal.facultyNote}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Think a mark is wrong? You can ask your faculty to look at it again.
              </p>
            )}
          </div>
          {canAppeal ? (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              {appeal ? 'Ask again' : 'Ask for a re-check'}
            </Button>
          ) : null}
        </div>
      )}

      <Dialog open={open} onOpenChange={busy ? undefined : setOpen}>
        <DialogContent hideClose={busy} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ask for a re-check</DialogTitle>
            <DialogDescription>
              Your faculty will look at your paper again and reply here. Say which question you mean
              and why you think the mark is wrong.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="appeal-reason">Which question, and why?</Label>
            <Textarea
              id="appeal-reason"
              value={reason}
              maxLength={1000}
              rows={5}
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="tabular text-right text-xs text-muted-foreground">{reason.length} / 1000</p>
          </div>
          {problem ? <InlineError message={problem} /> : null}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void send()}>
              Send to my faculty
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

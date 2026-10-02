'use client';

import { AlertTriangle, CheckCircle2, CircleDashed, Flag, Send } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface SubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  answered: number;
  total: number;
  flagged: number;
  submitting: boolean;
  onConfirm: () => void;
}

/** Final confirmation before an irreversible submit. */
export function SubmitDialog({
  open,
  onOpenChange,
  answered,
  total,
  flagged,
  submitting,
  onConfirm,
}: SubmitDialogProps) {
  const unanswered = total - answered;

  return (
    <Dialog open={open} onOpenChange={submitting ? undefined : onOpenChange}>
      <DialogContent hideClose={submitting} still>
        <DialogHeader>
          <DialogTitle>Submit your exam?</DialogTitle>
          <DialogDescription>
            You have answered{' '}
            <span className="tabular font-semibold text-foreground">
              {answered} of {total}
            </span>{' '}
            questions. Once submitted you cannot return to this paper.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-3 divide-x divide-border rounded-md border border-border">
          <Stat icon={CheckCircle2} label="Answered" value={answered} tone="text-success" />
          <Stat
            icon={CircleDashed}
            label="Unanswered"
            value={unanswered}
            tone={unanswered > 0 ? 'text-warning' : 'text-muted-foreground'}
          />
          <Stat
            icon={Flag}
            label="Marked for review"
            value={flagged}
            tone={flagged > 0 ? 'text-warning' : 'text-muted-foreground'}
          />
        </dl>

        {unanswered > 0 ? (
          <p className="flex items-start gap-2 rounded-md bg-warning-subtle px-3 py-2.5 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {unanswered} question{unanswered === 1 ? '' : 's'} will be submitted unanswered and
              score zero.
            </span>
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={submitting}>
            Continue exam
          </Button>
          <Button size="lg" onClick={onConfirm} loading={submitting}>
            {submitting ? 'Submitting…' : 'Submit exam'}
            {submitting ? null : <Send aria-hidden />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Flag;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="flex flex-col-reverse items-center gap-1 px-2 py-3.5 text-center">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={cn('size-3.5 shrink-0', tone)} aria-hidden />
        {label}
      </dt>
      <dd className="tabular text-2xl font-semibold leading-none text-foreground">{value}</dd>
    </div>
  );
}

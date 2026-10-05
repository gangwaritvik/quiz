'use client';

import { AlarmClock, Clock, Hourglass } from 'lucide-react';

import { cn, formatDuration } from '@/lib/utils';

interface ExamTimerDisplayProps {
  remainingSeconds: number;
  warning: boolean;
  critical: boolean;
}

/**
 * The countdown. Purely a display of the server's number — it does not decide
 * anything. Normal text colour at first; under five minutes it turns amber, under one
 * minute red. Each state also changes the icon and adds a word, so it never
 * relies on colour, and it is announced to assistive technology. Nothing
 * pulses or animates.
 */
// Coarse on purpose: the live region only speaks when this text changes.
function announcement(seconds: number) {
  if (seconds > 60) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minutes remaining`;
  }
  if (seconds > 30) return 'Less than one minute remaining';
  if (seconds > 10) return '30 seconds remaining';
  if (seconds > 0) return '10 seconds remaining';
  return 'Time is up';
}

export function ExamTimerDisplay({ remainingSeconds, warning, critical }: ExamTimerDisplayProps) {
  const Icon = critical ? AlarmClock : warning ? Hourglass : Clock;

  return (
    <div
      className={cn(
        'flex h-10 items-center gap-2 rounded-md border px-3',
        critical
          ? 'border-danger bg-danger text-danger-foreground'
          : warning
            ? 'border-warning/50 bg-warning-subtle text-warning'
            : 'border-border bg-card text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="sr-only">Time remaining</span>
      <span className="tabular font-mono text-lg font-semibold leading-none">
        {formatDuration(remainingSeconds)}
      </span>
      <span className="sr-only" aria-live={critical ? 'assertive' : 'polite'} aria-atomic="true">
        {announcement(remainingSeconds)}
      </span>
      {(warning || critical) && (
        <span className="hidden text-xs font-semibold sm:inline">
          {critical ? 'Submitting soon' : 'Wrap up'}
        </span>
      )}
    </div>
  );
}

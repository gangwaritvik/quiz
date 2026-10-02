'use client';

import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ApiClientError } from '@/lib/client/api';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  error: ApiClientError;
  onRetry?: () => void;
  className?: string;
}

/** Turns an API error code into copy a student or teacher can act on. */
export function ErrorState({ error, onRetry, className }: ErrorStateProps) {
  const offline = error.code === 'NETWORK';
  const Icon = offline ? WifiOff : AlertTriangle;

  const title = offline
    ? 'Connection interrupted'
    : error.code === 'FORBIDDEN'
      ? 'You do not have access to this'
      : error.code === 'NOT_FOUND'
        ? 'Not found'
        : error.code === 'RATE_LIMITED'
          ? 'Too many requests'
          : 'Something went wrong';

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-border bg-card px-6 py-14 text-center',
        className,
      )}
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-danger-subtle text-danger">
        <Icon className="size-5" aria-hidden />
      </div>
      <h3 className="type-subheading text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
        {error.message}
      </p>
      {onRetry ? (
        <Button variant="outline" className="mt-6" onClick={onRetry}>
          <RefreshCw aria-hidden />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Compact inline variant for sections inside a populated page. */
export function InlineError({ message, className }: { message: string; className?: string }) {
  return (
    <p
      role="alert"
      className={cn('flex items-start gap-1.5 text-sm text-destructive', className)}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

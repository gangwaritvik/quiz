import * as React from 'react';

import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/** Page title in the serif, a measure-limited description, actions on the right. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="type-title text-foreground">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Standard page gutter used by every dashboard screen. */
export function PageShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('page-enter mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-12', className)}>
      {children}
    </div>
  );
}

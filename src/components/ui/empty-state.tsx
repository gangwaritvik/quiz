import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
  tone?: 'default' | 'success';
}

/** Shared "nothing here yet" panel — every list view uses this rather than a bare message. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  tone = 'default',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-14 text-center',
        className,
      )}
    >
      <Icon
        className={cn('mb-4 size-7', tone === 'success' ? 'text-success' : 'text-muted-foreground')}
        strokeWidth={1.5}
        aria-hidden
      />
      <h3 className="font-serif text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

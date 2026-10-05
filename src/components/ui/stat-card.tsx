import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'success' | 'warning' | 'danger';

// Tone colours only the icon; the label and value carry the meaning.
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
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'default', loading = false }: StatCardProps) {
  return (
    <div className="h-full rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Icon className={cn('size-4 shrink-0', TONE_STYLES[tone])} aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{label}</p>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-12" />
      ) : (
        <p className="tabular mt-1.5 text-2xl font-semibold leading-tight text-foreground">{value}</p>
      )}
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground">
          {loading ? <Skeleton className="h-3 w-28" /> : hint}
        </div>
      ) : null}
    </div>
  );
}

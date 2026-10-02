import { AlertOctagon, AlertTriangle, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type IntegrityStatus = 'NORMAL' | 'REVIEW_RECOMMENDED' | 'HIGH_RISK';

/**
 * Status is conveyed by icon *and* wording as well as colour, so the meaning
 * survives greyscale printing and colour-blind viewing.
 */
const CONFIG = {
  NORMAL: { label: 'Normal', icon: ShieldCheck, variant: 'success' as const, dot: 'bg-success' },
  REVIEW_RECOMMENDED: {
    label: 'Review recommended',
    icon: AlertTriangle,
    variant: 'warning' as const,
    dot: 'bg-warning',
  },
  HIGH_RISK: {
    label: 'High risk',
    icon: AlertOctagon,
    variant: 'danger' as const,
    dot: 'bg-danger',
  },
};

interface IntegrityBadgeProps {
  status: IntegrityStatus;
  score?: number | null;
  className?: string;
  showIcon?: boolean;
}

export function IntegrityBadge({
  status,
  score,
  className,
  showIcon = true,
}: IntegrityBadgeProps) {
  const config = CONFIG[status];
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={cn('gap-1.5', className)}>
      {showIcon ? <Icon aria-hidden /> : null}
      {typeof score === 'number' ? <span className="tabular">{score}</span> : null}
      {typeof score === 'number' ? <span aria-hidden>·</span> : null}
      {config.label}
    </Badge>
  );
}

export function integrityStatusLabel(status: IntegrityStatus) {
  return CONFIG[status].label;
}

export function integrityDotClass(status: IntegrityStatus) {
  return CONFIG[status].dot;
}

/** Bar used in the integrity report header. Colour follows the same scale. */
export function IntegrityMeter({
  score,
  status,
  className,
}: {
  score: number;
  status: IntegrityStatus;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Integrity score ${score} out of 100 — ${CONFIG[status].label}`}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-slow ease-standard',
            CONFIG[status].dot,
          )}
          style={{ width: `${Math.max(2, score)}%` }}
        />
      </div>
      <div className="tabular flex items-center justify-between text-xs text-muted-foreground">
        <span>0</span>
        <span>100</span>
      </div>
    </div>
  );
}

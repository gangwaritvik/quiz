'use client';

import * as React from 'react';
import { ProgressBar } from 'react-aria-components';

import { cn } from '@/lib/utils';

/* React Aria progressbar (role, aria-valuenow, value text). Give it an aria-label. */

interface ProgressProps {
  value?: number | null;
  max?: number;
  className?: string;
  indicatorClassName?: string;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ value, max = 100, className, indicatorClassName, ...props }, ref) => (
    <ProgressBar
      ref={ref}
      value={value ?? 0}
      maxValue={max}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      {({ percentage }) => (
        <div
          className={cn(
            'h-full w-full bg-primary transition-transform duration-slow ease-standard',
            indicatorClassName,
          )}
          style={{ transform: `translateX(-${100 - (percentage ?? 0)}%)` }}
        />
      )}
    </ProgressBar>
  ),
);
Progress.displayName = 'Progress';

export { Progress };

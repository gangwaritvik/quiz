import * as React from 'react';

import { cn } from '@/lib/utils';

/*
 * A native <label>. When it points at a control (`htmlFor`) it also gets a
 * predictable id, `${htmlFor}-label`, which <SelectTrigger id=…> uses to name
 * itself — a native label alone cannot name a RAC select trigger.
 */
const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }
>(({ className, required, children, id, htmlFor, ...props }, ref) => (
  <label
    ref={ref}
    id={id ?? (htmlFor ? `${htmlFor}-label` : undefined)}
    htmlFor={htmlFor}
    className={cn(
      'text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className,
    )}
    {...props}
  >
    {children}
    {required ? (
      <span className="ml-0.5 text-danger" aria-hidden>
        *
      </span>
    ) : null}
  </label>
));
Label.displayName = 'Label';

export { Label };

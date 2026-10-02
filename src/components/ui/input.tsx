import * as React from 'react';

import { cn } from '@/lib/utils';

/*
 * Native inputs (not RAC) so every existing onChange/ref/register pattern keeps
 * working. The border is the ≥3:1 `input` token so a field is identifiable on
 * a white sheet; focus uses the global outline.
 */
const fieldClasses = [
  'flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground',
  'transition-colors duration-fast ease-standard',
  'placeholder:text-muted-foreground',
  'hover:border-foreground/40 focus-visible:border-primary focus-visible:outline-offset-1',
  'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
];

const invalidClasses = 'border-danger hover:border-danger focus-visible:border-danger focus-visible:outline-danger';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, invalid, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        fieldClasses,
        'h-10 [@media(pointer:coarse)]:min-h-11',
        'file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        invalid && invalidClasses,
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(fieldClasses, 'min-h-[80px] leading-relaxed', invalid && invalidClasses, className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Input, Textarea };

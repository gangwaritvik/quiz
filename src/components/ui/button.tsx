import { type VariantProps, cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { Slot } from '@/components/ui/slot';
import { cn } from '@/lib/utils';

/*
 * A native <button> on purpose: call sites rely on onClick, type="submit",
 * form attributes and arbitrary DOM props, all of which a native element keeps.
 * Focus is drawn by the global :focus-visible outline.
 */
const buttonVariants = cva(
  [
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium',
    'transition-[color,background-color,border-color,box-shadow,opacity] duration-fast ease-standard',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-border bg-card text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary',
        success: 'bg-success text-success-foreground hover:bg-success/90',
      },
      size: {
        default: 'h-10 px-4 [@media(pointer:coarse)]:min-h-11',
        sm: 'h-9 px-3 [@media(pointer:coarse)]:min-h-11',
        lg: 'h-11 px-6 text-[0.9375rem]',
        xl: 'h-12 rounded-lg px-7 text-base',
        icon: 'size-10 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11',
        'icon-sm': 'size-8 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    // `asChild` renders an arbitrary element, so the spinner is only injected
    // for real buttons where we control the children.
    if (asChild) {
      return (
        <Slot className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Slot>
      );
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };

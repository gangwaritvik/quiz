import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  /** Renders the wordmark alongside the mark. */
  withWordmark?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: { mark: 'size-7', text: 'text-base' },
  md: { mark: 'size-8', text: 'text-lg' },
  lg: { mark: 'size-10', text: 'text-xl' },
} as const;

/** Four answer bubbles, one filled. The same drawing as public/icons/icon.svg. */
export function Logo({ className, withWordmark = true, size = 'md' }: LogoProps) {
  const dimensions = SIZES[size];

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground',
          dimensions.mark,
        )}
      >
        <svg viewBox="0 0 24 24" className="size-[72%]">
          <g fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="7.5" cy="7.5" r="2.75" />
            <circle cx="7.5" cy="16.5" r="2.75" />
            <circle cx="16.5" cy="16.5" r="2.75" />
          </g>
          <circle cx="16.5" cy="7.5" r="3.55" fill="currentColor" />
        </svg>
      </span>

      {withWordmark ? (
        <span
          aria-hidden
          className={cn('font-semibold leading-none tracking-tight text-foreground', dimensions.text)}
        >
          SecureQuiz
        </span>
      ) : null}
      <span className="sr-only">SecureQuiz</span>
    </span>
  );
}

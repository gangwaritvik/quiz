import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  /** Renders the wordmark alongside the mark. */
  withWordmark?: boolean;
  tone?: 'dark' | 'light';
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: { mark: 'size-7', text: 'text-lg' },
  md: { mark: 'size-8', text: 'text-xl' },
  lg: { mark: 'size-10', text: 'text-2xl' },
} as const;

/**
 * SecureQuiz mark and wordmark: the shield-and-tick seal from the app icon,
 * set beside the name in the serif — a college press imprint rather than an
 * app badge. `tone="light"` is for the dark Oxford surfaces.
 */
export function Logo({ className, withWordmark = true, tone = 'dark', size = 'md' }: LogoProps) {
  const dimensions = SIZES[size];

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md',
          tone === 'dark' ? 'bg-primary text-primary-foreground' : 'bg-navy-50 text-navy-950',
          dimensions.mark,
        )}
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-[64%]">
          <path
            d="M12 2.75 5 5.5v5.9c0 4.2 2.8 8.1 7 9.45 4.2-1.35 7-5.25 7-9.45V5.5l-7-2.75Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="m8.85 11.9 2.15 2.2 4.15-4.25"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      {withWordmark ? (
        <span
          aria-hidden
          className={cn(
            'font-serif font-semibold leading-none tracking-[-0.015em]',
            dimensions.text,
            tone === 'dark' ? 'text-foreground' : 'text-navy-50',
          )}
        >
          SecureQuiz
        </span>
      ) : null}
      <span className="sr-only">SecureQuiz</span>
    </span>
  );
}

'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/*
 * Initials-first avatar. The fallback is always rendered underneath; an
 * AvatarImage, when present, covers it and removes itself if it fails to load.
 */
const Avatar = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn('relative flex size-9 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  ),
);
Avatar.displayName = 'Avatar';

const AvatarImage = React.forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(
  ({ className, alt = '', onError, ...props }, ref) => {
    const [failed, setFailed] = React.useState(false);
    if (failed) return null;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user-supplied avatar URL
      <img
        ref={ref}
        alt={alt}
        className={cn('absolute inset-0 size-full object-cover', className)}
        onError={(event) => {
          setFailed(true);
          onError?.(event);
        }}
        {...props}
      />
    );
  },
);
AvatarImage.displayName = 'AvatarImage';

const AvatarFallback = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'flex size-full select-none items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground',
        className,
      )}
      {...props}
    />
  ),
);
AvatarFallback.displayName = 'AvatarFallback';

export { Avatar, AvatarImage, AvatarFallback };

'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // The digest is the only safe handle on a server error; the message itself
    // is not exposed to the client in production.
    console.error('[securequiz] unhandled error', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-8">
        <Logo size="sm" />
      </div>

      <main id="main" className="flex flex-1 items-center px-5 pb-24 pt-8 sm:px-8">
        <div className="mx-auto w-full max-w-xl">
          <p className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.08em] text-danger">
            <AlertTriangle className="size-4" aria-hidden />
            Unexpected error
          </p>
          <h1 className="type-display mt-4">Something went wrong</h1>
          <p className="mt-4 max-w-prose text-base leading-relaxed text-muted-foreground">
            We hit an unexpected error. If you were in the middle of an examination, your answers
            were saved on the server — reopen the exam to continue where you left off.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" onClick={reset}>
              <RefreshCw aria-hidden />
              Try again
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/">Back to dashboard</Link>
            </Button>
          </div>

          {error.digest ? (
            <p className="mt-8 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
              Reference{' '}
              <span className="font-mono text-foreground [overflow-wrap:anywhere]">
                {error.digest}
              </span>{' '}
              — quote this if you contact the examination office.
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}

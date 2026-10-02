import { FileQuestion } from 'lucide-react';
import Link from 'next/link';

import { Logo } from '@/components/brand/logo';
import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-8">
        <Link href="/" className="inline-flex rounded-md">
          <Logo size="sm" />
        </Link>
      </div>

      <main id="main" className="flex flex-1 items-center px-5 pb-24 pt-8 sm:px-8">
        <div className="mx-auto w-full max-w-xl">
          <p className="type-eyebrow flex items-center gap-2">
            <FileQuestion className="size-4" aria-hidden />
            Error 404
          </p>
          <h1 className="type-display mt-4">Page not found</h1>
          <p className="mt-4 max-w-prose text-base leading-relaxed text-muted-foreground">
            This page does not exist, or you do not have access to it. If you followed a link from
            your faculty, check that you are signed in with the right account.
          </p>
          {/* A plain Link with button styling: `Button asChild` needs a ref,
              which a Server Component cannot pass. */}
          <Link href="/" className={buttonVariants({ size: 'lg', className: 'mt-8' })}>
            Go to my dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}

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
          <h1 className="type-title">Page not found</h1>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-muted-foreground">
            This page does not exist, or you do not have access to it. If you followed a link from
            your faculty, check that you are signed in with the right account.
          </p>
          {/* A plain Link with button styling: `Button asChild` needs a ref,
              which a Server Component cannot pass. */}
          <Link href="/" className={buttonVariants({ className: 'mt-6' })}>
            Go to my dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}

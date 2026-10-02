import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoginPanel } from '@/components/auth/login-panel';
import { LoginShowcase } from '@/components/auth/login-showcase';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to SecureQuiz with your student ID or college email.',
};

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <LoginShowcase />

      <main
        id="main"
        className="flex min-w-0 flex-col items-center px-5 py-10 sm:px-8 sm:py-16 lg:justify-center lg:py-12"
      >
        <Suspense fallback={<Skeleton className="h-[420px] w-full max-w-sm rounded-lg" />}>
          <LoginPanel />
        </Suspense>
      </main>
    </div>
  );
}

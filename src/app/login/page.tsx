import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoginPanel } from '@/components/auth/login-panel';
import { Logo } from '@/components/brand/logo';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to SecureQuiz with your student ID or college email.',
};

export default function LoginPage() {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center px-5 py-10 sm:justify-center sm:py-16"
    >
      <Logo size="md" className="mb-6" />
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 sm:p-8">
        <Suspense fallback={<Skeleton className="h-72 w-full" />}>
          <LoginPanel />
        </Suspense>
      </div>
    </main>
  );
}

import { redirect } from 'next/navigation';

import { MobileExamAdvisory } from '@/components/student/mobile-advisory';
import { StudentNav } from '@/components/student/student-nav';
import { getSession } from '@/lib/session';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  // Middleware already routes by role; this re-check is the authoritative one,
  // since a page must never render student data on an unverified session.
  const session = await getSession();
  if (!session) redirect('/login?reason=session');
  if (session.role !== 'STUDENT') redirect('/admin');

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <StudentNav
        user={{
          name: session.name,
          email: session.email,
          rollNumber: session.rollNumber ?? null,
          department: session.department ?? null,
          section: session.section ?? null,
        }}
      />

      {/* Pages set their own width and gutter with PageShell (max-w-7xl,
          px-5 / sm:px-8), which the nav and footer below line up with. */}
      <main id="main" className="min-w-0 flex-1 pb-12">
        <MobileExamAdvisory />
        {children}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>SecureQuiz</p>
          <p>Exam activity is logged for integrity review.</p>
        </div>
      </footer>
    </div>
  );
}

import { redirect } from 'next/navigation';

import { AdminShell } from '@/components/admin/admin-shell';
import { getSession } from '@/lib/session';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?reason=session');
  // A student who somehow reaches an admin URL is sent to their own area
  // rather than shown an error that confirms the route exists.
  if (session.role !== 'ADMIN') redirect('/dashboard');

  return (
    <AdminShell
      user={{
        name: session.name,
        email: session.email,
        department: session.department ?? null,
      }}
    >
      {children}
    </AdminShell>
  );
}

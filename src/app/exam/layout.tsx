import { redirect } from 'next/navigation';

import { getSession } from '@/lib/session';

/**
 * The exam route deliberately has no site chrome — no navigation, no footer,
 * nothing to click away to. Authorisation is still enforced here in addition
 * to the middleware and the API layer.
 */
export default async function ExamLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?reason=session');
  if (session.role !== 'STUDENT') redirect('/admin');

  return <>{children}</>;
}

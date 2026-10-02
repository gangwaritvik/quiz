import { redirect } from 'next/navigation';

import { ROLE_HOME } from '@/lib/roles';
import { getSession } from '@/lib/session';

/**
 * The root path always redirects. `middleware.ts` normally handles this at the
 * edge; this page is the fallback for any request that reaches the app router
 * directly, so the two can never disagree about where a user belongs.
 */
export default async function RootPage() {
  const session = await getSession();
  redirect(session ? ROLE_HOME[session.role] : '/login');
}

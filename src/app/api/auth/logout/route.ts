import { assertSameOrigin, ok, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import {
  clearSessionCookies,
  getRequestContext,
  getSession,
  revokeSession,
} from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  const session = await getSession();
  if (session) {
    // Revoke server-side first: clearing cookies alone would leave a valid
    // session behind for anyone holding a copy of the refresh token.
    await revokeSession(session.sessionId, 'user_logout');
    await audit({
      action: 'auth.logout',
      userId: session.userId,
      context: await getRequestContext(),
    });
  }

  await clearSessionCookies();
  return ok({ signedOut: true });
});

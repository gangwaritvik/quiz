import { assertSameOrigin, ok, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import {
  clearSessionCookies,
  findSessionByRefreshCookie,
  getRequestContext,
  getSession,
  revokeSession,
} from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  // Fall back to the refresh cookie: the 20-minute access token may already
  // have expired while the 8-hour session is still live.
  const active = await getSession();
  const session = active
    ? { sessionId: active.sessionId, userId: active.userId }
    : await findSessionByRefreshCookie().then((s) => s && { sessionId: s.id, userId: s.userId });
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

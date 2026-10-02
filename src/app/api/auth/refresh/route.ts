import { NextResponse } from 'next/server';

import { route } from '@/lib/api';
import { ROLE_HOME } from '@/lib/roles';
import { refreshAccessToken } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Silent re-issue of the short-lived access token from the server-side session.
 * `middleware.ts` redirects here when the access token has aged out but the
 * session is still valid, so navigation does not bounce the user to login.
 */
export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const rawNext = url.searchParams.get('next') ?? '';

  // Open-redirect guard: only same-origin paths are honoured. Backslashes are
  // rejected outright because browsers treat `/\host` like `//host`.
  const next =
    rawNext.startsWith('/') &&
    !rawNext.includes('\\') &&
    new URL(rawNext, url).origin === url.origin
      ? rawNext
      : null;

  const session = await refreshAccessToken();

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    if (next) loginUrl.searchParams.set('next', next);
    loginUrl.searchParams.set('reason', 'session');
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(next ?? ROLE_HOME[session.role], request.url));
});

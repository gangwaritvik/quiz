import { NextResponse, type NextRequest } from 'next/server';

import { ACCESS_COOKIE, REFRESH_COOKIE, verifyAccessToken } from '@/lib/jwt';
import { ROLE_HOME, requiredRoleForPath } from '@/lib/roles';

/**
 * Edge gatekeeper.
 *
 * This is a *routing* convenience, not the security boundary — it keeps
 * signed-out users off dashboard shells and sends people to their own area.
 * Every API route independently re-authorises against the database, so a
 * forged or stale cookie that slips past here still cannot read any data.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const claims = accessToken ? await verifyAccessToken(accessToken) : null;
  const hasRefresh = Boolean(request.cookies.get(REFRESH_COOKIE)?.value);

  if (pathname === '/') {
    const target = claims ? ROLE_HOME[claims.role] : '/login';
    return NextResponse.redirect(new URL(target, request.url));
  }

  if (pathname === '/login') {
    if (claims) return NextResponse.redirect(new URL(ROLE_HOME[claims.role], request.url));
    return NextResponse.next();
  }

  const requiredRole = requiredRoleForPath(pathname);
  if (!requiredRole) return NextResponse.next();

  if (!claims) {
    // The access token is short-lived by design; if the long-lived session
    // cookie is still present, silently mint a new one and carry on.
    if (hasRefresh) {
      const refreshUrl = new URL('/api/auth/refresh', request.url);
      refreshUrl.searchParams.set('next', `${pathname}${search}`);
      return NextResponse.redirect(refreshUrl);
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    loginUrl.searchParams.set('reason', 'session');
    return NextResponse.redirect(loginUrl);
  }

  if (claims.role !== requiredRole) {
    return NextResponse.redirect(new URL(ROLE_HOME[claims.role], request.url));
  }

  return NextResponse.next();
}

export const config = {
  // API routes answer with JSON envelopes rather than redirects, so they are
  // excluded here and guarded by `requireStudent` / `requireAdmin` instead.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|sw.js).*)'],
};

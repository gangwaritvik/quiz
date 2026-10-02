import { ApiError, ok, route } from '@/lib/api';
import { getSession, refreshAccessToken } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Returns the caller's own profile. The client session provider polls this to
 * keep its access token fresh and to notice server-side revocation quickly.
 */
export const GET = route(async () => {
  const session = (await getSession()) ?? (await refreshAccessToken());

  if (!session) {
    throw new ApiError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }

  return ok({
    user: {
      id: session.userId,
      name: session.name,
      email: session.email,
      role: session.role,
      avatarColor: session.avatarColor,
      rollNumber: session.rollNumber ?? null,
      department: session.department ?? null,
      section: session.section ?? null,
    },
  });
});

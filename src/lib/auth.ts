import 'server-only';

import { ApiError } from '@/lib/api';
import { getSession, type AuthenticatedSession } from '@/lib/session';

/**
 * Authorization is always re-derived from the server-side session. A role or
 * student id supplied by the client is never consulted.
 */
export async function requireSession(): Promise<AuthenticatedSession> {
  const session = await getSession();
  if (!session) {
    throw new ApiError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }
  return session;
}

export interface StudentSession extends AuthenticatedSession {
  studentId: string;
}

export async function requireStudent(): Promise<StudentSession> {
  const session = await requireSession();
  if (session.role !== 'STUDENT' || !session.studentId) {
    throw new ApiError('FORBIDDEN', 'This area is available to students only.');
  }
  return session as StudentSession;
}

export interface AdminSession extends AuthenticatedSession {
  adminId: string;
}

export async function requireAdmin(): Promise<AdminSession> {
  const session = await requireSession();
  if (session.role !== 'ADMIN' || !session.adminId) {
    throw new ApiError('FORBIDDEN', 'This area is available to faculty accounts only.');
  }
  return session as AdminSession;
}

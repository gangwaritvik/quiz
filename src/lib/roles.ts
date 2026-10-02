/** Shared role vocabulary — safe to import from client, server and edge code. */
export type Role = 'STUDENT' | 'ADMIN';

export const ROLE_HOME: Record<Role, string> = {
  STUDENT: '/dashboard',
  ADMIN: '/admin',
};

/** Route prefixes that require an authenticated session, and which role owns them. */
export const PROTECTED_PREFIXES: Array<{ prefix: string; role: Role }> = [
  { prefix: '/admin', role: 'ADMIN' },
  { prefix: '/dashboard', role: 'STUDENT' },
  { prefix: '/quizzes', role: 'STUDENT' },
  { prefix: '/exam', role: 'STUDENT' },
  { prefix: '/results', role: 'STUDENT' },
  { prefix: '/profile', role: 'STUDENT' },
];

export function requiredRoleForPath(pathname: string): Role | null {
  const match = PROTECTED_PREFIXES.find(
    (entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`),
  );
  return match?.role ?? null;
}

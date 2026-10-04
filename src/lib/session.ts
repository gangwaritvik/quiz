import 'server-only';

import { cookies, headers } from 'next/headers';

import { keyedHash, randomToken, sha256 } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  DEVICE_COOKIE,
  REFRESH_COOKIE,
  signAccessToken,
  verifyAccessToken,
} from '@/lib/jwt';
import type { Role } from '@/lib/roles';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

const isProd = process.env.NODE_ENV === 'production';

const baseCookie = {
  httpOnly: true,
  secure: isProd, // HTTPS-only in production
  sameSite: 'lax' as const,
  path: '/',
};

export interface RequestContext {
  ip: string;
  ipHash: string;
  userAgent: string;
  deviceId: string;
  deviceHash: string;
  deviceLabel: string;
}

/**
 * Client IP as reported by the reverse proxy (Caddy sets X-Real-IP).
 * The app must only be reachable through that proxy, or these headers are client-controlled.
 */
async function clientIp(): Promise<string> {
  const h = await headers();
  const realIp = h.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  // The last hop is the one appended by the nearest proxy; earlier entries are spoofable.
  return h.get('x-forwarded-for')?.split(',').pop()?.trim() || 'unknown';
}

function describeDevice(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  const os = ua.includes('windows')
    ? 'Windows'
    : ua.includes('mac os') || ua.includes('macintosh')
      ? 'macOS'
      : ua.includes('android')
        ? 'Android'
        : ua.includes('iphone') || ua.includes('ipad')
          ? 'iOS'
          : ua.includes('linux')
            ? 'Linux'
            : 'Unknown OS';
  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('chrome') && !ua.includes('chromium')
      ? 'Chrome'
      : ua.includes('firefox')
        ? 'Firefox'
        : ua.includes('safari')
          ? 'Safari'
          : 'Browser';
  return `${browser} on ${os}`;
}

/**
 * The device fingerprint is a client-supplied id mixed with the user agent and
 * a server-side pepper. It is a *correlation* signal for the integrity engine,
 * never an authentication factor on its own.
 */
export async function getRequestContext(): Promise<RequestContext> {
  const h = await headers();
  const cookieStore = await cookies();
  const userAgent = h.get('user-agent') ?? 'unknown';
  const deviceId =
    h.get('x-device-id') ?? cookieStore.get(DEVICE_COOKIE)?.value ?? 'unregistered-device';
  const ip = await clientIp();

  return {
    ip,
    ipHash: keyedHash(ip),
    userAgent,
    deviceId,
    deviceHash: keyedHash(`${deviceId}::${describeDevice(userAgent)}`),
    deviceLabel: describeDevice(userAgent),
  };
}

export interface AuthenticatedSession {
  userId: string;
  sessionId: string;
  role: Role;
  name: string;
  email: string;
  status: string;
  avatarColor: string;
  deviceHash: string;
  studentId?: string;
  adminId?: string;
  rollNumber?: string;
  department?: string;
  section?: string;
}

async function loadSession(
  userId: string,
  sessionId: string,
): Promise<AuthenticatedSession | null> {
  const session = await prisma.deviceSession.findUnique({
    where: { id: sessionId },
    include: {
      user: { include: { student: true, admin: true } },
    },
  });

  if (!session || session.userId !== userId) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (session.user.status !== 'ACTIVE') return null;

  return {
    userId: session.userId,
    sessionId: session.id,
    role: session.user.role,
    name: session.user.name,
    email: session.user.email,
    status: session.user.status,
    avatarColor: session.user.avatarColor,
    deviceHash: session.deviceHash,
    studentId: session.user.student?.id,
    adminId: session.user.admin?.id,
    rollNumber: session.user.student?.rollNumber,
    department: session.user.student?.department ?? session.user.admin?.department,
    section: session.user.student?.section,
  };
}

/**
 * Resolve the caller from the short-lived access token, then re-validate the
 * underlying server-side session on every call so that revocation is immediate.
 */
export async function getSession(): Promise<AuthenticatedSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  return loadSession(claims.sub, claims.sid);
}

/** Exchange the long-lived refresh token for a fresh access token. */
export async function refreshAccessToken(): Promise<AuthenticatedSession | null> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;

  const record = await prisma.deviceSession.findUnique({
    where: { tokenHash: sha256(refreshToken) },
  });
  if (!record || record.revokedAt || record.expiresAt.getTime() <= Date.now()) return null;

  const session = await loadSession(record.userId, record.id);
  if (!session) return null;

  await prisma.deviceSession.update({
    where: { id: record.id },
    data: { lastSeenAt: new Date() },
  });

  await issueAccessCookie(session);
  return session;
}

async function issueAccessCookie(session: AuthenticatedSession) {
  const token = await signAccessToken({
    sub: session.userId,
    sid: session.sessionId,
    role: session.role,
    dev: session.deviceHash.slice(0, 16),
  });
  const cookieStore = await cookies();
  cookieStore.set(ACCESS_COOKIE, token, {
    ...baseCookie,
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export interface CreateSessionInput {
  userId: string;
  context: RequestContext;
}

export async function createSession({ userId, context }: CreateSessionInput) {
  const refreshToken = randomToken(32);

  const record = await prisma.deviceSession.create({
    data: {
      userId,
      tokenHash: sha256(refreshToken),
      deviceHash: context.deviceHash,
      deviceLabel: context.deviceLabel,
      userAgent: context.userAgent.slice(0, 400),
      ipHash: context.ipHash,
      trusted: false,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(REFRESH_COOKIE, refreshToken, {
    ...baseCookie,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  cookieStore.set(DEVICE_COOKIE, context.deviceId, {
    ...baseCookie,
    httpOnly: false, // the client reads this to keep its device id stable
    maxAge: 365 * 24 * 60 * 60,
  });

  const session = await loadSession(userId, record.id);
  if (session) await issueAccessCookie(session);
  return { session, sessionId: record.id };
}

/** The session behind the refresh cookie, found even after the access token expired. */
export async function findSessionByRefreshCookie() {
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;
  return prisma.deviceSession.findUnique({
    where: { tokenHash: sha256(refreshToken) },
    select: { id: true, userId: true },
  });
}

export async function revokeSession(sessionId: string, reason: string) {
  await prisma.deviceSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/** Used when an exam requires a single active session per student. */
export async function revokeOtherSessions(userId: string, keepSessionId: string, reason: string) {
  const result = await prisma.deviceSession.updateMany({
    where: { userId, id: { not: keepSessionId }, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

export async function clearSessionCookies() {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_COOKIE);
  cookieStore.delete(REFRESH_COOKIE);
}

export async function countActiveSessions(userId: string) {
  return prisma.deviceSession.count({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
  });
}

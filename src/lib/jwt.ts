/**
 * Edge-safe JWT helpers.
 *
 * This module is imported by `middleware.ts`, which runs on the Edge runtime,
 * so it must not touch `node:crypto` or anything marked `server-only`.
 * `jose` uses WebCrypto and works in both runtimes.
 */
import { SignJWT, jwtVerify } from 'jose';

import type { Role } from '@/lib/roles';

export const ACCESS_TOKEN_TTL_SECONDS = 20 * 60; // deliberately short-lived
export const ACCESS_COOKIE = 'sq_at';
export const REFRESH_COOKIE = 'sq_rt';
export const DEVICE_COOKIE = 'sq_did';
export const CSRF_COOKIE = 'sq_csrf';

export interface AccessTokenClaims {
  sub: string; // user id
  sid: string; // DeviceSession id — lets us revoke server-side
  role: Role;
  dev: string; // first 16 chars of the device hash, for fast mismatch detection
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET is missing or too short.');
    }
    return new TextEncoder().encode('securequiz-development-only-auth-secret-000001');
  }
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ role: claims.role, sid: claims.sid, dev: claims.dev })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('securequiz')
    .setAudience('securequiz-app')
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: 'securequiz',
      audience: 'securequiz-app',
      algorithms: ['HS256'],
    });
    if (!payload.sub || typeof payload.sid !== 'string' || typeof payload.role !== 'string') {
      return null;
    }
    return {
      sub: payload.sub,
      sid: payload.sid,
      role: payload.role as Role,
      dev: typeof payload.dev === 'string' ? payload.dev : '',
    };
  } catch {
    return null;
  }
}

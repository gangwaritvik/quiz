import 'server-only';

import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

function requireSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${name} is missing or shorter than 32 characters. Refusing to start with an insecure secret.`,
    );
  }
  return devFallback;
}

export const AUTH_SECRET = requireSecret(
  'AUTH_SECRET',
  'securequiz-development-only-auth-secret-000001',
);

const HASH_PEPPER = requireSecret(
  'HASH_PEPPER',
  'securequiz-development-only-hash-pepper-000002',
);

/** Deterministic keyed digest — used for IPs and device fingerprints so that
 *  the raw identifiers are never stored, but repeat values still correlate. */
export function keyedHash(value: string): string {
  return createHmac('sha256', HASH_PEPPER).update(value).digest('hex');
}

/** Plain SHA-256, for opaque tokens we generated ourselves (already high entropy). */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Cryptographically uniform 6-digit code — `Math.random()` is not acceptable here. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** scrypt with a per-value random salt: `salt:derivedKey`, both hex. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(`${secret}${HASH_PEPPER}`, salt, 32);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  try {
    const derived = await scrypt(`${secret}${HASH_PEPPER}`, Buffer.from(saltHex, 'hex'), 32);
    const expected = Buffer.from(keyHex, 'hex');
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

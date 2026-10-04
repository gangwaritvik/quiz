import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

// Test-only secrets, set before the module reads them at import time.
const env = process.env as Record<string, string | undefined>;
env.AUTH_SECRET = 'test-only-auth-secret-0123456789abcdef-xxxx';
env.HASH_PEPPER = 'test-only-hash-pepper-0123456789abcdef-yyy';

type CryptoModule = typeof import('@/lib/crypto');
const CRYPTO_PATH = require.resolve('../../src/lib/crypto.ts');
/** Fresh evaluation of crypto.ts (it reads env once, at import). */
function loadCrypto(): CryptoModule {
  delete require.cache[CRYPTO_PATH];
  // A fresh evaluation each time is the point, which an import cannot give.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../src/lib/crypto.ts') as CryptoModule;
}

const { constantTimeEquals, generateOtpCode, hashSecret, keyedHash, randomToken, sha256, verifySecret } =
  loadCrypto();

describe('generateOtpCode', () => {
  test('is always exactly 6 digits (zero padded)', () => {
    for (let i = 0; i < 300; i += 1) assert.match(generateOtpCode(), /^\d{6}$/);
  });
  test('is not constant', () => {
    assert.ok(new Set(Array.from({ length: 20 }, generateOtpCode)).size > 1);
  });
});

describe('hashSecret / verifySecret', () => {
  test('round-trips the right code and rejects a wrong one', async () => {
    const stored = await hashSecret('123456');
    assert.equal(await verifySecret('123456', stored), true);
    assert.equal(await verifySecret('123457', stored), false);
    assert.equal(await verifySecret('', stored), false);
    assert.equal(await verifySecret('123456 ', stored), false);
  });
  test('stored form is salt:key in hex and never contains the secret', async () => {
    const stored = await hashSecret('654321');
    assert.match(stored, /^[0-9a-f]{32}:[0-9a-f]{64}$/);
    assert.ok(!stored.includes('654321'));
  });
  test('per-value random salt: same secret hashes differently each time but both verify', async () => {
    const a = await hashSecret('111111');
    const b = await hashSecret('111111');
    assert.notEqual(a, b);
    assert.equal(await verifySecret('111111', a), true);
    assert.equal(await verifySecret('111111', b), true);
  });
  test('malformed stored values fail closed instead of throwing', async () => {
    for (const bad of ['', 'nocolon', ':', 'abc:', ':abc', 'zz:zz', 'aa:bb']) {
      assert.equal(await verifySecret('123456', bad), false, bad);
    }
  });
  test('a truncated stored key does not verify', async () => {
    const stored = await hashSecret('123456');
    assert.equal(await verifySecret('123456', stored.slice(0, -2)), false);
  });
});

describe('digests and tokens', () => {
  test('sha256 matches the known vector', () => {
    assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  test('keyedHash is deterministic, keyed (differs from plain sha256) and input-sensitive', () => {
    assert.equal(keyedHash('10.0.0.1'), keyedHash('10.0.0.1'));
    assert.notEqual(keyedHash('10.0.0.1'), keyedHash('10.0.0.2'));
    assert.notEqual(keyedHash('10.0.0.1'), sha256('10.0.0.1'));
    assert.match(keyedHash('x'), /^[0-9a-f]{64}$/);
  });
  test('randomToken is url-safe, sized by bytes and unique', () => {
    const a = randomToken();
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a, randomToken());
    assert.equal(randomToken(16).length, 22);
  });
});

describe('constantTimeEquals', () => {
  test('equal strings match; different content or length does not (and never throws)', () => {
    assert.equal(constantTimeEquals('secret', 'secret'), true);
    assert.equal(constantTimeEquals('secret', 'secreT'), false);
    assert.equal(constantTimeEquals('secret', 'secrets'), false);
    assert.equal(constantTimeEquals('', ''), true);
    assert.equal(constantTimeEquals('é', 'e'), false);
  });
});

describe('secret configuration', () => {
  test('production refuses a missing or short secret at import time', () => {
    const saved = { NODE_ENV: env.NODE_ENV, AUTH_SECRET: env.AUTH_SECRET };
    try {
      env.NODE_ENV = 'production';
      env.AUTH_SECRET = 'too-short';
      assert.throws(loadCrypto, /AUTH_SECRET is missing or shorter than 32/);
      delete env.AUTH_SECRET;
      assert.throws(loadCrypto, /AUTH_SECRET is missing or shorter than 32/);
    } finally {
      env.NODE_ENV = saved.NODE_ENV;
      env.AUTH_SECRET = saved.AUTH_SECRET;
    }
  });
  test('outside production a missing secret falls back to a dev default', () => {
    const saved = { NODE_ENV: env.NODE_ENV, AUTH_SECRET: env.AUTH_SECRET };
    try {
      env.NODE_ENV = 'development';
      delete env.AUTH_SECRET;
      const mod = loadCrypto();
      assert.ok(mod.AUTH_SECRET.length >= 32);
    } finally {
      env.NODE_ENV = saved.NODE_ENV;
      env.AUTH_SECRET = saved.AUTH_SECRET;
    }
  });
});

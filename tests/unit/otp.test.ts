import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

const env = process.env as Record<string, string | undefined>;
const ACK = 'i-understand-this-is-insecure';
const KEYS = ['NODE_ENV', 'OTP_DEV_MODE', 'OTP_DEV_MODE_ALLOW_IN_PRODUCTION', 'AUTH_SECRET', 'HASH_PEPPER'];
const OTP_PATH = require.resolve('../../src/lib/otp.ts');
const saved = Object.fromEntries(KEYS.map((k) => [k, env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});

/**
 * otp.ts captures NODE_ENV once at import, so each NODE_ENV needs its own
 * module instance (evicted from require.cache before each load). The module has
 * no side effects beyond constructing a lazy Prisma client: nothing connects.
 */
function load(nodeEnv: 'production' | 'development') {
  env.NODE_ENV = nodeEnv;
  env.AUTH_SECRET = 'test-only-auth-secret-0123456789abcdef-xxxx';
  env.HASH_PEPPER = 'test-only-hash-pepper-0123456789abcdef-yyy';
  delete require.cache[OTP_PATH];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../src/lib/otp.ts') as typeof import('@/lib/otp');
}

function setFlags(devMode: string | undefined, hatch: string | undefined) {
  if (devMode === undefined) delete env.OTP_DEV_MODE;
  else env.OTP_DEV_MODE = devMode;
  if (hatch === undefined) delete env.OTP_DEV_MODE_ALLOW_IN_PRODUCTION;
  else env.OTP_DEV_MODE_ALLOW_IN_PRODUCTION = hatch;
}

describe('isDevOtpMode truth table', () => {
  // [OTP_DEV_MODE, OTP_DEV_MODE_ALLOW_IN_PRODUCTION, production?, dev OTP on?]
  const rows: Array<[string | undefined, string | undefined, boolean, boolean]> = [
    // production: only true + exact hatch enables it
    [undefined, undefined, true, false],
    [undefined, ACK, true, false],
    ['false', undefined, true, false],
    ['false', ACK, true, false],
    ['true', undefined, true, false],
    ['true', 'yes', true, false],
    ['true', ACK.toUpperCase(), true, false],
    ['true', '', true, false],
    ['true', ACK, true, true],
    // development: only the explicit opt-in enables it, hatch irrelevant
    [undefined, undefined, false, false],
    [undefined, ACK, false, false],
    ['false', undefined, false, false],
    ['false', ACK, false, false],
    ['true', undefined, false, true],
    ['true', ACK, false, true],
    // anything but the exact string "true" is off
    ['TRUE', undefined, false, false],
    ['1', undefined, false, false],
    ['yes', undefined, false, false],
    ['', undefined, false, false],
  ];

  for (const [devMode, hatch, production, expected] of rows) {
    test(`${production ? 'production' : 'development'}: OTP_DEV_MODE=${JSON.stringify(devMode)} hatch=${JSON.stringify(hatch)} -> ${expected ? 'ON' : 'OFF'}`, async (t) => {
      t.mock.method(console, 'warn', () => {});
      const mod = load(production ? 'production' : 'development');
      setFlags(devMode, hatch);
      assert.equal(mod.isDevOtpMode(), expected);
    });
  }

  test('is evaluated per call: flipping the flag at runtime takes effect', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const mod = load('production');
    setFlags('true', ACK);
    assert.equal(mod.isDevOtpMode(), true);
    setFlags(undefined, ACK);
    assert.equal(mod.isDevOtpMode(), false);
  });

  test('production with the hatch warns loudly, once', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const mod = load('production');
    setFlags('true', ACK);
    mod.isDevOtpMode();
    mod.isDevOtpMode();
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0]!.arguments[0]), /WARNING.*development OTP mode/i);
  });

  test('plain development mode does not warn', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const mod = load('development');
    setFlags('true', undefined);
    mod.isDevOtpMode();
    assert.equal(warn.mock.callCount(), 0);
  });
});

describe('otp constants', () => {
  test('lifetime, cooldown and attempt cap are sane', async () => {
    const mod = load('development');
    assert.ok(mod.OTP_TTL_SECONDS <= 600);
    assert.ok(mod.OTP_MAX_ATTEMPTS <= 5);
    assert.ok(mod.OTP_RESEND_COOLDOWN_SECONDS > 0);
  });
});

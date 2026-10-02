// `npm run test:e2e` orchestrator. Built-ins only. Spins up a throwaway Postgres DB + the
// production build on :3001, runs tests/e2e/e2e.mjs, then tears down what it started.
// Never touches the .env database or the server on :3000. Exit code = E2E exit code
// (2 = precondition failed: unsafe DB, stale/missing build, port busy, setup error).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const PORT = 3001;
const BASE = `http://localhost:${PORT}`;
const TEST_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://securequiz@localhost:5433/securequiz_e2e';
const PG_BIN = process.env.PG_BIN ?? 'C:/Program Files/PostgreSQL/18/bin';
const PG_DATA = join(tmpdir(), 'sq-staging-pg');
const exe = (n) => join(PG_BIN, process.platform === 'win32' ? `${n}.exe` : n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => { console.error(`[e2e] ${msg}`); process.exit(2); };
const say = (msg) => console.log(`[e2e] ${msg}`);

// host:port/db, with loopback aliases and the default port normalised
const ident = (url) => {
  const u = new URL(url);
  const host = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname) ? 'localhost' : u.hostname;
  return `${host}:${u.port || '5432'}/${decodeURIComponent(u.pathname.slice(1))}`;
};
const listening = (port) => new Promise((ok) => {
  const s = createConnection({ port, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); ok(true); }).once('error', () => ok(false));
});

// ---- (a) safety: the target DB must not be the .env one ---------------------------------
const test = new URL(TEST_URL);
const dbName = decodeURIComponent(test.pathname.slice(1));
if (!/^\w+_e2e$/.test(dbName)) die(`refusing: test database name "${dbName}" must match *_e2e`);
const envFile = join(ROOT, '.env');
const envLine = existsSync(envFile) && readFileSync(envFile, 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.+)$/m);
if (envLine) {
  let main;
  try { main = ident(envLine[1].trim().replace(/^["']|["']$/g, '')); } catch { die('refusing: cannot parse .env DATABASE_URL, so cannot prove the test DB differs'); }
  if (main === ident(TEST_URL)) die('refusing: test database is the same as .env DATABASE_URL');
}

// ---- build freshness (production build, so the user's :3000 .next is only read) ----------
const buildId = join(ROOT, '.next', 'BUILD_ID');
const newest = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((m, e) => {
  const p = join(dir, e.name);
  return Math.max(m, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
}, 0);
if (!existsSync(buildId) || statSync(buildId).mtimeMs < newest(join(ROOT, 'src'))) die('Run npm run build first');
if (await listening(PORT)) die(`port ${PORT} is already in use; not touching it`);

const dbEnv = { ...process.env, DATABASE_URL: TEST_URL };
const tmpUploads = mkdtempSync(join(tmpdir(), 'sq-e2e-uploads-'));
let server, pgStartedByUs = false, cleaned = false, e2e;

const psql = (sql) => spawnSync(exe('psql'), ['-h', test.hostname, '-p', test.port || '5432', '-U', decodeURIComponent(test.username) || 'securequiz', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
const step = (name, cmd, args, env = dbEnv) => {
  say(name);
  const r = spawnSync(cmd, args, { cwd: ROOT, env, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${name} failed (exit ${r.status})`);
};

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  e2e?.kill();
  if (server?.pid && server.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F']);
    else server.kill();
  }
  rmSync(tmpUploads, { recursive: true, force: true });
  if (pgStartedByUs) spawnSync(exe('pg_ctl'), ['-D', PG_DATA, '-m', 'fast', 'stop']);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => cleanup().then(() => process.exit(130)));

let code = 2;
try {
  // ---- (b) Postgres + fresh database ----------------------------------------------------
  const pgPort = Number(test.port || 5432);
  if (!(await listening(pgPort))) {
    if (!['localhost', '127.0.0.1'].includes(test.hostname)) throw new Error(`nothing listening on ${test.host} and it is not local`);
    say(`starting disposable Postgres on :${pgPort}`);
    const r = spawnSync(exe('pg_ctl'), ['-D', PG_DATA, '-o', `-p ${pgPort}`, '-l', `${PG_DATA}.log`, '-w', 'start'], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('could not start Postgres (set PG_BIN, or start one yourself)');
    pgStartedByUs = true;
  }
  for (const sql of [`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`, `CREATE DATABASE ${dbName}`]) {
    const r = psql(sql);
    if (r.status !== 0) throw new Error(`psql failed: ${r.stderr || r.error}`);
  }

  // ---- (c) schema + seed (DATABASE_URL set only in these child envs) --------------------
  step('prisma migrate deploy', process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  step('seed', process.execPath, ['node_modules/tsx/dist/cli.mjs', 'prisma/seed.ts']);

  // ---- (d) production server on :3001 ---------------------------------------------------
  say(`starting next start on :${PORT}`);
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...dbEnv, NODE_ENV: 'production', UPLOAD_DIR: tmpUploads, OTP_DEV_MODE: 'true', OTP_DEV_MODE_ALLOW_IN_PRODUCTION: 'i-understand-this-is-insecure' },
  });
  for (let i = 0; ; i += 1) {
    if (server.exitCode !== null) throw new Error(`next start exited early (code ${server.exitCode})`);
    if (await fetch(`${BASE}/login`).then((r) => r.status === 200, () => false)) break;
    if (i >= 60) throw new Error('server did not return 200 on /login within 60 s');
    await sleep(1000);
  }

  // ---- (e) the E2E ----------------------------------------------------------------------
  say('running tests/e2e/e2e.mjs (takes ~3 min: OTP cooldown + post-submit wait)');
  e2e = spawn(process.execPath, ['tests/e2e/e2e.mjs'], { cwd: ROOT, stdio: 'inherit', env: { ...dbEnv, BASE } });
  code = await new Promise((ok) => e2e.once('exit', (c) => ok(c ?? 1)));
} catch (e) {
  console.error(`[e2e] ${e.message}`);
} finally {
  await cleanup();  // (f)
}
process.exit(code);

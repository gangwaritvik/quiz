// Simulated exam load against the staging server. Built-in fetch only.
// Usage: node scripts/loadtest/run.mjs <sessions.json> [durationSec=300] [serverPid]
// Client intervals mirror src/components/exam/exam-client.tsx (heartbeat 20 s,
// text-save debounce 800 ms) and src/hooks/use-exam-security.ts (event flush 8 s).
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3001';
const [file, durArg, pidArg] = process.argv.slice(2);
const { quizId, sessions } = JSON.parse(readFileSync(file, 'utf8'));
const DURATION = Number(durArg ?? 300) * 1000;
const HEARTBEAT_MS = 20_000, FLUSH_MS = 8_000, START_SPREAD_MS = 60_000;
const SUBMIT_WINDOW_MS = 30_000; // everyone submits in the last 30 s

const stats = new Map(); // route -> { lat: [], codes: {} }
const rec = (route, ms, code) => {
  const s = stats.get(route) ?? { lat: [], codes: {} };
  s.lat.push(ms); s.codes[code] = (s.codes[code] ?? 0) + 1; stats.set(route, s);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const until = t0 + DURATION;

async function call(sess, route, method, path, body) {
  const t = performance.now();
  let code;
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        cookie: sess.cookie, 'x-device-id': sess.deviceId, origin: BASE,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130 loadtest',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    code = res.status;
    const json = await res.json().catch(() => null);
    rec(route, performance.now() - t, code);
    if (code >= 400 && !firstErr[route + code]) firstErr[route + code] = json?.error?.message ?? String(code);
    return json?.data;
  } catch (e) {
    rec(route, performance.now() - t, e.name === 'TimeoutError' ? 'timeout' : 'neterr');
    return null;
  }
}
const firstErr = {};

const EVENT_TYPES = ['WINDOW_BLUR', 'WINDOW_FOCUS', 'TAB_SWITCH', 'FULLSCREEN_EXIT', 'FULLSCREEN_ENTER', 'COPY_ATTEMPT'];

async function student(sess) {
  await sleep(Math.random() * START_SPREAD_MS);
  const start = await call(sess, 'start', 'POST', '/api/exam/start', { quizId, acknowledgedRules: true, checks: { fullscreenSupported: true } });
  if (!start) return;
  const id = start.attemptId;
  const state = await call(sess, 'state', 'GET', `/api/exam/${id}/state`);
  if (!state) return;
  const qs = state.questions;
  const submitAt = until - Math.random() * SUBMIT_WINDOW_MS;

  let nextBeat = Date.now() + HEARTBEAT_MS, nextFlush = Date.now() + FLUSH_MS;
  // Answer behaviour: choose MCQ + short answer early, then type the essay in
  // bursts — the 800 ms debounce yields a save every ~2-6 s while typing.
  let nextSave = Date.now() + 5_000 + Math.random() * 20_000, saveIdx = 0, essay = '';
  const loops = [];
  while (Date.now() < submitAt) {
    const now = Date.now();
    if (now >= nextBeat) { nextBeat += HEARTBEAT_MS; loops.push(call(sess, 'heartbeat', 'POST', `/api/exam/${id}/heartbeat`, {})); }
    if (now >= nextFlush) {
      nextFlush += FLUSH_MS;
      if (Math.random() < 0.25) {
        const events = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({
          type: EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)], clientTimestamp: new Date().toISOString(),
        }));
        loops.push(call(sess, 'events', 'POST', `/api/exam/${id}/events`, { events }));
      }
    }
    if (now >= nextSave) {
      const q = qs[Math.min(saveIdx, qs.length - 1)];
      let body;
      if (q.type === 'MCQ_SINGLE') body = { attemptQuestionId: q.attemptQuestionId, selectedOptionId: q.options[Math.floor(Math.random() * q.options.length)].id };
      else if (q.type === 'SHORT_ANSWER') body = { attemptQuestionId: q.attemptQuestionId, textResponse: '80' };
      else { essay += 'The client sends SYN and the server answers SYN-ACK. '; body = { attemptQuestionId: q.attemptQuestionId, textResponse: essay.slice(0, 5000) }; }
      saveIdx += 1;
      // Typing burst: next save in 2-6 s; occasionally a long thinking pause.
      nextSave = now + (Math.random() < 0.1 ? 20_000 + Math.random() * 40_000 : 2_000 + Math.random() * 4_000);
      loops.push(call(sess, 'answer', 'POST', `/api/exam/${id}/answer`, body));
    }
    await sleep(250);
  }
  await Promise.all(loops);
  await call(sess, 'submit', 'POST', `/api/exam/${id}/submit`, { confirm: true });
}

// --- resource sampling -------------------------------------------------------
const samples = [];
const PSQL = 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
const run = (cmd, args) => new Promise((r) => execFile(cmd, args, { timeout: 4000 }, (e, out) => r(e ? '' : out)));
const sampler = setInterval(async () => {
  const [mem, conns] = await Promise.all([
    pidArg ? run('tasklist', ['/FI', `PID eq ${pidArg}`, '/FO', 'CSV', '/NH']) : '',
    run(PSQL, ['-h', 'localhost', '-p', '5433', '-U', 'securequiz', '-d', 'postgres', '-At', '-c',
      "select count(*) from pg_stat_activity where datname='securequiz_staging'"]),
  ]);
  const m = mem.match(/"([\d,.]+) K"/);
  samples.push({ t: Math.round((Date.now() - t0) / 1000), rssMB: m ? Math.round(Number(m[1].replace(/[,.]/g, '')) / 1024) : null, pg: Number(conns.trim()) || null });
}, 5000);

await Promise.all(sessions.map(student));
clearInterval(sampler);

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
let total = 0, errs = 0, r429 = 0;
console.log(`N=${sessions.length} duration=${Math.round((Date.now() - t0) / 1000)}s`);
console.log('route      count   p50ms   p95ms   p99ms   maxms  err%   codes');
for (const [route, s] of stats) {
  const a = [...s.lat].sort((x, y) => x - y);
  const bad = Object.entries(s.codes).filter(([c]) => !(c >= 200 && c < 300)).reduce((n, [, v]) => n + v, 0);
  total += a.length; errs += bad; r429 += s.codes[429] ?? 0;
  console.log(`${route.padEnd(10)} ${String(a.length).padStart(5)} ${[50, 95, 99].map((p) => pct(a, p).toFixed(0).padStart(7)).join(' ')} ${a.at(-1).toFixed(0).padStart(7)} ${(100 * bad / a.length).toFixed(1).padStart(5)}   ${JSON.stringify(s.codes)}`);
}
console.log(`total=${total} errors=${errs} (${(100 * errs / total).toFixed(2)}%) http429=${r429}`);
console.log('first errors:', JSON.stringify(firstErr));
const rss = samples.map((s) => s.rssMB).filter(Boolean), pg = samples.map((s) => s.pg).filter(Boolean);
console.log(`server RSS MB min/max: ${Math.min(...rss)}/${Math.max(...rss)}  pg conns max: ${Math.max(...pg)}  samples=${samples.length}`);
console.log('timeline (t s: rssMB/pg):', samples.filter((_, i) => i % 6 === 0).map((s) => `${s.t}:${s.rssMB}/${s.pg}`).join(' '));

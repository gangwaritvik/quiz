// E2E + abuse cases against a running server (default :3001) backed by the throwaway
// securequiz_e2e DB. Run via `npm run test:e2e` (tests/e2e/run.mjs sets everything up).
// Exits 1 if any check FAILs. Needs DATABASE_URL (the test DB) for direct DB assertions.
import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE ?? 'http://localhost:3001';
const rows = [];
const log = (s) => rows.push(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function client(name, deviceId) {
  const jar = new Map();
  const call = async (step, method, path, body, { expect, raw, headers: extra } = {}) => {
    const headers = {
      'x-device-id': deviceId,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130 e2e',
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...extra,
    };
    if (method !== 'GET') headers.origin = BASE;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, redirect: 'manual', body: payload });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    const err = json && json.ok === false ? `${json.error.code}: ${json.error.message}` : '';
    const verdict = expect ? (expect.includes(res.status) ? 'PASS' : 'FAIL') : '    ';
    log(`${verdict} ${name.padEnd(8)} ${step.padEnd(52)} ${method.padEnd(6)} ${res.status} ${err}`.trimEnd());
    return { status: res.status, json, data: json?.data, text };
  };
  call.jar = jar;
  return call;
}
const check = (label, cond, detail = '') => log(`${cond ? 'PASS' : 'FAIL'} check    ${label} ${detail}`);

async function login(call, identifier) {
  const r = await call(`otp request ${identifier}`, 'POST', '/api/auth/otp/request', { identifier }, { expect: [200] });
  const code = r.data?.devCode;
  if (!code) throw new Error('no devCode returned: ' + r.text);
  check('otp response has no maskedDestination', !('maskedDestination' in r.data));
  await call('otp verify', 'POST', '/api/auth/otp/verify', { identifier, code }, { expect: [200] });
}

const prisma = new PrismaClient();
let ids = {};
try {
const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
if (!db.endsWith('_e2e')) throw new Error(`refusing: ${db} is not a *_e2e DB`);

const fac = client('faculty', 'e2e-fac-device-0001');
const fac2 = client('faculty2', 'e2e-fac-device-0002');
const stu = client('student', 'e2e-stu-device-0001');

await login(fac, 'anita.raghavan@college.edu');
await login(fac2, 'sanjay.menon@college.edu');
const meta = (await fac('admin meta', 'GET', '/api/admin/meta', undefined, { expect: [200] })).data;
const subjectId = meta.subjects[0].id;
const studentList = (await fac('admin students list', 'GET', '/api/admin/students?pageSize=100', undefined, { expect: [200] })).data.students;
const sid = (roll) => studentList.find((s) => s.rollNumber === roll).id;
const fac2Students = await fac2('faculty2 student directory', 'GET', '/api/admin/students?pageSize=5', undefined, { expect: [200] });
check('faculty2 sees student directory', fac2Students.data?.students?.length > 0);

const paper = [
  { text: 'What does TCP stand for?', type: 'MCQ_SINGLE', marks: 2, options: [
    { text: 'Transmission Control Protocol', isCorrect: true }, { text: 'Trivial Copy Protocol', isCorrect: false },
    { text: 'Transfer Control Packet', isCorrect: false }] },
  { text: 'Default HTTP port number?', type: 'SHORT_ANSWER', marks: 1, acceptedAnswers: ['80'] },
  { text: 'Explain the three-way handshake.', type: 'LONG_ANSWER', marks: 5, maxWords: 200, modelAnswer: 'SYN, SYN-ACK, ACK' },
  { text: 'Photograph your diagram of a TCP header.', type: 'IMAGE_ANSWER', marks: 2, maxAttachments: 2 },
];
const mkQuiz = async (title, students) => {
  const now = Date.now();
  const r = await fac(`create quiz "${title}"`, 'POST', '/api/admin/quizzes', {
    title: `${title} ${new Date(now).toISOString()}`, subjectId, durationMinutes: 30, sourceMode: 'FIXED',
    startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 3 * 3600_000).toISOString(),
    status: 'DRAFT', security: { releaseResults: true, releaseAnswers: false }, questions: paper,
  }, { expect: [200] });
  const quizId = r.data.quizId;
  await fac('publish', 'PATCH', `/api/admin/quizzes/${quizId}`, { status: 'PUBLISHED' }, { expect: [200] });
  await fac('assign', 'POST', `/api/admin/quizzes/${quizId}/assign`, { studentIds: students.map(sid) }, { expect: [200] });
  return quizId;
};
const quizId = await mkQuiz('E2E main', ['23CSE001']);

// ---------------- student main flow ----------------
await login(stu, '23CSE001');
const list = (await stu('list quizzes', 'GET', '/api/student/quizzes', undefined, { expect: [200] })).data;
check('quiz visible in student list', list.quizzes.some((q) => q.id === quizId));
const start = await stu('start attempt', 'POST', '/api/exam/start', { quizId, acknowledgedRules: true, checks: { fullscreenSupported: true } }, { expect: [200] });
const attemptId = start.data.attemptId;
const state = (await stu('fetch state', 'GET', `/api/exam/${attemptId}/state`, undefined, { expect: [200] })).data;
const byType = Object.fromEntries(state.questions.map((q) => [q.type, q]));
check('state has no isCorrect/modelAnswer', !JSON.stringify(state).includes('isCorrect') && !JSON.stringify(state).includes('SYN-ACK'));
const mcq = byType.MCQ_SINGLE;
await stu('save MCQ', 'POST', `/api/exam/${attemptId}/answer`, { attemptQuestionId: mcq.attemptQuestionId, selectedOptionId: mcq.options.find((o) => o.text.startsWith('Transmission')).id }, { expect: [200] });
await stu('save short', 'POST', `/api/exam/${attemptId}/answer`, { attemptQuestionId: byType.SHORT_ANSWER.attemptQuestionId, textResponse: '80' }, { expect: [200] });
await stu('save long', 'POST', `/api/exam/${attemptId}/answer`, { attemptQuestionId: byType.LONG_ANSWER.attemptQuestionId, textResponse: 'SYN then SYN-ACK then ACK.' }, { expect: [200] });
const fd = new FormData();
fd.set('attemptQuestionId', byType.IMAGE_ANSWER.attemptQuestionId);
fd.set('file', new Blob([PNG], { type: 'image/png' }), 'diagram.png');
const up = await stu('upload answer image (1x1 png)', 'POST', `/api/exam/${attemptId}/attachments`, undefined, { raw: fd, expect: [200] });
const big = Buffer.alloc(7 * 1024 * 1024, 0x41);
await stu('(e) upload 7 MB body', 'POST', `/api/exam/${attemptId}/attachments`, undefined, { raw: big, headers: { 'content-type': 'multipart/form-data; boundary=x' }, expect: [413] });
await stu('events batch', 'POST', `/api/exam/${attemptId}/events`, { events: [
  { type: 'WINDOW_BLUR', clientTimestamp: new Date().toISOString() }, { type: 'TAB_SWITCH', durationMs: 4200 }, { type: 'FULLSCREEN_EXIT' }] }, { expect: [200] });
const pad = 'x'.repeat(190);
const bigEvents = { events: Array.from({ length: 25 }, () => ({ type: 'WINDOW_FOCUS', metadata: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, pad + 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'.repeat(0)])) })) };
const bigBody = JSON.stringify({ events: bigEvents.events.map((e) => ({ ...e, metadata: Object.fromEntries(Object.keys(e.metadata).map((k) => [k, 'z'.repeat(290)])) })) });
log(`     info     70KB-test body bytes=${bigBody.length}`);
await stu('(e) events body ~75 KB', 'POST', `/api/exam/${attemptId}/events`, undefined, { raw: bigBody, headers: { 'content-type': 'application/json' }, expect: [413] });
await stu('(e) events metadata 11 keys', 'POST', `/api/exam/${attemptId}/events`, { events: [{ type: 'WINDOW_FOCUS', metadata: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v'])) }] }, { expect: [422] });
await stu('(e) events metadata 201-char string', 'POST', `/api/exam/${attemptId}/events`, { events: [{ type: 'WINDOW_FOCUS', metadata: { k: 'v'.repeat(201) } }] }, { expect: [422] });
await stu('client sends MULTIPLE_SESSION', 'POST', `/api/exam/${attemptId}/events`, { events: [{ type: 'MULTIPLE_SESSION' }] }, { expect: [422] });
await stu('heartbeat', 'POST', `/api/exam/${attemptId}/heartbeat`, {}, { expect: [200] });
await stu('flag', 'POST', `/api/exam/${attemptId}/flag`, { attemptQuestionId: mcq.attemptQuestionId, markedForReview: true }, { expect: [200] });
const sub = await stu('submit', 'POST', `/api/exam/${attemptId}/submit`, { confirm: true }, { expect: [200] });
log(`     info     submit body ${JSON.stringify(sub.data)}`);
const submittedAt = Date.now();

// (a) result hidden while the window is open
const r1 = await stu('(a) result right after submit', 'GET', `/api/results/${attemptId}`, undefined, { expect: [200] });
check('(a) released:false with releasesAt', r1.data?.released === false && Boolean(r1.data?.releasesAt), JSON.stringify({ released: r1.data?.released, releasesAt: r1.data?.releasesAt }));
const dash = await stu('(a) dashboard', 'GET', '/api/student/dashboard', undefined, { expect: [200] });
const hist = await stu('(a) history', 'GET', '/api/student/history', undefined, { expect: [200] });
check('(a) history has awaitingMarking field', JSON.stringify(hist.data).includes('awaitingMarking'));
const histItem = JSON.stringify(hist.data).includes(attemptId) ? JSON.stringify(hist.data).slice(JSON.stringify(hist.data).indexOf(attemptId) - 20, JSON.stringify(hist.data).indexOf(attemptId) + 400) : 'not listed';
log(`     info     history entry: ${histItem.slice(0, 300)}`);
check('(a) dashboard does not show score for this attempt', !/"score":\s*\d/.test(JSON.stringify(dash.data).slice(JSON.stringify(dash.data).indexOf(attemptId), JSON.stringify(dash.data).indexOf(attemptId) + 300)) || !JSON.stringify(dash.data).includes(attemptId));

// abuse cases
const abuse = { expect: [400, 401, 403, 404, 409, 410, 422, 429] };
await stu('ABUSE answer after submit', 'POST', `/api/exam/${attemptId}/answer`, { attemptQuestionId: mcq.attemptQuestionId, selectedOptionId: mcq.options[1].id }, abuse);
await stu('ABUSE heartbeat after submit', 'POST', `/api/exam/${attemptId}/heartbeat`, {}, abuse);
await stu('ABUSE second attempt', 'POST', '/api/exam/start', { quizId, acknowledgedRules: true }, abuse);
const other = await prisma.quizAttempt.findFirst({ where: { student: { rollNumber: { not: '23CSE001' } }, status: { not: 'IN_PROGRESS' } }, select: { id: true } });
await stu('ABUSE other student result', 'GET', `/api/results/${other.id}`, undefined, abuse);
await stu('ABUSE other attempt state', 'GET', `/api/exam/${other.id}/state`, undefined, abuse);
await stu('ABUSE events on other attempt', 'POST', `/api/exam/${other.id}/events`, { events: [{ type: 'WINDOW_FOCUS' }] }, abuse);
await stu('ABUSE GET /api/admin/results', 'GET', '/api/admin/results', undefined, abuse);
await stu('ABUSE PATCH quiz release', 'PATCH', `/api/admin/quizzes/${quizId}`, { security: { releaseAnswers: true } }, abuse);
await stu('ABUSE release-device', 'POST', `/api/admin/attempts/${attemptId}/release-device`, {}, abuse);

// faculty marking
const ans = await prisma.answer.findFirst({ where: { attemptId, attemptQuestion: { question: { type: 'LONG_ANSWER' } } }, select: { id: true } });
const imgAns = await prisma.answer.findFirst({ where: { attemptId, attemptQuestion: { question: { type: 'IMAGE_ANSWER' } } }, select: { id: true, attachments: { select: { assetId: true } } } });
const assetId = imgAns?.attachments[0]?.assetId;
await fac('grading queue', 'GET', `/api/admin/grading?quizId=${quizId}`, undefined, { expect: [200] });
await fac('open attempt for marking', 'GET', `/api/admin/grading/${attemptId}`, undefined, { expect: [200] });
await fac('mark long answer 4/5', 'POST', `/api/admin/grading/answers/${ans.id}`, { awardedMarks: 4, note: 'Good' }, { expect: [200] });
await fac('mark image answer 2/2', 'POST', `/api/admin/grading/answers/${imgAns.id}`, { awardedMarks: 2 }, { expect: [200] });
await fac('over-mark 99/5', 'POST', `/api/admin/grading/answers/${ans.id}`, { awardedMarks: 99 }, { expect: [422] });
await fac('owner views answer image', 'GET', `/api/media/${assetId}`, undefined, { expect: [200] });
await fac('integrity report', 'GET', `/api/admin/integrity/${attemptId}`, undefined, { expect: [200] });

// (b) second faculty
await fac2('(b) quiz detail (not owner)', 'GET', `/api/admin/quizzes/${quizId}`, undefined, { expect: [403] });
await fac2('(b) grading attempt', 'GET', `/api/admin/grading/${attemptId}`, undefined, { expect: [403] });
await fac2('(b) grade answer', 'POST', `/api/admin/grading/answers/${ans.id}`, { awardedMarks: 0 }, { expect: [403] });
await fac2('(b) integrity report', 'GET', `/api/admin/integrity/${attemptId}`, undefined, { expect: [403] });
await fac2('(b) admin result', 'GET', `/api/admin/results/${attemptId}`, undefined, { expect: [403] });
await fac2('(b) answer image', 'GET', `/api/media/${assetId}`, undefined, { expect: [403, 404] });
await fac2('(b) PATCH quiz', 'PATCH', `/api/admin/quizzes/${quizId}`, { security: { releaseAnswers: true } }, { expect: [403] });
const f2q = await fac2('(b) quiz list', 'GET', '/api/admin/quizzes', undefined, { expect: [200] });
check('(b) quiz absent from faculty2 list', !JSON.stringify(f2q.data).includes(quizId));
for (const p of ['/api/admin/results', '/api/admin/integrity', '/api/admin/grading?includeCompleted=true', '/api/admin/live', `/api/admin/search?q=E2E`]) {
  const r = await fac2(`(b) ${p}`, 'GET', p, undefined, { expect: [200] });
  check(`(b) ${p} omits quiz/attempt`, !r.text.includes(quizId) && !r.text.includes(attemptId));
}
const ov1 = (await fac('overview (owner)', 'GET', '/api/admin/overview', undefined, { expect: [200] })).data.stats;
const ov2 = (await fac2('(b) overview', 'GET', '/api/admin/overview', undefined, { expect: [200] })).data.stats;
log(`     info     overview stats owner=${JSON.stringify(ov1)} faculty2=${JSON.stringify(ov2)}`);

// (a) continued: close the window, result becomes visible
const closeEnd = new Date(Date.now() - 1000).toISOString();
await fac('(a) PATCH endsAt = now-1s', 'PATCH', `/api/admin/quizzes/${quizId}`, { startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: closeEnd }, { expect: [200] });
const r2 = await stu('(a) result after window closed', 'GET', `/api/results/${attemptId}`, undefined, { expect: [200] });
const d = r2.data ?? {};
check('(a) result released after window', d.released !== false, `score=${d.score ?? d.attempt?.score} max=${d.maxScore ?? d.attempt?.maxScore} provisional=${d.provisional}`);
const keyFields = new Set(['isCorrect', 'modelAnswer', 'acceptedAnswers', 'explanation']);
const leaked = (v) =>
  Array.isArray(v) ? v.some(leaked) : v && typeof v === 'object' ? Object.entries(v).some(([k, x]) => keyFields.has(k) || leaked(x)) : false;
check('(a) no answer-key fields in result (releaseAnswers=false)', !leaked(r2.data));

// ---------------- (c) release-device, (f) parallel start, (g) parallel submit ----------------
const quiz2 = await mkQuiz('E2E device', ['23CSE002', '23CSE003']);
const s2a = client('stu2-A', 'e2e-stu2-device-A');
const s2b = client('stu2-B', 'e2e-stu2-device-B');
await login(s2a, '23CSE002');
const st2 = await s2a('(c) start on session A', 'POST', '/api/exam/start', { quizId: quiz2, acknowledgedRules: true }, { expect: [200] });
const a2 = st2.data.attemptId;
const q2 = (await s2a('(c) state on A', 'GET', `/api/exam/${a2}/state`, undefined, { expect: [200] })).data.questions.find((q) => q.type === 'SHORT_ANSWER');
await sleep(31_000); // OTP resend cooldown for the same account
await login(s2b, '23CSE002');
await s2b('(c) B saves before release (diff device)', 'POST', `/api/exam/${a2}/answer`, { attemptQuestionId: q2.attemptQuestionId, textResponse: '80' }, { expect: [403, 409] });
await fac2('(c) non-owner release-device', 'POST', `/api/admin/attempts/${a2}/release-device`, {}, { expect: [403] });
const rel = await fac('(c) owner release-device', 'POST', `/api/admin/attempts/${a2}/release-device`, {}, { expect: [200] });
check('(c) sessionBound true', rel.data?.sessionBound === true, JSON.stringify(rel.json));
await s2b('(c) B saves after release', 'POST', `/api/exam/${a2}/answer`, { attemptQuestionId: q2.attemptQuestionId, textResponse: '80' }, { expect: [200] });
await s2a('(c) old session A after release', 'POST', `/api/exam/${a2}/answer`, { attemptQuestionId: q2.attemptQuestionId, textResponse: '81' }, { expect: [403, 409] });
await s2a('(c) old session A heartbeat', 'POST', `/api/exam/${a2}/heartbeat`, {}, { expect: [401, 403, 409] });

const s3 = client('stu3', 'e2e-stu3-device');
await login(s3, '23CSE003');
const [p1, p2] = await Promise.all([1, 2].map((i) => s3(`(f) parallel start #${i}`, 'POST', '/api/exam/start', { quizId: quiz2, acknowledgedRules: true }, { expect: [200] })));
check('(f) same attemptId', p1.data?.attemptId && p1.data.attemptId === p2.data?.attemptId, `${p1.data?.attemptId} / ${p2.data?.attemptId}`);
const a3 = p1.data.attemptId;
const attemptsFor3 = await prisma.quizAttempt.count({ where: { quizId: quiz2, student: { rollNumber: '23CSE003' } } });
check('(f) one attempt row', attemptsFor3 === 1, `rows=${attemptsFor3}`);
const subs = await Promise.all([1, 2, 3].map((i) => s3(`(g) parallel submit #${i}`, 'POST', `/api/exam/${a3}/submit`, { confirm: true }, { expect: [200] })));
log(`     info     (g) statuses ${subs.map((s) => s.data?.status).join(',')}`);
const evs = await prisma.examEvent.groupBy({ by: ['type'], where: { attemptId: a3, type: { in: ['ATTEMPT_SUBMITTED', 'AUTO_SUBMITTED'] } }, _count: { _all: true } });
check('(g) exactly one ATTEMPT_SUBMITTED', evs.length === 1 && evs[0]._count._all === 1 && evs[0].type === 'ATTEMPT_SUBMITTED', JSON.stringify(evs));

// (e) events after the 60 s post-submit window
const wait = Math.max(0, submittedAt + 120_000 - Date.now());
log(`     info     waiting ${Math.round(wait / 1000)} s for post-submit window`);
await sleep(wait);
const before = await prisma.examEvent.count({ where: { attemptId } });
const late = await stu('(e) events 2 min after submit', 'POST', `/api/exam/${attemptId}/events`, { events: [{ type: 'TAB_SWITCH' }] });
const after = await prisma.examEvent.count({ where: { attemptId } });
check('(e) late events not stored', after === before, `status=${late.status} body=${late.text.slice(0, 120)}`);

ids = { quizId, attemptId, quiz2, a2, a3 };
} catch (e) {
  log(`FAIL crash    ${e.stack ?? e}`);
} finally {
  console.log(rows.join('\n'));
  console.log(JSON.stringify(ids));
  await prisma.$disconnect();
  const fails = rows.filter((r) => r.startsWith('FAIL'));
  const passes = rows.filter((r) => r.startsWith('PASS')).length;
  console.log(`\n===== E2E SUMMARY: ${passes} PASS, ${fails.length} FAIL =====`);
  fails.forEach((f) => console.log(f));
  process.exitCode = fails.length ? 1 : 0;
}

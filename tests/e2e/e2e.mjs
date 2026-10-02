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
const mkQuiz = async (title, students, extra = {}) => {
  const now = Date.now();
  const r = await fac(`create quiz "${title}"`, 'POST', '/api/admin/quizzes', {
    title: `${title} ${new Date(now).toISOString()}`, subjectId, durationMinutes: 30, sourceMode: 'FIXED',
    startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 3 * 3600_000).toISOString(),
    status: 'DRAFT', security: { releaseResults: true, releaseAnswers: false }, questions: paper, ...extra,
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

// ---------------- (i) per-student time extensions ----------------
const quiz3 = await mkQuiz('E2E extend', ['23CSE004', '23CSE005', '23CSE006', '23CSE007']);
const ext = `/api/admin/quizzes/${quiz3}/extensions`;
await fac2('(i) non-owner reads extensions', 'GET', ext, undefined, { expect: [403] });
await fac2('(i) non-owner sets extension', 'PUT', ext, { studentId: sid('23CSE004'), minutes: 15 }, { expect: [403] });
const ex0 = await fac('(i) list extensions', 'GET', ext, undefined, { expect: [200] });
check('(i) four assigned, none extended or started', ex0.data?.students?.length === 4 && ex0.data.students.every((s) => s.extraMinutes === 0 && s.started === false), JSON.stringify(ex0.data));
await fac('(i) set 15 min for 23CSE004', 'PUT', ext, { studentId: sid('23CSE004'), minutes: 15 }, { expect: [200] });
await fac('(i) 121 min refused', 'PUT', ext, { studentId: sid('23CSE004'), minutes: 121 }, { expect: [422] });
await fac('(i) unassigned student refused', 'PUT', ext, { studentId: sid('23CSE008'), minutes: 10 }, { expect: [404] });

const s4 = client('stu4', 'e2e-stu4-device');
const s5 = client('stu5', 'e2e-stu5-device');
const s6 = client('stu6', 'e2e-stu6-device');
const s7 = client('stu7', 'e2e-stu7-device');
for (const [c, roll] of [[s4, '23CSE004'], [s5, '23CSE005'], [s6, '23CSE006'], [s7, '23CSE007']]) await login(c, roll);
await s4('(i) student cannot read extensions', 'GET', ext, undefined, abuse);
await s4('(i) student cannot set extensions', 'PUT', ext, { studentId: sid('23CSE004'), minutes: 90 }, abuse);

const brief4 = await s4('(i) briefing carries the extra time', 'GET', `/api/student/quizzes/${quiz3}`, undefined, { expect: [200] });
check('(i) briefing extraMinutes is 15', brief4.data?.extraMinutes === 15, String(brief4.data?.extraMinutes));
const st4 = await s4('(i) start with pre-agreed extra time', 'POST', '/api/exam/start', { quizId: quiz3, acknowledgedRules: true }, { expect: [200] });
const mins4 = (Date.parse(st4.data.expiresAt) - Date.parse(st4.data.serverNow)) / 60_000;
check('(i) clock is 30 + 15 = 45 minutes', mins4 > 44.5 && mins4 <= 45.01, `min=${mins4.toFixed(2)}`);
const stt4 = (await s4('(i) state shows extraMinutes', 'GET', `/api/exam/${st4.data.attemptId}/state`, undefined, { expect: [200] })).data;
check('(i) state extraMinutes is 15', stt4?.extraMinutes === 15);
await fac('(i) setting extra time after the start is refused', 'PUT', ext, { studentId: sid('23CSE004'), minutes: 20 }, { expect: [409] });
const ex1 = await fac('(i) list marks the student as started', 'GET', ext, undefined, { expect: [200] });
check('(i) 23CSE004 shown as started with 15', ex1.data?.students.find((s) => s.rollNumber === '23CSE004')?.started === true && ex1.data.students.find((s) => s.rollNumber === '23CSE004').extraMinutes === 15);

// live grants
const st5 = await s5('(i) start (no pre-agreed time)', 'POST', '/api/exam/start', { quizId: quiz3, acknowledgedRules: true }, { expect: [200] });
const a5 = st5.data.attemptId;
const exp5 = Date.parse(st5.data.expiresAt);
const extendUrl = (id) => `/api/admin/attempts/${id}/extend`;
await s5('(i) student cannot extend', 'POST', extendUrl(a5), { minutes: 10 }, abuse);
await fac2('(i) non-owner cannot extend', 'POST', extendUrl(a5), { minutes: 10 }, { expect: [403] });
await fac('(i) add 0 refused', 'POST', extendUrl(a5), { minutes: 0 }, { expect: [422] });
await fac('(i) add 121 refused', 'POST', extendUrl(a5), { minutes: 121 }, { expect: [422] });
const e1 = await fac('(i) add 10 minutes', 'POST', extendUrl(a5), { minutes: 10 }, { expect: [200] });
check('(i) deadline moved by exactly 10 min', Date.parse(e1.data?.expiresAt) - exp5 === 10 * 60_000 && e1.data.extraMinutes === 10 && e1.data.remainingMs > 0, JSON.stringify(e1.data));
const hb5 = await s5('(i) heartbeat carries the new deadline', 'POST', `/api/exam/${a5}/heartbeat`, {}, { expect: [200] });
check('(i) heartbeat extraMinutes and expiresAt agree', hb5.data?.extraMinutes === 10 && hb5.data.timer.expiresAt === e1.data.expiresAt, JSON.stringify(hb5.data?.timer));
const live5 = await fac('(i) live feed', 'GET', '/api/admin/live', undefined, { expect: [200] });
const row5 = live5.data?.students.find((s) => s.attemptId === a5);
check('(i) live row has extraMinutes and expiresAt', row5?.extraMinutes === 10 && row5.expiresAt === e1.data.expiresAt, JSON.stringify(row5));
await fac('(i) add 120 more (130 total)', 'POST', extendUrl(a5), { minutes: 120 }, { expect: [200] });
await fac('(i) another 120 would pass the 180 cap', 'POST', extendUrl(a5), { minutes: 120 }, { expect: [422] });
await fac('(i) add 50 more (180 total)', 'POST', extendUrl(a5), { minutes: 50 }, { expect: [200] });
await fac('(i) one more minute is refused', 'POST', extendUrl(a5), { minutes: 1 }, { expect: [422] });

// concurrent grants never overshoot the cap and are each applied once
const st6 = await s6('(i) start for the concurrency test', 'POST', '/api/exam/start', { quizId: quiz3, acknowledgedRules: true }, { expect: [200] });
const a6 = st6.data.attemptId;
const burst = await Promise.all([1, 2, 3, 4, 5].map((i) => fac(`(i) concurrent add #${i}`, 'POST', extendUrl(a6), { minutes: 60 })));
const granted = burst.filter((r) => r.status === 200).length;
const row6 = await prisma.quizAttempt.findUnique({ where: { id: a6 }, select: { extraMinutes: true, expiresAt: true, startedAt: true } });
check('(i) concurrent grants are applied once each, within the cap', granted >= 1 && row6.extraMinutes === granted * 60 && row6.extraMinutes <= 180, `granted=${granted} extra=${row6.extraMinutes} statuses=${burst.map((r) => r.status)}`);
check('(i) deadline equals start + 30 + granted', row6.expiresAt.getTime() === row6.startedAt.getTime() + (30 + row6.extraMinutes) * 60_000);
// fullscreen exits tagged as file-picker are forgiven only up to the server allowance (2 with no uploads)
const pick = (n) => s6(`(i) ${n} file-picker fullscreen exits`, 'POST', `/api/exam/${a6}/events`, { events: Array.from({ length: n }, () => ({ type: 'FULLSCREEN_EXIT', metadata: { context: 'file-picker' } })) }, { expect: [200] });
await pick(2);
const rep2 = await fac('(i) integrity report after 2 tagged exits', 'GET', `/api/admin/integrity/${a6}`, undefined, { expect: [200] });
check('(i) 2 file-picker exits are not scored', rep2.data?.integrity?.score === 100, JSON.stringify(rep2.data?.breakdown ?? rep2.data?.integrity ?? '').slice(0, 160));
await pick(4);
const rep6 = await fac('(i) integrity report after 6 tagged exits', 'GET', `/api/admin/integrity/${a6}`, undefined, { expect: [200] });
check('(i) tagged exits past the allowance are scored', rep6.data?.integrity?.score < 100, JSON.stringify(rep6.data?.integrity ?? '').slice(0, 160));
// offline queue: a delayed replay (older clientSeq) must not overwrite a newer edit
const st6state = (await s6('(j) state for the seq test', 'GET', `/api/exam/${a6}/state`, undefined, { expect: [200] })).data;
const short6 = st6state.questions.find((q) => q.type === 'SHORT_ANSWER').attemptQuestionId;
const put6 = (text, clientSeq) => s6(`(j) save "${text}" seq ${clientSeq ?? 'none'}`, 'POST', `/api/exam/${a6}/answer`, { attemptQuestionId: short6, textResponse: text, ...(clientSeq ? { clientSeq } : {}) }, { expect: [200] });
check('(j) first save applies', (await put6('80', 100)).data?.textResponse === '80');
check('(j) older seq is acknowledged but not applied', (await put6('99', 50)).data?.textResponse === '80');
check('(j) equal seq is not applied', (await put6('77', 100)).data?.textResponse === '80');
check('(j) newer seq applies', (await put6('81', 101)).data?.textResponse === '81');
check('(j) a save without a seq still applies', (await put6('82')).data?.textResponse === '82');
await s6('(j) clientSeq must be a positive integer', 'POST', `/api/exam/${a6}/answer`, { attemptQuestionId: short6, textResponse: 'x', clientSeq: 0 }, { expect: [422] });
await s6('(j) flag a question in progress', 'POST', `/api/exam/${a6}/flag`, { attemptQuestionId: short6, markedForReview: true }, { expect: [200] });
check('(j) flag did not disturb the answer', (await prisma.answer.findFirst({ where: { attemptQuestionId: short6 }, select: { textResponse: true, markedForReview: true } }))?.textResponse === '82');

const q3 = await prisma.quiz.findUnique({ where: { id: quiz3 }, select: { maxExtensionMinutes: true } });
check('(i) quiz release horizon is the largest extension (180)', q3.maxExtensionMinutes === 180, String(q3.maxExtensionMinutes));
const audits = await prisma.auditLog.count({ where: { action: 'admin.time_extended' } });
check('(i) every grant is audited', audits === 1 + 3 + granted, `audits=${audits} expected=${1 + 3 + granted}`);

// ---------------- (k) broadcast notices and pause ----------------
const a4 = st4.data.attemptId;
const noticeUrl = `/api/admin/quizzes/${quiz3}/notices`;
await fac2('(k) non-owner cannot send a notice', 'POST', noticeUrl, { message: 'hi' }, { expect: [403] });
await s4('(k) student cannot send a notice', 'POST', noticeUrl, { message: 'hi' }, abuse);
await fac('(k) empty notice refused', 'POST', noticeUrl, { message: '   ' }, { expect: [422] });
await fac('(k) 501-character notice refused', 'POST', noticeUrl, { message: 'x'.repeat(501) }, { expect: [422] });
const beforeNotice = (await s4('(k) state before any notice', 'GET', `/api/exam/${a4}/state`, undefined, { expect: [200] })).data;
check('(k) no notices yet', Array.isArray(beforeNotice.notices) && beforeNotice.notices.length === 0);
const sent = await fac('(k) send a notice', 'POST', noticeUrl, { message: 'Q4 should read: "three-way handshake".' }, { expect: [200] });
check('(k) notice reports who is sitting', sent.data?.sitting >= 1, JSON.stringify(sent.data));
const hbN = await s4('(k) heartbeat with cursor', 'POST', `/api/exam/${a4}/heartbeat`, { noticesSince: beforeNotice.timer.serverNow }, { expect: [200] });
check('(k) heartbeat delivers the notice once', hbN.data?.notices?.length === 1 && hbN.data.notices[0].message.startsWith('Q4 should read'), JSON.stringify(hbN.data?.notices));
const hbNone = await s4('(k) heartbeat without a cursor', 'POST', `/api/exam/${a4}/heartbeat`, {}, { expect: [200] });
check('(k) no cursor means no notices', hbNone.data?.notices?.length === 0);
const reload = (await s4('(k) a reload still sees the notice', 'GET', `/api/exam/${a4}/state`, undefined, { expect: [200] })).data;
check('(k) state carries the notice', reload.notices?.length === 1);

const pauseUrl = `/api/admin/attempts/${a4}/pause`;
const short4 = reload.questions.find((q) => q.type === 'SHORT_ANSWER').attemptQuestionId;
await fac2('(k) non-owner cannot pause', 'POST', pauseUrl, { action: 'pause' }, { expect: [403] });
await s4('(k) student cannot pause', 'POST', pauseUrl, { action: 'pause' }, abuse);
await fac('(k) resume when not paused refused', 'POST', pauseUrl, { action: 'resume' }, { expect: [409] });
const paused = await fac('(k) pause', 'POST', pauseUrl, { action: 'pause' }, { expect: [200] });
check('(k) pause reports paused', paused.data?.paused === true);
await fac('(k) pausing twice refused', 'POST', pauseUrl, { action: 'pause' }, { expect: [409] });
const h1 = (await s4('(k) heartbeat while paused', 'POST', `/api/exam/${a4}/heartbeat`, {}, { expect: [200] })).data;
await sleep(2500);
const h2 = (await s4('(k) heartbeat again while paused', 'POST', `/api/exam/${a4}/heartbeat`, {}, { expect: [200] })).data;
check('(k) heartbeat says paused', h1.paused === true && h2.paused === true);
check('(k) the clock is frozen', Math.abs(h1.timer.remainingMs - h2.timer.remainingMs) < 800, `${h1.timer.remainingMs} -> ${h2.timer.remainingMs}`);
await s4('(k) answers are refused while paused', 'POST', `/api/exam/${a4}/answer`, { attemptQuestionId: short4, textResponse: 'while paused' }, { expect: [423] });
await s4('(k) the review flag is refused while paused', 'POST', `/api/exam/${a4}/flag`, { attemptQuestionId: short4, markedForReview: true }, { expect: [423] });
const livePaused = await fac('(k) live feed while paused', 'GET', '/api/admin/live', undefined, { expect: [200] });
check('(k) live row shows paused', livePaused.data?.students.find((r) => r.attemptId === a4)?.paused === true);
// a long pause: the raw deadline is far in the past, but a paused attempt must not be swept
await prisma.quizAttempt.update({ where: { id: a4 }, data: { pausedAt: new Date(Date.now() - 10 * 60_000), expiresAt: new Date(Date.now() - 9 * 60_000) } });
await fac('(k) live feed runs the sweep', 'GET', '/api/admin/live', undefined, { expect: [200] });
const afterSweep = await prisma.quizAttempt.findUnique({ where: { id: a4 }, select: { status: true } });
check('(k) a paused attempt is not auto-submitted', afterSweep.status === 'IN_PROGRESS', afterSweep.status);
const dash4 = await s4('(k) dashboard keeps a paused exam', 'GET', '/api/student/dashboard', undefined, { expect: [200] });
check('(k) dashboard still shows it in progress', dash4.data?.upcoming.some((q) => q.id === quiz3 && q.state === 'IN_PROGRESS'));
const resumed = await fac('(k) resume', 'POST', pauseUrl, { action: 'resume' }, { expect: [200] });
check('(k) resume gives back the time they had (about 1 min)', resumed.data?.paused === false && resumed.data.remainingMs > 30_000 && resumed.data.remainingMs < 90_000, JSON.stringify(resumed.data));
const h3 = (await s4('(k) heartbeat after resume', 'POST', `/api/exam/${a4}/heartbeat`, {}, { expect: [200] })).data;
check('(k) no longer paused', h3.paused === false && h3.timer.remainingMs > 30_000 && h3.timer.remainingMs < 90_000, String(h3.timer.remainingMs));
await s4('(k) answers work again', 'POST', `/api/exam/${a4}/answer`, { attemptQuestionId: short4, textResponse: 'after resume' }, { expect: [200] });
const pauseAudits = await prisma.auditLog.count({ where: { action: { in: ['admin.attempt_paused', 'admin.attempt_resumed'] } } });
check('(k) pause and resume are audited', pauseAudits === 2, String(pauseAudits));
check('(k) notices are audited', (await prisma.auditLog.count({ where: { action: 'admin.notice_sent' } })) === 1);

// the window closes while 23CSE005 is still sitting on extra time
const closeEnd3 = new Date(Date.now() - 1000).toISOString();
// The quiz PATCH refuses edits while students are sitting, so let the clock run out in the DB.
await prisma.quiz.update({ where: { id: quiz3 }, data: { startsAt: new Date(Date.now() - 3600_000), endsAt: new Date(closeEnd3) } });
const brief5 = await s5('(i) briefing after close, attempt open', 'GET', `/api/student/quizzes/${quiz3}`, undefined, { expect: [200] });
check('(i) can resume past the window', brief5.data?.canStart === true && brief5.data.activeAttemptId === a5, JSON.stringify({ canStart: brief5.data?.canStart, active: brief5.data?.activeAttemptId }));
const res5 = await s5('(i) resume after the window closed', 'POST', '/api/exam/start', { quizId: quiz3, acknowledgedRules: true }, { expect: [200] });
check('(i) resumed the same attempt', res5.data?.resumed === true && res5.data.attemptId === a5);
await s5('(i) state still served past the window', 'GET', `/api/exam/${a5}/state`, undefined, { expect: [200] });
const dash5 = await s5('(i) dashboard keeps the open quiz', 'GET', '/api/student/dashboard', undefined, { expect: [200] });
check('(i) dashboard lists it as in progress', dash5.data?.upcoming.some((q) => q.id === quiz3 && q.state === 'IN_PROGRESS'));
await s7('(i) a student who never started cannot start after close', 'POST', '/api/exam/start', { quizId: quiz3, acknowledgedRules: true }, abuse);
await fac('(i) extra time cannot be set on a closed quiz', 'PUT', ext, { studentId: sid('23CSE007'), minutes: 10 }, { expect: [409] });
await s5('(i) submit', 'POST', `/api/exam/${a5}/submit`, { confirm: true }, { expect: [200] });
const r5 = await s5('(i) result held while an extension may still run', 'GET', `/api/results/${a5}`, undefined, { expect: [200] });
check('(i) released:false until end + 180 min', r5.data?.released === false && Math.abs(Date.parse(r5.data.releasesAt) - (Date.parse(closeEnd3) + 180 * 60_000)) < 1000, JSON.stringify({ released: r5.data?.released, releasesAt: r5.data?.releasesAt }));
await fac('(i) add time after submit refused', 'POST', extendUrl(a5), { minutes: 5 }, { expect: [409] });
const q5 = (await prisma.attemptQuestion.findFirst({ where: { attemptId: a5 }, select: { id: true } })).id;
await s5('(j) flag after submit refused', 'POST', `/api/exam/${a5}/flag`, { attemptQuestionId: q5, markedForReview: true }, abuse);

// ---------------- (l) quiz-wide marking scheme ----------------
const quiz4 = await mkQuiz('E2E marking', ['23CSE009'], { negativeMarkingPct: 25 });
const q4detail = (await fac('(l) quiz detail carries the scheme', 'GET', `/api/admin/quizzes/${quiz4}`, undefined, { expect: [200] })).data.quiz;
check('(l) marking is returned', q4detail.marking?.negativeMarkingPct === 25 && q4detail.marking.multiPartialCredit === null, JSON.stringify(q4detail.marking));
await fac('(l) 101% refused', 'PATCH', `/api/admin/quizzes/${quiz4}`, { negativeMarkingPct: 101 }, { expect: [422] });
const s9 = client('stu9', 'e2e-stu9-device');
await login(s9, '23CSE009');
const st9 = await s9('(l) start', 'POST', '/api/exam/start', { quizId: quiz4, acknowledgedRules: true }, { expect: [200] });
const a9 = st9.data.attemptId;
const p9 = (await s9('(l) state', 'GET', `/api/exam/${a9}/state`, undefined, { expect: [200] })).data.questions;
const mcq9 = p9.find((q) => q.type === 'MCQ_SINGLE');
const wrong9 = mcq9.options.find((o) => !o.text.startsWith('Transmission')).id;
await s9('(l) wrong MCQ answer (2 marks)', 'POST', `/api/exam/${a9}/answer`, { attemptQuestionId: mcq9.attemptQuestionId, selectedOptionId: wrong9 }, { expect: [200] });
await s9('(l) right short answer (1 mark)', 'POST', `/api/exam/${a9}/answer`, { attemptQuestionId: p9.find((q) => q.type === 'SHORT_ANSWER').attemptQuestionId, textResponse: '80' }, { expect: [200] });
await s9('(l) submit', 'POST', `/api/exam/${a9}/submit`, { confirm: true }, { expect: [200] });
const scored9 = await prisma.quizAttempt.findUnique({ where: { id: a9 }, select: { score: true } });
check('(l) a wrong 2-mark answer loses 25% (0.5): 1 - 0.5 = 0.5', scored9.score === 0.5, String(scored9.score));
await fac('(l) change the scheme after the exam', 'PATCH', `/api/admin/quizzes/${quiz4}`, { negativeMarkingPct: 50, multiPartialCredit: false }, { expect: [200] });
const dup = await fac('(l) duplicate copies the scheme', 'POST', `/api/admin/quizzes/${quiz4}/duplicate`, {}, { expect: [200] });
const copy = await prisma.quiz.findFirst({ where: { title: { contains: '(copy)' }, negativeMarkingPct: 50, multiPartialCredit: false } });
check('(l) the copy has the scheme', Boolean(copy), JSON.stringify(dup.data));

// (e) events after the 60 s post-submit window
const wait = Math.max(0, submittedAt + 120_000 - Date.now());
log(`     info     waiting ${Math.round(wait / 1000)} s for post-submit window`);
await sleep(wait);
const before = await prisma.examEvent.count({ where: { attemptId } });
const late = await stu('(e) events 2 min after submit', 'POST', `/api/exam/${attemptId}/events`, { events: [{ type: 'TAB_SWITCH' }] });
const after = await prisma.examEvent.count({ where: { attemptId } });
check('(e) late events not stored', after === before, `status=${late.status} body=${late.text.slice(0, 120)}`);

// (h) result header: the student's own candidate details, and nobody else's
const me = studentList.find((s) => s.rollNumber === '23CSE001');
const cand = d.candidate;
check('(h) result candidate is the signed-in student', cand?.name === me.name && cand?.rollNumber === me.rollNumber && Object.keys(cand).length === 2, JSON.stringify(cand));
const others = studentList.filter((s) => s.rollNumber !== me.rollNumber);
check('(h) result carries no other student name/roll/email', !others.some((s) => r2.text.includes(`"${s.rollNumber}"`) || r2.text.includes(s.name) || r2.text.includes(s.email)), `others=${others.length}`);

ids = { quizId, attemptId, quiz2, a2, a3, quiz3, a5, a6 };
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

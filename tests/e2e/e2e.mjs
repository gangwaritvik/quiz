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
    // A pooled connection the server has just closed fails the first request on it; try once more.
    const send = () => fetch(BASE + path, { method, headers, redirect: 'manual', body: payload });
    const res = await send().catch(() => send());
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
await stu('upload answer image (1x1 png)', 'POST', `/api/exam/${attemptId}/attachments`, undefined, { raw: fd, expect: [200] });
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
check('(a) no topic scores while the key is withheld', Array.isArray(r2.data?.topicPerformance) && r2.data.topicPerformance.length === 0, JSON.stringify(r2.data?.topicPerformance));
await prisma.quiz.update({ where: { id: quizId }, data: { releaseAnswers: true } });
const rKey = await stu('(a) result with the key released', 'GET', `/api/results/${attemptId}`, undefined, { expect: [200] });
check('(a) topic scores appear once the key is released', (rKey.data?.topicPerformance?.length ?? 0) > 0);
await prisma.quiz.update({ where: { id: quizId }, data: { releaseAnswers: false } });

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
// a pause nobody ends: after an hour the clock runs again by itself, and the student gets back exactly that hour
const horizonBefore = (await prisma.quiz.findUnique({ where: { id: quiz3 }, select: { maxExtensionMinutes: true } })).maxExtensionMinutes;
await prisma.quizAttempt.update({ where: { id: a4 }, data: { pausedAt: new Date(Date.now() - 61 * 60_000), expiresAt: new Date(Date.now() + 29 * 60_000) } });
const h4 = (await s4('(k) heartbeat after an overlong pause', 'POST', `/api/exam/${a4}/heartbeat`, {}, { expect: [200] })).data;
check('(k) an overlong pause ends by itself', h4.paused === false, JSON.stringify(h4.paused));
check('(k) the student got back one hour, not 61 minutes', h4.timer.remainingMs > 88 * 60_000 && h4.timer.remainingMs < 90 * 60_000, String(h4.timer.remainingMs));
await s4('(k) answers work after the automatic resume', 'POST', `/api/exam/${a4}/answer`, { attemptQuestionId: short4, textResponse: 'after auto resume' }, { expect: [200] });
check('(k) the automatic resume is audited', (await prisma.auditLog.count({ where: { action: 'admin.attempt_resumed', entityId: a4 } })) === 2);
await prisma.quiz.update({ where: { id: quiz3 }, data: { maxExtensionMinutes: horizonBefore } });

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

// ---------------- (m) item analysis ----------------
await fac2('(m) non-owner cannot read item analysis', 'GET', `/api/admin/quizzes/${quiz4}/item-analysis`, undefined, { expect: [403] });
await s9('(m) student cannot read item analysis', 'GET', `/api/admin/quizzes/${quiz4}/item-analysis`, undefined, abuse);
const ia = await fac('(m) item analysis', 'GET', `/api/admin/quizzes/${quiz4}/item-analysis`, undefined, { expect: [200] });
const iaMcq = ia.data?.questions.find((q) => q.type === 'MCQ_SINGLE');
const iaShort = ia.data?.questions.find((q) => q.type === 'SHORT_ANSWER');
check('(m) one attempt, four questions', ia.data?.attempts === 1 && ia.data.questions.length === 4, JSON.stringify([ia.data?.attempts, ia.data?.questions?.length]));
check('(m) the wrong MCQ pick earned nothing and is the most chosen wrong option', iaMcq?.facility === 0 && iaMcq.mostChosenWrong?.chosen === 1, JSON.stringify(iaMcq?.mostChosenWrong));
check('(m) the right short answer earned everything', iaShort?.facility === 1);
check('(m) separation is withheld with one attempt', iaMcq?.discrimination === null);
check('(m) the answer key is part of the option list for faculty', iaMcq?.distractors.some((d) => d.correct) === true);

// ---------------- (n) retake grants ----------------
const retakeUrl = `/api/admin/quizzes/${quiz4}/retakes`;
const grant9 = { studentId: sid('23CSE009'), action: 'grant' };
await fac2('(n) non-owner cannot grant a retake', 'POST', retakeUrl, grant9, { expect: [403] });
await s9('(n) student cannot grant a retake', 'POST', retakeUrl, grant9, abuse);
await s9('(n) a second attempt is refused before a grant', 'POST', '/api/exam/start', { quizId: quiz4, acknowledgedRules: true }, abuse);
check('(n) the briefing says the quiz is done', (await s9('(n) briefing before', 'GET', `/api/student/quizzes/${quiz4}`, undefined, { expect: [200] })).data?.canStart === false);
await fac('(n) unassigned student refused', 'POST', retakeUrl, { studentId: sid('23CSE008'), action: 'grant' }, { expect: [404] });
const g1 = await fac('(n) grant a retake', 'POST', retakeUrl, grant9, { expect: [200] });
check('(n) one extra attempt, unused', g1.data?.extraAttempts === 1 && g1.data.attemptsMade === 1 && g1.data.canStart === true, JSON.stringify(g1.data));
check('(n) the briefing now lets them start', (await s9('(n) briefing after', 'GET', `/api/student/quizzes/${quiz4}`, undefined, { expect: [200] })).data?.canStart === true);
const dash9 = await s9('(n) dashboard after the grant', 'GET', '/api/student/dashboard', undefined, { expect: [200] });
check('(n) dashboard offers it again', dash9.data?.upcoming.find((q) => q.id === quiz4)?.state === 'AVAILABLE');
const list9 = await s9('(n) quiz list after the grant', 'GET', '/api/student/quizzes', undefined, { expect: [200] });
const row9 = list9.data?.quizzes.find((q) => q.id === quiz4);
check('(n) list offers it again and keeps the first result link', row9?.state === 'AVAILABLE' && Boolean(row9.resultAttemptId), JSON.stringify([row9?.state, row9?.resultAttemptId]));
const re9 = await s9('(n) start the retake', 'POST', '/api/exam/start', { quizId: quiz4, acknowledgedRules: true }, { expect: [200] });
check('(n) it is a new attempt', re9.data?.resumed === false && re9.data.attemptId !== a9);
const dashLive = await s9('(n) dashboard while sitting', 'GET', '/api/student/dashboard', undefined, { expect: [200] });
check('(n) a live retake shows as in progress, not completed', dashLive.data?.upcoming.find((q) => q.id === quiz4)?.state === 'IN_PROGRESS');
// Weak-connection handling: network trouble is recorded but not scored, and answers written before the buzzer still arrive shortly after it.
const reA = re9.data.attemptId;
await s9('(n) the connection test answers a student', 'GET', '/api/net-check?size=2048', undefined, { expect: [200] });
await fac('(n) and is closed to faculty', 'GET', '/api/net-check?size=2048', undefined, { expect: [401, 403] });
await s9('(n) a flaky connection is reported', 'POST', `/api/exam/${reA}/events`, { events: Array.from({ length: 6 }, () => ({ type: 'NETWORK_OFFLINE' })) }, { expect: [200] });
const repNet = await fac('(n) integrity report after network drops', 'GET', `/api/admin/integrity/${reA}`, undefined, { expect: [200] });
check('(n) dropped connections cost no integrity points', repNet.data?.integrity?.score === 100, JSON.stringify(repNet.data?.integrity));
const reQs = (await s9('(n) retake state', 'GET', `/api/exam/${reA}/state`, undefined, { expect: [200] })).data.questions;
const reMcq = reQs.find((q) => q.type === 'MCQ_SINGLE');
await prisma.quizAttempt.update({ where: { id: reA }, data: { expiresAt: new Date(Date.now() - 20_000) } });
await s9('(n) an answer 20 s past the deadline is still accepted', 'POST', `/api/exam/${reA}/answer`, { attemptQuestionId: reMcq.attemptQuestionId, selectedOptionId: reMcq.options[0].id }, { expect: [200] });
await s9('(n) a heartbeat in that window does not end the exam early', 'POST', `/api/exam/${reA}/heartbeat`, {}, { expect: [200] });
check('(n) the attempt is still open inside the window', (await prisma.quizAttempt.findUnique({ where: { id: reA }, select: { status: true } })).status === 'IN_PROGRESS');
await prisma.quizAttempt.update({ where: { id: reA }, data: { expiresAt: new Date(Date.now() - 90_000) } });
await s9('(n) an answer 90 s past the deadline is refused', 'POST', `/api/exam/${reA}/answer`, { attemptQuestionId: reMcq.attemptQuestionId, selectedOptionId: reMcq.options[1].id }, { expect: [410] });
check('(n) and the attempt is closed', (await prisma.quizAttempt.findUnique({ where: { id: reA }, select: { status: true } })).status === 'AUTO_SUBMITTED');
await s9('(n) submit the retake', 'POST', `/api/exam/${re9.data.attemptId}/submit`, { confirm: true }, { expect: [200] });
await s9('(n) no third attempt', 'POST', '/api/exam/start', { quizId: quiz4, acknowledgedRules: true }, abuse);
const g2 = await fac('(n) grant another', 'POST', retakeUrl, grant9, { expect: [200] });
const rv9 = await fac('(n) take it back', 'POST', retakeUrl, { ...grant9, action: 'revoke' }, { expect: [200] });
check('(n) taking back removes only the unused grant', g2.data?.extraAttempts === 2 && rv9.data?.extraAttempts === 1 && rv9.data.canStart === false, JSON.stringify([g2.data, rv9.data]));
const sums = await fac('(n) results summary', 'GET', `/api/admin/results?quizId=${quiz4}`, undefined, { expect: [200] });
check('(n) a retaker counts once in the quiz average', sums.data?.quizSummaries.find((q) => q.quizId === quiz4)?.attempts === 1, JSON.stringify(sums.data?.quizSummaries));
await prisma.quiz.update({ where: { id: quiz4 }, data: { startsAt: new Date(Date.now() - 7200_000), endsAt: new Date(Date.now() - 1000) } });
await fac('(n) no grant once the window has closed', 'POST', retakeUrl, grant9, { expect: [409] });

// ---------------- (o) result appeals ----------------
const appealUrl = `/api/results/${attemptId}/appeal`;
const resBefore = (await stu('(o) result before any appeal', 'GET', `/api/results/${attemptId}`, undefined, { expect: [200] })).data;
check('(o) a released, final result can be appealed', resBefore.canAppeal === true && resBefore.appeal === null);
await s9('(o) another student cannot appeal it', 'POST', appealUrl, { reason: 'This is not my result at all.' }, { expect: [403] });
await s3('(o) no appeal while results are held back', 'POST', `/api/results/${a3}/appeal`, { reason: 'I would like this checked please.' }, { expect: [409] });
await stu('(o) a one-word reason is refused', 'POST', appealUrl, { reason: 'wrong' }, { expect: [422] });
await stu('(o) file an appeal', 'POST', appealUrl, { reason: 'Question 1: I chose the right protocol name, please check.' }, { expect: [200] });
await stu('(o) a second open appeal is refused', 'POST', appealUrl, { reason: 'Asking twice should not be possible.' }, { expect: [409] });
const resOpen = (await stu('(o) result with an open appeal', 'GET', `/api/results/${attemptId}`, undefined, { expect: [200] })).data;
check('(o) the student sees it waiting', resOpen.appeal?.status === 'OPEN' && resOpen.canAppeal === false, JSON.stringify(resOpen.appeal));

const queue = await fac('(o) faculty appeals queue', 'GET', '/api/admin/appeals', undefined, { expect: [200] });
const myAppeal = queue.data?.appeals.find((a) => a.attemptId === attemptId);
check('(o) the owner sees it', Boolean(myAppeal) && myAppeal.status === 'OPEN' && myAppeal.rollNumber === '23CSE001', JSON.stringify(myAppeal));
const queue2 = await fac2('(o) other faculty appeals queue', 'GET', '/api/admin/appeals?status=all', undefined, { expect: [200] });
check('(o) another faculty member does not', !queue2.text.includes(attemptId));
await fac2('(o) another faculty member cannot answer it', 'POST', `/api/admin/appeals/${myAppeal.id}`, { status: 'REJECTED', note: 'no' }, { expect: [403] });
await stu('(o) a student cannot answer it', 'POST', `/api/admin/appeals/${myAppeal.id}`, { status: 'UPHELD', note: 'I win' }, abuse);
check('(o) the owner overview counts it', (await fac('(o) overview', 'GET', '/api/admin/overview', undefined, { expect: [200] })).data?.stats.openAppeals === 1);
await fac('(o) rejecting cannot change marks', 'POST', `/api/admin/appeals/${myAppeal.id}`, { status: 'REJECTED', note: 'stands', adjustments: [{ answerId: 'x'.repeat(25), awardedMarks: 1 }] }, { expect: [422] });
const mcqAnswer = await prisma.answer.findFirst({ where: { attemptId, attemptQuestion: { question: { type: 'MCQ_SINGLE' } } }, select: { id: true } });
const scoreBefore = (await prisma.quizAttempt.findUnique({ where: { id: attemptId }, select: { score: true } })).score;
await fac('(o) marks above the maximum are refused and nothing changes', 'POST', `/api/admin/appeals/${myAppeal.id}`, { status: 'UPHELD', note: 'bump', adjustments: [{ answerId: mcqAnswer.id, awardedMarks: 99 }] }, { expect: [422] });
check('(o) the refused decision left the appeal open', (await prisma.resultAppeal.findUnique({ where: { id: myAppeal.id } })).status === 'OPEN');
const decided = await fac('(o) uphold and change an auto-graded answer', 'POST', `/api/admin/appeals/${myAppeal.id}`, { status: 'UPHELD', note: 'Re-marked: half credit.', adjustments: [{ answerId: mcqAnswer.id, awardedMarks: 1 }] }, { expect: [200] });
check('(o) the attempt total follows the change', decided.data?.score === scoreBefore - 1, `${scoreBefore} -> ${decided.data?.score}`);
await fac('(o) answering twice is refused', 'POST', `/api/admin/appeals/${myAppeal.id}`, { status: 'REJECTED', note: 'again' }, { expect: [409] });
const resDone = (await stu('(o) result after the decision', 'GET', `/api/results/${attemptId}`, undefined, { expect: [200] })).data;
check('(o) the student sees the outcome and the note', resDone.appeal?.status === 'UPHELD' && resDone.appeal.facultyNote === 'Re-marked: half credit.' && resDone.canAppeal === true);
check('(o) filing and answering are audited', (await prisma.auditLog.count({ where: { action: 'student.appeal_filed' } })) === 1 && (await prisma.auditLog.count({ where: { action: 'admin.appeal_resolved' } })) === 1);
const dashAfter = (await stu('(o) dashboard after the decision', 'GET', '/api/student/dashboard', undefined, { expect: [200] })).data;
check('(o) the dashboard carries the reply for the bell', dashAfter.appealReplies?.length === 1 && dashAfter.appealReplies[0].status === 'UPHELD' && dashAfter.appealReplies[0].attemptId === attemptId, JSON.stringify(dashAfter.appealReplies));

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

// (p) results and marking filters: section, subject, quiz, search; faculty scoping holds
const resAll = (await fac('(p) results unfiltered', 'GET', '/api/admin/results', undefined, { expect: [200] })).data;
check('(p) results describe their filter options', resAll.options.quizzes.some((q) => q.id === quizId) && resAll.options.subjects.length > 0 && resAll.options.sections.length > 0);
const mySection = resAll.options.sections[0];
const secQs = `department=${encodeURIComponent(mySection.department)}&section=${encodeURIComponent(mySection.section)}`;
const resSec = (await fac('(p) results by section', 'GET', `/api/admin/results?${secQs}`, undefined, { expect: [200] })).data;
check('(p) a section filter returns only that section', resSec.results.length > 0 && resSec.results.every((r) => r.section === mySection.section), JSON.stringify(resSec.results.map((r) => r.section)));
const otherSection = resAll.options.sections.find((x) => x.section !== mySection.section);
if (otherSection) {
  const resOther = (await fac('(p) results by the other section', 'GET', `/api/admin/results?department=${encodeURIComponent(otherSection.department)}&section=${encodeURIComponent(otherSection.section)}`, undefined, { expect: [200] })).data;
  check('(p) sections do not overlap', resOther.results.every((r) => r.section === otherSection.section));
}
const resQuiz = (await fac('(p) results by quiz', 'GET', `/api/admin/results?quizId=${quizId}`, undefined, { expect: [200] })).data;
check('(p) a quiz filter returns only that quiz', resQuiz.results.length > 0 && resQuiz.results.every((r) => r.quizId === quizId));
const resRoll = (await fac('(p) results search by roll number', 'GET', '/api/admin/results?q=23CSE001', undefined, { expect: [200] })).data;
check('(p) search finds the student', resRoll.results.length > 0 && resRoll.results.every((r) => r.rollNumber === '23CSE001'));
const resNone = (await fac('(p) results for an unknown subject', 'GET', '/api/admin/results?subjectId=cmzzzzzzzzzzzzzzzzzzzzzzz', undefined, { expect: [200] })).data;
check('(p) an unknown subject leaves nothing', resNone.results.length === 0 && resNone.quizSummaries.length === 0);
const resBadFilter = await fac('(p) a malformed filter is ignored, not an error', 'GET', '/api/admin/results?quizId=nope&flagged=maybe', undefined, { expect: [200] });
check('(p) malformed filters fall back to unfiltered', resBadFilter.data.results.length === resAll.results.length);
const resOther2 = (await fac2('(p) another faculty member sees none of it', 'GET', `/api/admin/results?quizId=${quizId}`, undefined, { expect: [200] })).data;
check('(p) filters cannot widen faculty scope', resOther2.results.length === 0 && !resOther2.options.quizzes.some((q) => q.id === quizId));
const gAll = (await fac('(p) marking queue options', 'GET', '/api/admin/grading?includeCompleted=true', undefined, { expect: [200] })).data;
check('(p) the marking queue lists subjects and sections to filter by', Array.isArray(gAll.subjects) && Array.isArray(gAll.sections) && gAll.quizzes.every((q) => typeof q.subjectId === 'string'));
const gNoSubject = (await fac('(p) marking queue for an unknown subject', 'GET', '/api/admin/grading?includeCompleted=true&subjectId=cmzzzzzzzzzzzzzzzzzzzzzzz', undefined, { expect: [200] })).data;
check('(p) a subject filter narrows the marking queue', gNoSubject.total === 0);
const gSec = await fac('(p) marking queue by section', 'GET', `/api/admin/grading?includeCompleted=true&${secQs}&q=23CSE`, undefined, { expect: [200] });
check('(p) section and search combine in the marking queue', gSec.data.attempts.every((a) => a.student.section === mySection.section));
const metaNow = (await fac('(p) meta carries topic counts', 'GET', '/api/admin/meta', undefined, { expect: [200] })).data;
check('(p) subjects report topic counts and the no-topic count', metaNow.subjects.every((sub) => typeof sub.noTopic === 'number' && sub.topics.every((t) => typeof t.count === 'number')));
const subjWithQs = metaNow.subjects.find((sub) => sub.pool.total > 0);
const qsNoTopic = (await fac('(p) questions without a topic', 'GET', `/api/admin/questions?subjectId=${subjWithQs.id}&topicId=none&pageSize=100`, undefined, { expect: [200] })).data;
check('(p) topic=none returns only topicless questions, matching the count', qsNoTopic.questions.every((qq) => qq.topic === null) && qsNoTopic.total === subjWithQs.noTopic, `${qsNoTopic.total} vs ${subjWithQs.noTopic}`);

// (q) AI question generation (AI_PROVIDER=fake): materials, OCR, jobs, drafts, review, scoping
{
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const makePdf = async (pages) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const text of pages) {
      const page = doc.addPage([400, 400]);
      if (text) page.drawText(text, { x: 20, y: 300, size: 10, font });
      else page.drawRectangle({ x: 50, y: 50, width: 200, height: 200 }); // a "scanned" page: no text layer
    }
    return Buffer.from(await doc.save());
  };
  const upload = (who, step, subjectId, bytes, name, expect) => {
    const form = new FormData();
    form.append('file', new Blob([bytes]), name);
    return who(step, 'POST', `/api/admin/subjects/${subjectId}/materials`, undefined, { raw: form, expect });
  };
  const waitFor = async (fn, ms = 30_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const value = await fn();
      if (value) return value;
      await sleep(400);
    }
    return null;
  };

  const meta = (await fac('(q) meta', 'GET', '/api/admin/meta', undefined, { expect: [200] })).data;
  const subj = meta.subjects[0];
  const textPdf = await makePdf([
    'The transport layer provides reliable delivery between applications.',
    'TCP gives reliable ordered delivery; UDP is connectionless and has low overhead.',
    'Congestion control uses slow start and congestion avoidance to adapt the window.',
  ]);
  const scannedPdf = await makePdf(['This first page has a real text layer that is long enough.', '', '']);
  const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....word/document.xml....'), Buffer.alloc(64)]);
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);

  const listUrl = `/api/admin/subjects/${subj.id}/materials`;
  const empty = (await fac('(q) materials list starts empty', 'GET', listUrl, undefined, { expect: [200] })).data;
  check('(q) the feature is on under the fake provider', empty.enabled === true);

  const mText = (await upload(fac, '(q) upload a text PDF', subj.id, textPdf, 'chapter.pdf', [200])).data;
  const mScan = (await upload(fac, '(q) upload a scanned PDF', subj.id, scannedPdf, 'scan.pdf', [200])).data;
  const mPng = (await upload(fac, '(q) upload a photo of notes', subj.id, PNG, 'notes.png', [200])).data;
  const mDocx = (await upload(fac, '(q) upload a Word file', subj.id, docx, 'notes.docx', [200])).data;
  await upload(fac, '(q) a renamed .exe is refused', subj.id, exe, 'evil.pdf', [422]);
  await upload(stu, '(q) a student cannot upload material', subj.id, textPdf, 'x.pdf', [401, 403]);

  const ready = await waitFor(async () => {
    const list = (await fac('(q) poll materials', 'GET', listUrl, undefined, {})).data;
    return list.materials.length === 4 && list.materials.every((m) => m.status === 'READY') ? list : null;
  });
  check('(q) all four materials become ready', ready !== null, JSON.stringify(ready?.materials.map((m) => m.status)));
  const scanRow = await prisma.studyMaterial.findUnique({ where: { id: mScan.id } });
  check('(q) OCR ran only on the two scanned pages', scanRow.scannedPages === 2 && scanRow.pageCount === 3, `${scanRow.scannedPages}/${scanRow.pageCount}`);
  check('(q) the OCR text is page-marked and keeps the real page', /--- Page 1 ---\nThis first page/.test(scanRow.ocrText ?? '') && /Fake OCR text for page 2/.test(scanRow.ocrText ?? '') && /Fake OCR text for page 3/.test(scanRow.ocrText ?? ''));
  const pngRow = await prisma.studyMaterial.findUnique({ where: { id: mPng.id } });
  check('(q) a photo is read by OCR', pngRow.scannedPages === 1 && /Fake OCR text for page 1/.test(pngRow.ocrText ?? ''));
  const textRow = await prisma.studyMaterial.findUnique({ where: { id: mText.id } });
  check('(q) a text PDF needs no OCR', textRow.scannedPages === 0 && textRow.ocrText === null && textRow.pageCount === 3);
  const subjRow = await prisma.subject.findUnique({ where: { id: subj.id } });
  check('(q) one File Search store per subject', !!subjRow.fileSearchStore && (await prisma.studyMaterial.count({ where: { subjectId: subj.id, geminiDocument: null } })) === 0);

  await fac2('(q) another faculty member cannot read the material', 'GET', `/api/admin/materials/${mText.id}`, undefined, { expect: [403] });
  const otherList = (await fac2('(q) nor see it listed', 'GET', listUrl, undefined, { expect: [200] })).data;
  check('(q) materials are private to their owner', otherList.materials.length === 0);

  const params = { count: 7, mix: { EASY: 30, MEDIUM: 50, HARD: 20 }, types: ['MCQ_SINGLE', 'TRUE_FALSE', 'ASSERTION_REASON', 'SHORT_ANSWER', 'MCQ_MULTI'], bloom: ['REMEMBER', 'APPLY'], marks: 2, negativeMarks: 0.5, focus: { mode: 'topic', query: 'congestion control' }, topicId: null };
  await fac('(q) a bad mix is refused', 'POST', '/api/admin/ai/jobs', { subjectId: subj.id, materialIds: [mText.id], params: { ...params, mix: { EASY: 10, MEDIUM: 10, HARD: 10 } } }, { expect: [422] });
  await fac('(q) page focus needs exactly one PDF', 'POST', '/api/admin/ai/jobs', { subjectId: subj.id, materialIds: [mText.id, mDocx.id], params: { ...params, focus: { mode: 'pages', from: 1, to: 2 } } }, { expect: [422] });
  await fac('(q) pages past the end are refused', 'POST', '/api/admin/ai/jobs', { subjectId: subj.id, materialIds: [mText.id], params: { ...params, focus: { mode: 'pages', from: 2, to: 9 } } }, { expect: [422] });
  await fac2('(q) another faculty member cannot use the material', 'POST', '/api/admin/ai/jobs', { subjectId: subj.id, materialIds: [mText.id], params }, { expect: [403] });

  const job = (await fac('(q) start a topic-focused batch', 'POST', '/api/admin/ai/jobs', { subjectId: subj.id, materialIds: [mText.id, mScan.id], params }, { expect: [200] })).data;
  const done = await waitFor(async () => {
    const j = (await fac('(q) poll the batch', 'GET', `/api/admin/ai/jobs/${job.id}`, undefined, {})).data;
    return j.status === 'DONE' || j.status === 'FAILED' ? j : null;
  });
  check('(q) the batch finishes with exactly the drafts asked for', done?.status === 'DONE' && done.drafts.length === 7, JSON.stringify(done?.stats));
  check('(q) invalid model output is dropped and counted', (done?.stats?.dropped ?? 0) >= 1);
  check('(q) drafts carry the marks and a source', done.drafts.every((d) => d.payload.marks === 2 && d.payload.negativeMarks === 0.5 && d.source?.excerpt));
  check('(q) every quote was found in the material and its page corrected to where it really is', done.drafts.every((d) => d.source?.quote === 'exact' && d.source.page === 1), JSON.stringify(done.drafts.map((d) => [d.source?.quote, d.source?.page])));
  check('(q) a second reading ran and could not tell, so nothing is flagged', done.drafts.every((d) => d.source?.check === 'unclear'));
  check('(q) drafts cover the requested types', new Set(done.drafts.map((d) => d.payload.type)).size >= 4, JSON.stringify(done.drafts.map((d) => d.payload.type)));

  const pageJob = (await fac('(q) start a page-range batch', 'POST', '/api/admin/ai/jobs', { subjectId: subj.id, materialIds: [mText.id], params: { ...params, count: 2, focus: { mode: 'pages', from: 2, to: 3 } } }, { expect: [200] })).data;
  const pageDone = await waitFor(async () => {
    const j = (await fac('(q) poll the page batch', 'GET', `/api/admin/ai/jobs/${pageJob.id}`, undefined, {})).data;
    return j.status === 'DONE' || j.status === 'FAILED' ? j : null;
  });
  check('(q) page-range quotes are found inside the range', pageDone?.drafts.every((d) => d.source?.quote === 'exact' && d.source.page === 2), JSON.stringify(pageDone?.drafts.map((d) => [d.source?.quote, d.source?.page])));
  check('(q) a page-range batch works on one PDF', pageDone?.status === 'DONE' && pageDone.drafts.length === 2 && pageDone.drafts.every((d) => d.source?.materialId === mText.id));

  await fac2('(q) another faculty member cannot see the batch', 'GET', `/api/admin/ai/jobs/${job.id}`, undefined, { expect: [403] });
  await stu('(q) a student cannot see the batch', 'GET', `/api/admin/ai/jobs/${job.id}`, undefined, { expect: [401, 403] });
  const [d1, d2, d3, d4] = done.drafts;
  await fac2('(q) another faculty member cannot accept a draft', 'POST', `/api/admin/ai/drafts/${d1.id}/accept`, undefined, { expect: [403] });
  await stu('(q) a student cannot accept a draft', 'POST', `/api/admin/ai/drafts/${d1.id}/accept`, undefined, { expect: [401, 403] });

  const banked = (await fac('(q) accept a draft', 'POST', `/api/admin/ai/drafts/${d1.id}/accept`, undefined, { expect: [200] })).data;
  await fac('(q) accepting twice is refused', 'POST', `/api/admin/ai/drafts/${d1.id}/accept`, undefined, { expect: [409] });
  const q1 = await prisma.question.findUnique({ where: { id: banked.questionId }, include: { options: true } });
  check('(q) the AI thinking level is kept on the question', q1?.bloom === 'UNDERSTAND', String(q1?.bloom));
  check('(q) the accepted question is in the bank, marked AI', q1?.aiGenerated === true && q1.subjectId === subj.id && q1.marks === 2 && q1.active && !q1.adHoc);

  const edited = { ...d2.payload, text: 'Edited by the teacher: ' + d2.payload.text };
  const banked2 = (await fac('(q) edit then accept', 'POST', `/api/admin/ai/drafts/${d2.id}/accept`, { question: edited }, { expect: [200] })).data;
  check('(q) the edit is what reaches the bank', (await prisma.question.findUnique({ where: { id: banked2.questionId } })).text.startsWith('Edited by the teacher'));
  await fac('(q) an edit that breaks the question is refused', 'POST', `/api/admin/ai/drafts/${d3.id}/accept`, { question: { ...d3.payload, text: 'x' } }, { expect: [422] });

  const before = `${d3.payload.text} ${d3.payload.assertionText ?? ''}`;
  const regen = (await fac('(q) regenerate one draft', 'POST', `/api/admin/ai/drafts/${d3.id}/regenerate`, undefined, { expect: [200] })).data;
  check('(q) regenerating replaces it with a different question of the same difficulty', `${regen.payload.text} ${regen.payload.assertionText ?? ''}` !== before && regen.payload.difficulty === d3.payload.difficulty);
  await fac('(q) discard a draft', 'DELETE', `/api/admin/ai/drafts/${d4.id}`, undefined, { expect: [200] });
  await fac('(q) a discarded draft cannot be accepted', 'POST', `/api/admin/ai/drafts/${d4.id}/accept`, undefined, { expect: [409] });

  const all = (await fac('(q) accept all the rest', 'POST', `/api/admin/ai/jobs/${job.id}/accept-all`, undefined, { expect: [200] })).data;
  check('(q) accept-all takes every remaining draft', all.accepted === 4 && all.skipped === 0, JSON.stringify(all));
  const bankList = (await fac('(q) the bank lists them', 'GET', `/api/admin/questions?subjectId=${subj.id}&pageSize=100`, undefined, { expect: [200] })).data;
  check('(q) accepted drafts show in the bank as AI-drafted', bankList.questions.filter((qq) => qq.aiGenerated).length === 6);
  check('(q) drafts and AI routes are audited', (await prisma.auditLog.count({ where: { action: 'admin.ai_draft_accepted' } })) === 6 && (await prisma.auditLog.count({ where: { action: 'admin.material_uploaded' } })) === 4);

  // Nothing about drafts leaks to students: no student route mentions them.
  const dashS = await stu('(q) student dashboard', 'GET', '/api/student/dashboard', undefined, { expect: [200] });
  check('(q) no draft ids or excerpts reach a student', !done.drafts.some((d) => dashS.text.includes(d.id)) && !dashS.text.includes('Fake OCR'));

  // Meaning check on accept: the bank already has q1's text, so the same question again is stopped.
  const [p1] = pageDone.drafts;
  const twin = { ...p1.payload, text: q1.text };
  const stopped = await fac('(q) a repeat of a bank question is stopped on accept', 'POST', `/api/admin/ai/drafts/${p1.id}/accept`, { question: twin }, { expect: [409] });
  check('(q) the refusal names the question it repeats', stopped.text.includes('means the same'), stopped.text.slice(0, 200));
  await fac('(q) the teacher can add it anyway', 'POST', `/api/admin/ai/drafts/${p1.id}/accept`, { question: twin, allowSimilar: true }, { expect: [200] });

  // A quiz straight from a batch.
  const win = { startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() + 7200_000).toISOString() };
  await fac('(q) a quiz window that ends before it starts is refused', 'POST', `/api/admin/ai/jobs/${pageJob.id}/quiz`, { title: 'Bad window', durationMinutes: 20, addToBank: false, startsAt: win.endsAt, endsAt: win.startsAt }, { expect: [422] });
  await fac2('(q) another faculty member cannot build a quiz from the batch', 'POST', `/api/admin/ai/jobs/${pageJob.id}/quiz`, { title: 'Not mine', durationMinutes: 20, addToBank: false, ...win }, { expect: [403] });
  await stu('(q) a student cannot build a quiz from a batch', 'POST', `/api/admin/ai/jobs/${pageJob.id}/quiz`, { title: 'Not mine', durationMinutes: 20, addToBank: false, ...win }, { expect: [401, 403] });
  const aiBefore = await prisma.question.count({ where: { subjectId: subj.id, adHoc: false, aiGenerated: true } });
  const quizOnly = (await fac('(q) build a quiz-only quiz from a batch', 'POST', `/api/admin/ai/jobs/${pageJob.id}/quiz`, { title: 'AI quiz (not in bank)', durationMinutes: 20, addToBank: false, ...win }, { expect: [200] })).data;
  const qz1 = await prisma.quiz.findUnique({ where: { id: quizOnly.quizId }, include: { questions: { include: { question: true }, orderBy: { position: 'asc' } } } });
  check('(q) it is a draft fixed-paper quiz with the batch as its paper', qz1?.status === 'DRAFT' && qz1.sourceMode === 'FIXED' && qz1.questionCount === 2 && qz1.questions.length === 2 && qz1.totalMarks === 4, JSON.stringify(quizOnly));
  check('(q) a new question stays out of the bank, one already banked is reused', qz1.questions.filter((l) => l.question.adHoc).length === 1 && qz1.questions.some((l) => l.questionId === (qz1.questions.find((x) => !x.question.adHoc)?.questionId)));
  check('(q) quiz-only questions do not reach the bank', (await prisma.question.count({ where: { subjectId: subj.id, adHoc: false, aiGenerated: true } })) === aiBefore);

  const job3 = (await fac('(q) start a batch for a bank-and-quiz test', 'POST', '/api/admin/ai/jobs', { subjectId: subj.id, materialIds: [mText.id], params: { ...params, count: 4, types: ['MCQ_SINGLE'] } }, { expect: [200] })).data;
  const done3 = await waitFor(async () => {
    const j = (await fac('(q) poll that batch', 'GET', `/api/admin/ai/jobs/${job3.id}`, undefined, {})).data;
    return j.status === 'DONE' || j.status === 'FAILED' ? j : null;
  });
  // One of its drafts repeats a bank question word for word.
  await prisma.questionDraft.update({ where: { id: done3.drafts[0].id }, data: { payload: { ...done3.drafts[0].payload, text: q1.text } } });
  // Another has a quote that is nowhere in the material: it is flagged and held back.
  await prisma.questionDraft.update({ where: { id: done3.drafts[3].id }, data: { source: { ...done3.drafts[3].source, quote: 'missing' } } });
  const both = (await fac('(q) build a quiz that also adds to the bank', 'POST', `/api/admin/ai/jobs/${job3.id}/quiz`, { title: 'AI quiz (and bank)', durationMinutes: 15, addToBank: true, ...win }, { expect: [200] })).data;
  check('(q) new questions join the bank, a repeat stays on the quiz only', both.questions === 3 && both.toBank === 2 && both.quizOnly === 1 && both.repeats === 1 && both.held === 1, JSON.stringify(both));
  const qz2 = await prisma.quiz.findUnique({ where: { id: both.quizId }, include: { questions: { include: { question: true } } } });
  check('(q) the quiz holds all three, two of them also in the bank', qz2.questions.length === 3 && qz2.questions.filter((l) => !l.question.adHoc).length === 2);
  const heldAll = (await fac('(q) add-all leaves a flagged draft for review', 'POST', `/api/admin/ai/jobs/${job3.id}/accept-all`, undefined, { expect: [200] })).data;
  check('(q) a flagged draft is held back, not added', heldAll.accepted === 0 && heldAll.held === 1, JSON.stringify(heldAll));
  await fac('(q) the teacher can still accept a flagged draft after looking at it', 'POST', `/api/admin/ai/drafts/${done3.drafts[3].id}/accept`, undefined, { expect: [200] });
  check('(q) quizzes built from AI batches are audited', (await prisma.auditLog.count({ where: { action: 'admin.quiz_created', entityId: { in: [quizOnly.quizId, both.quizId] } } })) === 2);

  // Hand-written questions get the same meaning check as AI drafts.
  const handBody = { subjectId: subj.id, text: q1.text, type: 'MCQ_SINGLE', difficulty: 'EASY', marks: 1, negativeMarks: 0, options: [{ text: 'Yes', isCorrect: true }, { text: 'No', isCorrect: false }] };
  const refused = await fac('(q) a hand-written repeat of a bank question is refused', 'POST', '/api/admin/questions', handBody, { expect: [409] });
  check('(q) the refusal names the question it repeats', refused.text.includes('means the same'), refused.text.slice(0, 160));
  const twinQ = (await fac('(q) the teacher can add the repeat anyway', 'POST', '/api/admin/questions', { ...handBody, allowSimilar: true }, { expect: [200] })).data;
  await fac('(q) editing only the marks of a twin is not nagged', 'PATCH', `/api/admin/questions/${twinQ.questionId}`, { ...handBody, marks: 2 }, { expect: [200] });
  const banked2Text = (await prisma.question.findUnique({ where: { id: banked2.questionId } })).text;
  await fac('(q) rewording a question into a repeat is refused', 'PATCH', `/api/admin/questions/${twinQ.questionId}`, { ...handBody, text: banked2Text }, { expect: [409] });

  // Moving a quiz-only question into the bank later.
  const privateQ = qz1.questions.find((l) => l.question.adHoc).questionId;
  await fac2('(q) another faculty member cannot move my question to the bank', 'POST', `/api/admin/questions/${privateQ}/add-to-bank`, {}, { expect: [403] });
  await fac('(q) move a quiz-only question into the bank', 'POST', `/api/admin/questions/${privateQ}/add-to-bank`, {}, { expect: [200] });
  check('(q) it is now in the bank and still on the quiz', (await prisma.question.findUnique({ where: { id: privateQ } })).adHoc === false && (await prisma.quizQuestion.count({ where: { quizId: quizOnly.quizId, questionId: privateQ } })) === 1);
  await fac('(q) it cannot be added twice', 'POST', `/api/admin/questions/${privateQ}/add-to-bank`, {}, { expect: [409] });
  const quizView = (await fac('(q) the quiz shows which questions are in the bank', 'GET', `/api/admin/quizzes/${quizOnly.quizId}`, undefined, { expect: [200] })).data;
  check('(q) every question on it is now flagged as in the bank', quizView.questions.length === 2 && quizView.questions.every((qq) => qq.inBank === true));
  const repeatQ = qz2.questions.find((l) => l.question.adHoc).questionId;
  await fac('(q) a quiz-only repeat of a bank question is stopped', 'POST', `/api/admin/questions/${repeatQ}/add-to-bank`, {}, { expect: [409] });
  await fac('(q) unless the teacher insists', 'POST', `/api/admin/questions/${repeatQ}/add-to-bank`, { allowSimilar: true }, { expect: [200] });

  // The same template with other numbers is a different question, not a repeat.
  const delayBody = (km) => ({ subjectId: subj.id, text: `Compute the propagation delay of a copper link that is ${km} km long`, type: 'SHORT_ANSWER', difficulty: 'MEDIUM', bloom: 'APPLY', marks: 1, negativeMarks: 0, acceptedAnswers: ['x'] });
  const delay300 = (await fac('(q) a numeric question is added', 'POST', '/api/admin/questions', delayBody(300), { expect: [200] })).data;
  const delay600 = (await fac('(q) the same template with other numbers is not called a repeat', 'POST', '/api/admin/questions', delayBody(600), { expect: [200] })).data;
  const applyList = (await fac('(q) filter the bank by thinking level', 'GET', `/api/admin/questions?subjectId=${subj.id}&bloom=APPLY&pageSize=100`, undefined, { expect: [200] })).data;
  check('(q) a hand-set level can be filtered on', applyList.questions.some((qq) => qq.id === delay300.questionId) && applyList.questions.every((qq) => qq.bloom === 'APPLY'));
  await fac('(q) but the same numbers are', 'POST', '/api/admin/questions', delayBody(300), { expect: [409] });

  // Finding repeats already in the bank.
  const scan = (await fac('(q) scan the bank for repeats', 'GET', `/api/admin/subjects/${subj.id}/duplicates`, undefined, { expect: [200] })).data;
  const repeatGroup = scan.groups.find((g) => g.some((qq) => qq.id === q1.id));
  check('(q) the scan groups the repeats of one question together', !!repeatGroup && repeatGroup.some((qq) => qq.id === twinQ.questionId) && repeatGroup.some((qq) => qq.id === repeatQ), JSON.stringify(scan.groups.map((g) => g.length)));
  check('(q) the scan marks which are mine and counts quiz use', repeatGroup.every((qq) => qq.mine === true) && repeatGroup.find((qq) => qq.id === repeatQ).onQuizzes === 1);
  check('(q) the same template with other numbers is not grouped', !scan.groups.flat().some((qq) => qq.id === delay300.questionId || qq.id === delay600.questionId));
  check('(q) unrelated questions are not grouped', scan.groups.every((g) => g.length <= 4) && scan.scanned >= 8);
  const scan2 = (await fac2('(q) another faculty member can scan, but owns none of them', 'GET', `/api/admin/subjects/${subj.id}/duplicates`, undefined, { expect: [200] })).data;
  check('(q) the other faculty member sees them as not theirs', scan2.groups.flat().every((qq) => qq.mine === false));
  await stu('(q) a student cannot scan the bank', 'GET', `/api/admin/subjects/${subj.id}/duplicates`, undefined, { expect: [401, 403] });
  await fac2('(q) nor retire a repeat that is not theirs', 'DELETE', `/api/admin/questions/${twinQ.questionId}`, undefined, { expect: [403] });
  await fac('(q) retire the twin', 'DELETE', `/api/admin/questions/${twinQ.questionId}`, undefined, { expect: [200] });
  const scan3 = (await fac('(q) scan again', 'GET', `/api/admin/subjects/${subj.id}/duplicates`, undefined, { expect: [200] })).data;
  check('(q) a retired question no longer shows as a repeat', !scan3.groups.flat().some((qq) => qq.id === twinQ.questionId));

  // A CSV import says which rows look like repeats, and imports them anyway.
  const csv = [
    'question,optionA,optionB,optionC,optionD,correct,difficulty,topic,marks,explanation',
    `${q1.text},Yes,No,,,A,EASY,,1,`,
    'Zebras have black and white stripes on the savanna plains today,Yes,No,,,A,EASY,,1,',
    `${q1.text},Yes,No,,,A,EASY,,1,`,
  ].join('\n');
  const imp = (await fac('(q) import rows, two of them repeats', 'POST', '/api/admin/questions/import', { subjectId: subj.id, csv }, { expect: [200] })).data;
  check('(q) all three rows are imported', imp.imported === 3 && imp.rejected === 0, JSON.stringify(imp));
  check('(q) the repeats are reported by row, the unrelated row is not', Array.isArray(imp.repeats) && imp.repeats.map((r) => r.row).join() === '2,4' && imp.repeats.every((r) => r.message.includes('already in the bank')), JSON.stringify(imp.repeats));

  // Whole-material focus covers different parts of the material in each batch.
  const wholeJob = (await fac('(q) start a whole-material batch of 12', 'POST', '/api/admin/ai/jobs', { subjectId: subj.id, materialIds: [mText.id], params: { ...params, count: 12, types: ['MCQ_SINGLE'], focus: { mode: 'whole' } } }, { expect: [200] })).data;
  const wholeDone = await waitFor(async () => {
    const j = (await fac('(q) poll the whole-material batch', 'GET', `/api/admin/ai/jobs/${wholeJob.id}`, undefined, {})).data;
    return j.status === 'DONE' || j.status === 'FAILED' ? j : null;
  });
  check('(q) the whole-material batch finishes with drafts found in the material', wholeDone?.status === 'DONE' && wholeDone.drafts.length >= 10 && wholeDone.drafts.every((d) => d.source?.quote === 'exact'), JSON.stringify(wholeDone?.stats));
  check('(q) its questions come from different pages, not just the first', new Set(wholeDone.drafts.map((d) => d.source.page)).size >= 2, JSON.stringify([...new Set(wholeDone.drafts.map((d) => d.source.page))]));

  // A short-answer key that lacks another wording gets a suggestion the teacher can accept in one click.
  const saJob = (await fac('(q) start a short-answer batch', 'POST', '/api/admin/ai/jobs', { subjectId: subj.id, materialIds: [mText.id], params: { ...params, count: 2, types: ['SHORT_ANSWER'] } }, { expect: [200] })).data;
  const saDone = await waitFor(async () => {
    const j = (await fac('(q) poll the short-answer batch', 'GET', `/api/admin/ai/jobs/${saJob.id}`, undefined, {})).data;
    return j.status === 'DONE' || j.status === 'FAILED' ? j : null;
  });
  const sa = saDone.drafts[0];
  await prisma.questionDraft.update({ where: { id: sa.id }, data: { source: { ...sa.source, suggestedAnswer: 'another wording' } } });
  await fac('(q) add the suggested wording to the key', 'PATCH', `/api/admin/ai/drafts/${sa.id}`, { draft: { ...sa.payload, acceptedAnswers: [...sa.payload.acceptedAnswers, 'another wording'] }, topicId: '' }, { expect: [200] });
  const saAfter = (await fac('(q) read the draft again', 'GET', `/api/admin/ai/jobs/${saJob.id}`, undefined, { expect: [200] })).data.drafts.find((d) => d.id === sa.id);
  check('(q) the key now lists it and the suggestion is gone', saAfter.payload.acceptedAnswers.includes('another wording') && saAfter.source.suggestedAnswer === undefined, JSON.stringify(saAfter.source));

  await fac2('(q) another faculty member cannot delete the material', 'DELETE', `/api/admin/materials/${mDocx.id}`, undefined, { expect: [403] });
  await fac('(q) delete a material', 'DELETE', `/api/admin/materials/${mDocx.id}`, undefined, { expect: [200] });
  check('(q) a deleted material is gone', (await prisma.studyMaterial.count({ where: { id: mDocx.id } })) === 0);

  // The generation budget: 15 batches an hour per teacher (2 used above, plus 1 regenerate).
  let limited = false;
  for (let i = 0; i < 16 && !limited; i += 1) {
    const r = await fac('(q) generation rate limit', 'POST', '/api/admin/ai/jobs', { subjectId: subj.id, materialIds: [mText.id], params: { ...params, count: 1 } }, {});
    limited = r.status === 429;
  }
  check('(q) the generation budget is enforced', limited);
}

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

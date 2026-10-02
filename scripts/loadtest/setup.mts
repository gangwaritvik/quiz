// Creates N load-test students + one published FIXED quiz in the STAGING DB and
// mints sessions for them directly (no OTP traffic), writing them to OUT.
// Run: DATABASE_URL=$(node scripts/loadtest/staging-url.cjs) npx tsx --env-file=.env scripts/loadtest/setup.mts 300 <out.json>
// (--env-file only supplies AUTH_SECRET; the explicit DATABASE_URL in the environment wins.)
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

import { signAccessToken } from '../../src/lib/jwt';

const N = Number(process.argv[2] ?? 100);
const OUT = process.argv[3] ?? 'sessions.json';
const DURATION_MIN = Number(process.env.QUIZ_MINUTES ?? 10);
const prisma = new PrismaClient();

const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
if (db !== 'securequiz_staging') throw new Error(`refusing to run against ${db}`);

const author = await prisma.admin.findFirstOrThrow();
const subject = await prisma.subject.findFirstOrThrow({ where: { code: 'CS304' } });

const students = [];
for (let i = 1; i <= N; i += 1) {
  const roll = `LT${String(i).padStart(4, '0')}`;
  const user = await prisma.user.upsert({
    where: { email: `${roll.toLowerCase()}@loadtest.local` },
    update: {},
    create: {
      email: `${roll.toLowerCase()}@loadtest.local`, name: `Load ${roll}`, role: 'STUDENT',
      student: { create: { rollNumber: roll, department: 'Computer Science', section: 'LT' } },
    },
    include: { student: true },
  });
  students.push(user);
}

const mk = (text: string, extra: object) =>
  prisma.question.create({ data: { text, subjectId: subject.id, authorId: author.id, adHoc: true, ...extra } });
const qs = [
  await mk('LT: What does TCP stand for?', { type: 'MCQ_SINGLE', marks: 2, options: { create: [
    { text: 'Transmission Control Protocol', isCorrect: true, position: 0 },
    { text: 'Trivial Copy Protocol', position: 1 }, { text: 'Transfer Control Packet', position: 2 }] } }),
  await mk('LT: Default HTTP port?', { type: 'SHORT_ANSWER', marks: 1, acceptedAnswers: ['80'] }),
  await mk('LT: Explain the three-way handshake.', { type: 'LONG_ANSWER', marks: 5, maxWords: 300 }),
];
const now = Date.now();
const quiz = await prisma.quiz.create({
  data: {
    title: `Load test N=${N} ${new Date(now).toISOString()}`, subjectId: subject.id, authorId: author.id,
    status: 'PUBLISHED', sourceMode: 'FIXED', durationMinutes: DURATION_MIN, questionCount: 3, totalMarks: 8,
    startsAt: new Date(now - 60_000), endsAt: new Date(now + 2 * 3600_000),
    questions: { create: qs.map((q, position) => ({ questionId: q.id, position })) },
    assignments: { create: students.map((u) => ({ studentId: u.student!.id })) },
  },
});

const sessions = [];
for (const u of students) {
  const refresh = randomBytes(32).toString('base64url');
  const s = await prisma.deviceSession.create({
    data: {
      userId: u.id, tokenHash: createHash('sha256').update(refresh).digest('hex'),
      deviceHash: 'loadtest', deviceLabel: 'Load test', expiresAt: new Date(now + 8 * 3600_000),
    },
  });
  const at = await signAccessToken({ sub: u.id, sid: s.id, role: 'STUDENT', dev: 'loadtest' });
  sessions.push({ roll: u.student!.rollNumber, cookie: `sq_at=${at}; sq_rt=${refresh}`, deviceId: `lt-device-${u.student!.rollNumber}` });
}
writeFileSync(OUT, JSON.stringify({ quizId: quiz.id, sessions }));
console.log(`quiz ${quiz.id}, ${sessions.length} sessions -> ${OUT}`);
await prisma.$disconnect();

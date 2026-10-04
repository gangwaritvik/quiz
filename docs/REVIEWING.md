# Reviewing SecureQuiz

A guide for someone reading this code for the first time. It says what exists, how to run and check it, what has and has not been verified, and where a second pair of eyes would help most.

## State in one paragraph

SecureQuiz is a college exam platform (Next.js 15 App Router, React 19, Prisma 6, PostgreSQL). Students sit timed, server-authoritative exams; faculty build question banks and quizzes, mark answers, and review integrity reports. It also generates draft questions from teachers' study material with an LLM (Gemini, or a local Ollama model). It is a **working development build**: it has never been deployed and has never had real students. Much of it was written with an AI coding assistant (see the commit trailers), which is a good reason to read it critically.

## Run it in a few minutes

```bash
npm install
cp .env.example .env          # the defaults work with the bundled Postgres
# in .env, uncomment OTP_DEV_MODE="true" so login codes appear on screen (no mail provider needed)
docker compose up -d          # PostgreSQL on :5432
npx prisma migrate deploy && npm run db:seed
npm run dev                   # http://localhost:3000
```

Sign in with `anita.raghavan@college.edu` (faculty) or `23CSE001` (student); the one-time code is shown on the login screen. See the README for the seeded accounts and quizzes. AI generation stays hidden until you set `GEMINI_API_KEY` (a free key from Google AI Studio) or `AI_PROVIDER=ollama`.

## Checks, and what they cover

| Command | What it checks | Last result |
|---|---|---|
| `npm run typecheck` | TypeScript, strict | clean |
| `npx eslint .` | Lint | no warnings or errors |
| `npm test` | 449 unit tests (grading, scoring, timer maths, validation, AI rules, paper assembly, a mock Ollama) | all pass |
| `npm run build` | Production build | succeeds |
| `npm run test:e2e` | 489 HTTP-level checks against a production build and a throwaway database: the full exam flow, grading, cross-faculty isolation, result release, device binding, parallel start and submit, abuse cases, and the whole AI pipeline against a fake provider | all pass |

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests and the build. It has not run yet because the repo has not been pushed anywhere. The e2e suite is not in CI: it needs PostgreSQL and takes about three minutes. It was written on Windows. A macOS/Linux route is documented in `tests/e2e/README.md` but **has not been run** on those platforms.

## Not verified

- **The exam in two real browser windows.** Pause and resume, the offline answer queue, fullscreen and the weak-connection behaviour are covered by server-side tests and reasoning, not by a person running a live exam. `docs/MANUAL_EXAM_CHECKLIST.md` is the script for that and has not been completed.
- **Phones and narrow screens** have not been checked.
- **Any deployment.** `docs/DEPLOYMENT.md` and the README's "Before deploying" list are untested guidance.
- **Ollama with a real model.** Only a mock server.
- **The AI feature with many users.** It was tried by one person on a few documents, on Google's free tier.
- **Capacity.** `scripts/loadtest` exists, but treat how many simultaneous students it can serve as unmeasured.

## Where to start reading

| Area | Files |
|---|---|
| Exam lifecycle, clock, deadlines | `src/lib/exam.ts`, `src/lib/exam-guard.ts`, `src/app/api/exam/**` |
| Answer saving, offline queue | `src/lib/offline-queue.ts`, `src/components/exam/exam-client.tsx` |
| Grading | `src/lib/grading.ts` |
| Integrity score | `src/lib/integrity-engine.ts` |
| Auth, sessions, device binding | `src/lib/auth.ts`, `src/lib/session.ts`, `src/lib/otp.ts`, `src/middleware.ts` |
| Ownership checks (faculty isolation) | `src/lib/ownership.ts` |
| Media access control | `src/lib/media.ts`, `src/app/api/media/**` |
| AI generation | `src/lib/ai/*` (start at `jobs.ts`; `provider.ts` is the seam) |
| Schema and migrations | `prisma/schema.prisma`, `prisma/migrations/` |

More background: `README.md` (behaviour and the security model), `docs/HANDOFF.md` (technical handoff, one section per feature).

## Where I would most like a review

1. **The deadline rules.** The server owns the clock. Answers and a late submit are accepted for 60 seconds after the deadline (`SUBMIT_GRACE_MS`) so answers written before the buzzer can still arrive. Is that the right trade, and are there races between the answer write, the auto-submit sweep and `finalizeAttempt`?
2. **Authorisation.** Every admin route should check that the faculty member owns the quiz, material, job or draft. The pattern is in `ownership.ts`; a missed route would be a real bug.
3. **Answer secrecy.** The answer key must never reach a student before results are released. There is an e2e check that scans student responses for key fields; it deserves a second look.
4. **The integrity score.** It is meant as a risk indicator for human review. Network trouble is recorded but no longer scored. Are the other weights and caps defensible?
5. **Treating model output as untrusted.** AI questions are schema-validated, rendered through KaTeX and never as HTML, and the prompt tells the model to ignore instructions inside the material. Prompt injection from an uploaded file is reduced, not eliminated.
6. **In-process state.** Rate limiting, AI jobs and uploads live in the web process and on local disk. That is fine on one machine and wrong for several.

## Known gaps and decisions

- **Rate limiter is in process memory.** It must move to Redis or similar before running more than one instance.
- **Uploads are on local disk** (`UPLOAD_DIR`). A serverless or multi-server deployment needs object storage; the storage functions in `src/lib/media.ts` and `src/lib/ai/materials.ts` are the only code that touches the filesystem.
- **AI batches run in the web process.** A restart mid-batch loses the batch (it is marked failed after 10 minutes). A queue would be the real fix.
- **The free Gemini quota is shared across all teachers** and Google may use uploaded content on the free tier. There is a per-teacher limit but no global cap.
- **HTTPS is required** for camera, microphone and screen share (browsers refuse them on plain `http://` apart from localhost) and for session cookies in production.
- **Camera, microphone and screen share are presence checks only.** Nothing is recorded or uploaded, so faculty have no recorded evidence. This is deliberate and explained in the README.
- **Dependency audit.** `npm audit --omit=dev` reports 10 findings (1 moderate, 9 high). All are in build-time tooling (`postcss` inside Next, `braces` and `micromatch` through Tailwind 3, `deepmerge-ts` in the Prisma CLI), none in code that handles requests, but clearing them needs major upgrades (Next 16, Tailwind 4) that have not been tried.
- **Development OTP mode** returns the login code in the browser. It refuses to run when `NODE_ENV=production` unless an explicit override is set; the override exists so a local production build can be tried.
- **No licence file, no error monitoring, no structured logging** beyond `console` and the audit log table.

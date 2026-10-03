# SecureQuiz Handoff

This document is the short technical handoff for the SecureQuiz repository. It is written for the next developer or operator who needs to run, understand, and safely extend the application.

## 1. What this project is

SecureQuiz is a college examination platform with two roles:

- **Students** view assigned quizzes, sit timed exams, submit option/text/image answers, and review released results.
- **Faculty/admins** manage students, subjects, questions, quizzes, assignments, live attempts, manual grading, results, integrity reports, and audit history.

The application is server-authoritative. The browser provides the exam UI and reports observable events, but the server decides the paper, deadline, authorization, answer validity, score, and media access.

## 2. Technology and prerequisites

- Next.js `15.1.x` with the App Router
- React `19.x`, TypeScript `5.7.x`, Tailwind CSS, Radix UI, Framer Motion, Recharts, and Lucide
- Prisma `6.2.x` with PostgreSQL
- Node.js `20.6+` (Node 24 is the documented recommendation)
- Docker Desktop, if using the bundled PostgreSQL container
- Resend, only when OTP delivery must use email outside development

There is one deployable web service in this repository. PostgreSQL and uploaded files are external state and must be backed up separately.

## 3. Local setup

From the repository root:

```bash
npm install
copy .env.example .env
```

Edit `.env`. At minimum, set `DATABASE_URL`, `AUTH_SECRET`, and `HASH_PEPPER`. For local development, the values in `.env.example` work with the bundled database; uncomment `OTP_DEV_MODE="true"` to see codes on the login screen.

Start PostgreSQL:

```bash
docker compose up -d
```

Initialize and seed the database:

```bash
npm run db:push
npm run db:seed
```

Start the development server:

```bash
npm run dev
```

Open `http://localhost:3000`. The development seed prints the demo accounts. Development OTP mode also displays the code in the login flow. Never enable that mode in production.

### Day-to-day development loop

- Work with `npm run dev` (login codes show on the login screen when `OTP_DEV_MODE="true"`; this only works outside production builds).
- Before committing: `npm run typecheck && npm run lint && npm test`.
- After changing anything under `src/app/api`, `src/lib` or auth: `npm run test:e2e` (needs a fresh `npm run build`; it uses its own database and never touches the one in `.env`).
- `npm run build` + `npm start` is only for checking a production build. Do not run `npm run build` while a `npm start` server is using the same `.next` folder; stop it first.
- The deployment runbook (`docs/DEPLOYMENT.md`) is parked until you decide to go live.

## 4. Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Generate Prisma Client and build the production app |
| `npm start` | Serve the production build |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm run lint` | Run ESLint (Next.js core-web-vitals + TypeScript rules) |
| `npm test` | Unit tests (Node's built-in runner, no database needed), in `tests/unit/` |
| `npm run test:e2e` | End-to-end and abuse-case tests against a throwaway database and a second server on port 3001; see `tests/e2e/README.md` |
| `npm run db:create-faculty` | Create one faculty account without loading demo data |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:push` | Apply the schema directly, suitable for local development |
| `npm run db:migrate` | Create/apply a development migration |
| `npm run db:seed` | Recreate the development demo data |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:reset` | Destructively reset migrations and reseed the database |

There is currently no test script in `package.json` and no committed automated test suite was found. The shared grading and integrity logic is intentionally kept in pure modules so it can be tested without Prisma or the browser.

## 5. Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes in production | At least 32 random characters; signs access JWTs |
| `HASH_PEPPER` | Yes | Server-side pepper for OTP, IP, and device hashes |
| `OTP_DEV_MODE` | Development only | Off unless set to `true`; shows codes on the login screen. Ignored in production unless `OTP_DEV_MODE_ALLOW_IN_PRODUCTION=i-understand-this-is-insecure` is also set (insecure; local smoke tests and staging only) |
| `UPLOAD_DIR` | Recommended | Private storage root for question and answer images; defaults to `./var/uploads` |
| `RESEND_API_KEY` | Production email | Enables Resend OTP delivery |
| `OTP_FROM_EMAIL` | Production email | Sender identity, ideally on a verified domain |
| `GEMINI_API_KEY` | For AI questions | Free Google AI Studio key; without it the AI feature is hidden |
| `GEMINI_MODEL` | Optional | Defaults to `gemini-flash-latest` |
| `GEMINI_FALLBACK_MODEL` | Optional | Used when the main model stays overloaded; defaults to `gemini-flash-lite-latest` |
| `GEMINI_EMBED_MODEL` | Optional | Embedding model for the "same meaning" duplicate check; defaults to `gemini-embedding-001` |
| `AI_PROVIDER` | Tests only | `fake` answers instantly without calling Google (the e2e server sets it) |

Keep `.env` and uploaded media out of source control. `var/` is ignored. A database backup without the matching upload directory is incomplete because answer and question media are stored on disk, not in PostgreSQL.

## 6. Repository map

```text
src/app/                 Pages, layouts, and API route handlers
src/components/           Client UI grouped by auth, student, admin, exam, and shared concerns
src/hooks/                Client hooks, including timer and exam security reporting
src/lib/                  Server domain logic, auth, validation, grading, media, and utilities
prisma/schema.prisma      PostgreSQL data model
prisma/seed.ts            Repeatable development data generator
public/                   Manifest, service worker, and icons
var/uploads/              Private local media storage, ignored by Git
```

Important ownership boundaries:

- `src/lib/exam.ts`: paper generation, attempt lifecycle, server clock, answer persistence, submission.
- `src/lib/grading.ts`: pure grading rules shared by the exam engine and seed data.
- `src/lib/integrity-engine.ts`: pure integrity risk computation; it produces a review signal, not an accusation.
- `src/lib/integrity.ts`: persistence/recomputation around integrity scores.
- `src/lib/session.ts` and `src/lib/auth.ts`: session resolution and role authorization.
- `src/lib/media.ts`: byte-level image validation, metadata stripping, private storage.
- `src/lib/validation.ts`: Zod schemas for API request boundaries.
- `src/middleware.ts`: navigation convenience only; API handlers must still authorize independently.

## 7. User-facing route map

### Shared/auth

- `/login`: passwordless OTP sign-in.
- `/`: redirects to the authenticated role home or `/login`.

### Student

- `/dashboard`: assigned quiz overview.
- `/quizzes/[quizId]`: quiz details and start checks.
- `/exam/[attemptId]`: distraction-reduced exam surface with no site chrome.
- `/results/[attemptId]`: released result details.
- `/profile`: profile and device/session management.

### Admin

- `/admin`: overview dashboard.
- `/admin/students`: student management and import.
- `/admin/questions`: question bank (pick a subject first), editor, import, media, study material and AI generation.
- `/admin/questions/ai/[jobId]`: review AI drafts (accept, edit, regenerate, discard).
- `/admin/quizzes`: quiz list, creation, editing, assignment, and duplication.
- `/admin/grading`: manual marking queue.
- `/admin/results`: result release and analysis.
- `/admin/integrity`: integrity review queue and attempt timelines.
- `/admin/live`: live monitoring.

## 8. Core workflows

### Authentication

The user submits a college email or roll number to `/api/auth/otp/request`, then verifies a six-digit code at `/api/auth/otp/verify`. Codes are scrypt-hashed, expire after five minutes, are limited to five attempts, and are invalidated when a newer code is issued. Unknown accounts receive the same external response as known accounts.

A successful login creates a database-backed `DeviceSession`. The access JWT is short-lived (20 minutes); the refresh cookie maps to a hashed opaque token and is revalidated against PostgreSQL on every session lookup. Revoking the database session takes effect immediately.

### Quiz and exam lifecycle

1. Faculty creates a `POOL` quiz or a `FIXED` quiz and assigns students.
2. A student can start only when assigned, published, and inside the quiz window.
3. `POOL` questions are sampled server-side per attempt with difficulty backfill and cryptographic shuffling.
4. Each attempt stores a frozen `AttemptQuestion` paper and option order.
5. Every answer save, heartbeat, event, and submit is authorized against that attempt and student.
6. The server deadline is stored as `expiresAt`; late writes are rejected and expired attempts are finalized.
7. Automatic answers are graded immediately. descriptive and image answers remain provisional until faculty grading.
8. Time extensions (`src/lib/time-extension.ts`): faculty can set extra minutes for a student before they start (quiz detail > Extra time, `QuizAssignment.extraMinutes`) or add time to a running attempt (Live exams > Add time, `POST /api/admin/attempts/:id/extend`). Both move only the server deadline: `expiresAt = min(start + duration + extra, endsAt + extra)`. Caps are 120 minutes per grant and 180 per attempt. `Quiz.maxExtensionMinutes` only ever rises, and scores stay hidden until `endsAt + maxExtensionMinutes`.

### Running an exam (live controls)

Faculty controls on **Live exams**: add time, pause/resume one student (the server freezes the clock and refuses answer writes while paused; `pausedAt`), message everyone sitting a quiz (`QuizNotice`, delivered on the heartbeat), and let a student back in after a crash. Students' unsent answers are kept in `localStorage` with a growing sequence number (`src/lib/offline-queue.ts`) and replayed when the connection returns; the server ignores stale replays via `Answer.clientSeq`. A pause nobody ends runs out after `MAX_PAUSE_MS` (one hour, `src/lib/time-extension.ts`): `resumeOverlongPauses` resumes it from the sweep and from the student's next heartbeat, giving back exactly that hour. `docs/MANUAL_EXAM_CHECKLIST.md` is the two-window check for the parts automated tests cannot reach.

### Quiz view and marking

The quiz view has Attempts, Assigned (editable, by student or section), Questions, Extra time and Item analysis tabs. Quiz-wide marking (`negativeMarkingPct`, `multiPartialCredit`) overrides per-question settings when set. A faculty member can grant one student another attempt at a single-attempt quiz (`QuizAssignment.extraAttempts`, `src/lib/attempt-policy.ts`); class averages count each student's best attempt. Students can ask for a released result to be re-checked (`ResultAppeal`); faculty answer from **Appeals** and may change marks, including on auto-graded answers.

### AI question generation

In a subject's bank a teacher uploads study material (PDF, DOCX, PPTX, JPG/PNG, up to 25 MB). Our copy stays in `UPLOAD_DIR/materials`. PDF pages without a text layer, and photos, are read by Gemini (OCR) into page-marked text (`StudyMaterial.ocrText`). The material is then indexed into the subject's Gemini File Search store (`Subject.fileSearchStore`, one per subject, filtered by `material_id`). "Generate with AI" starts a `GenerationJob` (count, difficulty mix, types, Bloom's levels, marks, focus: whole / topic / page range of one PDF). It runs in-process and writes `QuestionDraft`s that passed the same validation as hand-written questions and are not near-duplicates of the bank. Nothing reaches students until a teacher accepts a draft; accepted questions carry `aiGenerated`. Code: `src/lib/ai/*` (pure logic in `question-generation.ts` and `material-text.ts`; `provider.ts` is the seam, with `gemini.ts` and `fake-provider.ts`). Materials and jobs are private to their owner.

### Results and integrity

`releaseResults` controls score visibility. `releaseAnswers` independently controls answer-key and explanation visibility. Integrity signals are timestamped events aggregated into a score and status for human review; they are not an automatic academic verdict. Manual grading and score changes are audited.

## 9. Database model at a glance

The main relationships are:

```text
User -> Student or Admin
User -> OtpChallenge, DeviceSession, AuditLog, MediaAsset
Subject -> Topic, Question, Quiz
Question -> Option, QuizQuestion, AttemptQuestion, MediaAsset
Quiz -> QuizQuestion, QuizAssignment, QuizAttempt
QuizAttempt -> AttemptQuestion, Answer, ExamEvent, IntegrityScore, IntegrityReview
Answer -> AnswerOption, AnswerAttachment
```

Question types are `MCQ_SINGLE`, `MCQ_MULTI`, `TRUE_FALSE`, `ASSERTION_REASON`, `SHORT_ANSWER`, `LONG_ANSWER`, and `IMAGE_ANSWER`. The schema preserves answer keys and faculty rubrics in PostgreSQL, but student payload queries explicitly select only fields safe for that session.

## 10. Security and production notes

- Put the app behind HTTPS. Production cookies become `Secure` automatically.
- Set strong, different random values for `AUTH_SECRET` and `HASH_PEPPER`.
- Configure a verified Resend sending domain before real OTP delivery. In production, a missing `RESEND_API_KEY`/`OTP_FROM_EMAIL` or a `resend.dev` sender makes code requests fail with a 503 rather than silently dropping codes.
- Leave `OTP_DEV_MODE` and `OTP_DEV_MODE_ALLOW_IN_PRODUCTION` unset in production; with both set, anyone can sign in as anyone.
- OTP rate limits are per account (5 requests / 10 verifies per 15 minutes); the per-IP limit is a coarse guard sized for a campus behind one NAT address. The app must only be reachable through the reverse proxy, which supplies `X-Real-IP`.
- Keep `UPLOAD_DIR` private and persistent. Do not mount it as a public web directory.
- The current rate limiter is in-process. Multiple app instances require a shared implementation, such as Redis, in `src/lib/rate-limit.ts`.
- The current upload store is local filesystem storage. For multiple instances or managed hosting, replace it with private object storage while preserving relationship-based authorization.
- The CSP and security headers are defined in `next.config.mjs`. Camera and microphone access are same-origin only.
- The anti-cheating signals are evidence for review, not proof of misconduct. They have documented tolerance and neutral-event rules in `src/lib/integrity-engine.ts`.
- Before production, establish a retention policy for audit logs, exam events, answer images, and device metadata.
- Do not use `npm run db:reset` against a shared or production database.

## 11. Handoff checklist

- [ ] Provision PostgreSQL 14+ and set `DATABASE_URL`.
- [ ] Generate and store production `AUTH_SECRET` and `HASH_PEPPER` in a secret manager.
- [ ] Configure a verified Resend domain and `OTP_FROM_EMAIL`.
- [ ] Choose persistent private storage for `UPLOAD_DIR`, or implement an object-storage adapter.
- [ ] Run migrations with `npm run db:migrate` in the deployment process.
- [ ] Run `npm run build` and `npm run typecheck` in CI.
- [ ] Add automated tests for grading, exam deadlines, authorization, media access, and result-release gates before major feature work.
- [ ] Define database/media backup and restore procedures together.
- [ ] Review the current in-process rate limiter before scaling beyond one instance.

## 12. Verification snapshot

At the time this handoff was prepared, `npm run typecheck` completed successfully. No automated test command is defined in the project manifest. The repository analysis detected one JavaScript/TypeScript Next.js service with Prisma; deployment should be treated as a web service plus PostgreSQL plus private persistent media storage.

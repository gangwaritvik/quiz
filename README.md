# SecureQuiz

> **Reviewing this code?** Start with [`docs/REVIEWING.md`](docs/REVIEWING.md): what is built, what has and has not been verified, and where a second pair of eyes would help most.

A college examination platform built so that the parts that matter — which
questions a student sees, how long they have, and what they scored — are decided
on the server and never in the browser.

Two roles: **students** sit examinations, **faculty** author them, invigilate
live, and review integrity reports.

For a technical handoff, see [docs/HANDOFF.md](docs/HANDOFF.md). It covers the
repository map, environment variables, route inventory, data flow, operations,
production caveats, and the current verification status.

---

## Getting started

**Requirements:** Node 20.6+ (Node 24 recommended) and PostgreSQL 14+.

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env          # then edit AUTH_SECRET and HASH_PEPPER

# 3. Database (docker compose up -d starts one matching .env.example)
npm run db:push
npm run db:seed

# 4. Run
npm run dev                   # http://localhost:3000
```

The seed prints the accounts it created. In development the login screen shows
the one-time code on screen, clearly marked, so no mail provider is needed:

| Account | Sign in with |
|---|---|
| Faculty | `anita.raghavan@college.edu` |
| Student | `23CSE001` |
| Student with integrity signals to review | `23CSE008` |

Two quizzes are open immediately: **Unit Test 1** (multiple choice) and
**Assignment 1 — Applied Problems**, which carries one question of every other
type — multiple select, short answer with a numeric tolerance, assertion and
reason, a descriptive answer and a diagram to photograph. Sit the second, then
sign in as faculty and open **Marking** to mark what the server could not.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (`tests/unit`) |
| `npm run test:e2e` | HTTP-level end-to-end suite against a production build and a throwaway database (see `tests/e2e/README.md`) |
| `npm run db:push` | Sync the schema without a migration |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Reset and repopulate demo data |
| `npm run db:studio` | Prisma Studio |

---

## The security model

The frontend is treated as hostile. It displays questions, collects answers,
shows a countdown and reports what the browser can observe — nothing more. Every
decision is re-made on the server.

| Decision | Where it is made |
|---|---|
| Who you are | `lib/session.ts` — server-side session re-validated on every request |
| What you may open | `lib/auth.ts` + per-route ownership checks |
| Which questions you get | `lib/exam.ts` → `buildQuestionPaper` |
| How much time is left | `lib/exam.ts` → `remainingTime`, anchored to `expiresAt` |
| Whether an answer counts | `lib/exam.ts` → `saveAnswer`, checked against the deadline |
| What kind of answer a question takes | `lib/exam.ts` → `saveAnswer`, from the question's own type |
| What you scored | `lib/grading.ts` → `gradeAnswer` |
| Whether an attempt looks unusual | `lib/integrity-engine.ts` |
| Whether you may see an uploaded image | `api/media/[assetId]`, by relationship |

---

## Building a quiz

Two ways to compose a paper, chosen on the create form.

**From the question bank (`POOL`).** Name a subject, a size and a difficulty
mix. The server draws that many questions *per student, at exam time*, so no two
papers are necessarily the same. Nothing is fixed until a student starts.

**Written here (`FIXED`).** Type the questions straight into the form and
everyone sits the same paper, in the order written. Nothing needs to be in the
bank first.

Questions written this way are ordinary `Question` rows carrying `adHoc: true`.
That matters twice over: marking, results and the grading queue treat them
identically to bank questions with no special cases, while the flag keeps them
out of the bank's listing and out of pool selection — otherwise a quick Friday
quiz would quietly pollute the pool every future generated paper draws from.

A fixed paper's size and worth are computed from the questions actually written.
A client claiming a different `questionCount` is ignored, not trusted.

### Editing a paper after the fact

The **Questions** tab on a quiz shows the written paper with its answer key, and
offers to edit it — but only until the first student has been served it. After
that the paper is frozen, because the alternative is not merely untidy:

- a student's recorded choice is a foreign key to a specific `Option` row
  (`onDelete: SetNull`), so deleting an option would blank out what they
  actually answered;
- `score` and `maxScore` are computed at submission against the marks as they
  stood, so changing marks later leaves a stored total that no longer follows
  from the paper;
- the database refuses outright — `AttemptQuestion.question` is
  `onDelete: Restrict` — so a late edit would fail halfway through regardless.

The rule is therefore "has anyone been served this paper?", not draft-versus-
published: a published quiz nobody has started is still safe to edit. Faculty
are told to duplicate the quiz instead. Replacing a paper also sweeps any image
the new version no longer references, so a dropped diagram does not outlive the
only thing that could authorise reading it.

## Question types

Seven types, in two families: those the server marks, and those a person marks.
Every one of them can be written either into the bank or straight onto a quiz.

| Type | Answered with | Marked by |
|---|---|---|
| Multiple choice | one option | server |
| Multiple select | several options, optional partial credit | server |
| True / False | a fixed two-option set | server |
| Assertion & Reason | the standard five-option set | server |
| Short answer | typed text, matched against accepted answers | server |
| Descriptive | typed prose | faculty |
| Image upload | photographs of written work | faculty |

**Multiple select** scores all-or-nothing by default and proportionally when
partial credit is enabled — but selecting *any* incorrect option always scores
the negative mark, or a student could tick every box and collect partial credit
on every question.

**Short answers** are compared after trimming, collapsing repeated whitespace
and (by default) folding case. Nothing more: an over-eager normaliser marks
wrong answers correct, which is a far worse failure in an examination than
asking faculty to list two accepted spellings. A numeric tolerance can be set
instead, so `3.14` satisfies an expected `3.14159`.

**Assertion & Reason** and **True / False** carry a prescribed option order and
are never shuffled, even when the quiz randomises options. The five A–R options
are identical on every such question, so their order reveals nothing — while
randomising them breaks the convention students are taught, that "(A)" means
both statements true with R explaining A.

### Marking what the server cannot

Descriptive and image answers go to `/admin/grading`. Until they are marked they
contribute **nothing** to the score, and the attempt is reported to the student
as **provisional** with a count of what is outstanding — rather than showing a
total that is guaranteed to move. Marking is audited and written to the
attempt's own event timeline, so a score that changes after release is always
traceable to a person and a time.

### Mathematics

Question text, options, assertions, reasons and explanations may contain LaTeX
between `$…$` (inline) or `$$…$$` (display), typeset by KaTeX.

The parser in `lib/math.ts` splits prose from mathematics; only KaTeX's own
output reaches `dangerouslySetInnerHTML`, and prose becomes ordinary React text
nodes. KaTeX runs with `trust: false`, which disables `\href`, `\url` and
`\includegraphics`. So although faculty author this content, a crafted question
cannot inject markup or fetch remote resources into a student's exam.

### Images

Faculty can attach a diagram to a question or to an individual option; students
can photograph written work for image-answer questions.

- The declared content type is never trusted — the real format is read from the
  bytes, and a file that does not parse as PNG, JPEG or WebP is rejected.
- **Metadata is stripped before storage.** A phone photograph of handwritten
  working carries EXIF GPS, which is effectively the student's home address. An
  examination platform has no need for it, so it never reaches disk.
- Files are stored under `UPLOAD_DIR`, outside `public/`, under server-generated
  random names, and are served only through `/api/media/[assetId]`, which
  authorises by *relationship*: faculty may read any asset, a student may read a
  question image only if it is on a paper they were served, and an answer image
  only if it is their own. A leaked asset id is not enough to view another
  student's work.
- Opening a file picker blurs the window without hiding the page. That blur is
  still recorded and still appears on the timeline, but it is annotated and not
  scored — otherwise a question that asks for a photograph would cost the
  student integrity points for doing as it asked.

### Authentication

Passwordless one-time codes. Students never create a password, so there is none
to share, reuse or phish.

- Codes are 6 digits from `crypto.randomInt`, scrypt-hashed with a server-side
  pepper, valid for 5 minutes, capped at 5 attempts, and invalidated when a new
  one is issued.
- A **short-lived JWT** (20 minutes) is the access token; a separate opaque
  **refresh token** backs a `DeviceSession` row. Every request re-checks that row,
  so revoking a session takes effect immediately rather than at token expiry.
- `middleware.ts` routes by role at the edge, but it is a convenience — every API
  route independently re-authorises against the database.
- Requesting a code for an account that does not exist returns exactly the same
  response as one that does, so the endpoint cannot enumerate student IDs.

### Answer secrecy

`Option.isCorrect`, `Question.explanation`, `Question.acceptedAnswers` and
`Question.modelAnswer` are never selected into a payload that reaches a student
session. This is enforced by the `select` clauses in `getAttemptPaper`, not by
filtering after the fact — there is nothing to strip. The accepted answers for a
short-answer question *are* its answer key, and the model answer is rubric for
whoever marks the paper; neither is sent to a student even once answers are
released.

Result release has two independent gates: `releaseResults` controls the score,
`releaseAnswers` controls the key. With the key withheld, **per-question
correctness is withheld too** — a student knows which option they chose, so
"you got Q3 right" *is* the answer to Q3 and can be passed to students who have
not yet sat the paper. Only aggregate counts and topic percentages are shown.

Hand-marked answers are the exception, and deliberately so: a student's own
prose, their uploaded pages and their marker's feedback carry no option key that
could be shared, so those are shown as soon as results are released. The model
answer is not.

### Question randomisation

Each attempt gets its own frozen paper (`AttemptQuestion`), selected server-side
from the configured pool with a Fisher–Yates shuffle over `crypto.randomInt`:
random question order, random option order per student, and a configurable
easy/medium/hard split that backfills from the wider pool rather than silently
serving fewer questions. Two students sitting the same quiz receive different
valid papers.

### The exam clock

`expiresAt` is computed once at attempt creation from the server clock, capped by
the quiz window, and is never extended by anything the client sends. The browser
interpolates between syncs only so the digits tick smoothly; every heartbeat and
every save re-anchors it. Answers arriving after the deadline are refused and the
attempt is auto-submitted.

### Anti-cheating — and its honest limits

The client records tab switches, window blur/focus, fullscreen exits, copy /
paste / cut, context menu, print, restricted shortcuts, network drops, unusual
resizes and camera availability. The server records what only it can know:
multiple active sessions, device mismatch, missed heartbeats, auto-submission.

**These measures do not make cheating impossible, and this project does not
claim otherwise.** A determined student can disable JavaScript, use a second
physical device, or photograph the screen. What the system provides is friction
against casual shortcuts and an honest, timestamped record for a human to read.

Client-reported events are constrained to the types a browser can legitimately
observe, so a student cannot inject `MULTIPLE_SESSION` or `ATTEMPT_SUBMITTED` to
muddy their own timeline. Client timestamps are stored for forensics but never
used for ordering — `occurredAt` is the server clock.

### The integrity score

A **risk indicator for human review, never a verdict.** Every signal it consumes
has an innocent explanation, so the engine is deliberately forgiving: the first
occurrence of a low-severity signal is often tolerated outright, repeats grow
slowly, and each signal is capped.

| Band | Meaning |
|---|---|
| 85–100 | Normal |
| 60–84 | Review recommended |
| below 60 | High risk |

Faculty see the score beside its full derivation and the raw timeline, with the
caveat printed next to the number rather than buried in a footnote. Reviews are
recorded as a separate audit trail; the computed score is never overwritten.

### Camera proctoring

Optional, per quiz. The stream stays on the device — **no video, image or audio
is uploaded or stored.** Only availability is reported: permission lost, stream
stopped.

Face detection is deliberately **not** implemented. A browser-side model would
produce a stream of false positives (a student looking at scratch paper, poor
lighting, a sibling walking past) that would land in someone's integrity report
looking like evidence. Where a college needs face presence, it belongs in a
reviewed, consented pipeline — not an unaudited heuristic here.

### Other controls

CSRF via `SameSite=Lax` cookies plus an Origin check on every mutation · rate
limiting on OTP, answers, events and admin writes · Zod validation at every API
boundary · role-based access with per-resource ownership checks (IDOR) · secure
cookies and HSTS in production · CSP, `X-Frame-Options: DENY` and a restrictive
`Permissions-Policy` · audit logging of every privileged action · UTC timestamps
throughout.

---

## AI question generation

Teachers can upload study material (PDF, Word, PowerPoint, or photos of notes) in a subject's question bank and have an LLM draft questions from it: choose the focus (whole material, a topic, or a page range), how many, the difficulty mix, question types, thinking levels and marks. Every question is a **draft** that a teacher reviews, edits, regenerates or discards before it enters the bank, so nothing AI-written reaches a student unreviewed.

Around that: scanned pages are read by the model (OCR); each draft's source quote is checked against the material's own text and the answer is re-derived from that page, flagging what disagrees; questions that mean the same as one already in the bank are caught by meaning (embeddings), not just wording, with a "Find repeats" scan for existing banks; a batch can become a quiz directly; and a fixed paper can be built from the bank by difficulty mix and topic spread.

It is off until a provider is configured: a free `GEMINI_API_KEY` (Google AI Studio), or `AI_PROVIDER=ollama` for a model on your own machine. Settings are in `.env.example`; the design and limits are in `docs/HANDOFF.md`. Note that on Google's free tier uploaded material may be used to improve its products.

## Project structure

```
prisma/
  schema.prisma           Data model — see "Database" below
  seed.ts                 Realistic demo college
src/
  app/
    (student)/            Student shell: dashboard, quizzes, results, history, profile
    admin/                Faculty console: quizzes, bank, students, live, marking,
                          results, integrity
    exam/[attemptId]/     The exam — no site chrome, deliberately
    api/                  Route handlers; every one re-authorises
    api/media/[assetId]/  Authorised image reads — nothing is served by URL alone
  components/
    exam/                 Timer, navigator, question panel, answer inputs, camera
    admin/                Console screens, charts, dialogs, marking queue
    admin/instant-question-builder.tsx
                          Writing a paper inline on the quiz form
    student/              Dashboard, quiz cards, results
    shared/math-text.tsx  KaTeX rendering for authored text
    ui/                   shadcn/ui primitives
  hooks/
    use-exam-timer.ts     Server-anchored countdown
    use-exam-security.ts  Browser event detection and batching
    use-security-checks.ts Pre-exam readiness
  lib/
    exam.ts               Paper generation, clock, answer persistence
    grading.ts            Marking rules per question type — pure, no DB
    exam-guard.ts         The choke point every in-exam request passes
    media.ts              Upload validation, metadata stripping, storage
    math.ts               Splits prose from LaTeX — pure, no renderer
    integrity-engine.ts   Scoring rules — pure, no DB
    integrity.ts          Persistence for the above
    session.ts            Sessions and device binding
    otp.ts / crypto.ts    Passwordless auth
    api.ts                Response envelope, CSRF, validation
```

`grading.ts`, `math.ts` and `integrity-engine.ts` are free of Prisma and of
`server-only` on purpose: the seed script imports them directly, so demo data is
marked and scored by exactly the code that runs in a live exam.

### Database

Prisma models: `User`, `Student`, `Admin`, `OtpChallenge`, `DeviceSession`,
`Subject`, `Topic`, `Question`, `Option`, `Quiz`, `QuizQuestion`,
`QuizAssignment`, `QuizAttempt`, `AttemptQuestion`, `Answer`, `AnswerOption`,
`AnswerAttachment`, `MediaAsset`, `ExamEvent`, `IntegrityScore`,
`IntegrityReview`, `AuditLog`.

`QuizQuestion` holds the written paper of a `FIXED` quiz, in order. It is empty
for pooled quizzes, which have no paper until a student starts one — their
`AttemptQuestion` rows are the first time a paper exists at all.

Which column on `Answer` holds the response depends on the question's type —
`selectedOptionId` for single choice, the `AnswerOption` join for multiple
select, `textResponse` for written answers, `AnswerAttachment` for uploads. The
join table exists rather than an array column so a foreign key still guarantees
every stored choice is a real option on that question.

Hot query paths are indexed (`quiz_attempts` by quiz/student/status,
`exam_events` by attempt and time, `questions` by subject/difficulty). Uniqueness
is enforced in the database, not only in code: one answer per attempt-question,
one attempt per quiz/student/attempt-number, one assignment per quiz/student.
All timestamps are `timestamptz` written from the server clock.

---

## Design

Grey page, white panels and one blue for actions and links. Text is IBM Plex
Sans; codes, timers and roll numbers use IBM Plex Mono. **Green** confirms,
**amber** warns and **red** alerts; they are not used for decoration. Tokens
live in `src/app/globals.css`, with a light and a dark theme, and every text
colour pair is at least 4.5:1 in both. Charts carry direct labels and a "View as
table" fallback, so no reading depends on colour alone.

Motion is limited to dialogs, menus, toasts and reordering questions in the
builder. The exam screen does not animate between questions.

### Accessibility

Keyboard navigable throughout with a single unmistakable focus ring; `Alt+←/→`
moves between questions during an exam. Status is always conveyed by icon and
text as well as colour. The question navigator announces each question's state to
screen readers. The countdown announces at minute granularity, escalating to
assertive under one minute, rather than shouting every second.

### Responsive

Desktop is the supported exam environment; small screens get a dismissible
advisory rather than a hard block, since a student may only have a phone to
check their timetable. Tablets remain fully usable.

### PWA

`manifest.webmanifest` plus a deliberately narrow service worker that caches only
the static shell. It never caches `/api` or `/exam` — a cached timer or a stale
question paper would be a correctness bug, not an optimisation.

---

## Before deploying

1. Set `AUTH_SECRET` and `HASH_PEPPER` to distinct 32+ character random values.
   The app refuses to start in production without them.
2. `deliverOtp()` (`src/lib/otp.ts`) sends real email via Resend. Verify a
   sending domain at resend.com/domains and point `OTP_FROM_EMAIL` at it —
   until then the default `onboarding@resend.dev` sender can only reach the
   email address the Resend account itself was signed up with, not students.
   Development OTP mode is refused outright when `NODE_ENV=production`,
   regardless of `OTP_DEV_MODE`.
3. Terminate TLS in front of the app — cookies are `Secure` in production, so
   plain HTTP will not hold a session.
4. Back `src/lib/rate-limit.ts` with Redis if you run more than one instance; the
   counters are currently in process memory. On a serverless host this matters
   more than it sounds: each instance keeps its own counter, so the effective
   limit is the configured one multiplied by however many instances are warm.
5. Run `prisma migrate deploy` — the schema is versioned from `0_init`. Use
   `db:migrate` when changing the schema; `db:push` is for scratch databases
   only, and will not record what it did.
6. Back up `UPLOAD_DIR` alongside the database. Uploaded answer sheets live on
   disk with only their metadata in Postgres, so the two are useless apart.
   **A serverless host has no persistent disk**, so uploads must move to object
   storage before deploying to one — otherwise every photographed answer is lost
   at the next deploy. `storeUpload`, `readAssetBytes` and `deleteAsset` in
   `src/lib/media.ts` are the only three functions that touch the filesystem.

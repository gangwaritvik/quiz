# Two-window exam check

The parts the automated tests and the in-app browser cannot reach: pause and
message screens, offline saving, and fullscreen coming back after a file
picker. About 15 minutes. Development only: sign-in codes appear on screen
because `OTP_DEV_MODE` is on.

## Setup

1. App on <http://localhost:3000>.
2. **Window A (faculty):** a normal Chrome window, sign in as
   `anita.raghavan@college.edu`.
3. **Window B (student):** an Incognito window (separate session), sign in as
   `23CSE001` (any seeded student works).
4. In A, make a quiz that is open right now: window already started and ending
   in a few hours, duration 30 minutes, **Fullscreen required** on, assigned to
   `23CSE001`. Include at least one multiple-choice question, one short answer,
   and one **Image answer** question (needed for step 4). Publish.
5. In B, open the quiz, accept the rules, start it. Allow fullscreen.

In A, open **Live Exams** and pick the quiz. `23CSE001` should show as sitting.

## 1. Message students

- A: **Message students**, type "Please check question 2", send.
- B (within about 20 seconds): a strip with the message appears, the exam stays
  usable, and it does not appear a second time after dismissing.
- Pass: shown once, dismissible, no effect on the timer or answers.

## 2. Pause and resume

- B: note the timer (say 28:40) and type a short answer.
- A: on the student's row open **More**, choose **Pause**. The row shows a
  paused badge.
- B (within about 20 seconds): the paper is covered by "Your exam is paused", the timer
  is frozen, and nothing can be typed or clicked behind the cover.
- Wait 1 minute. B's timer must not have moved.
- A: **More**, **Resume**.
- B: the cover goes away and the timer continues from where it was (about
  28:40, not 27:40). Earlier answers are still there.
- Pass: frozen while paused, exact time back on resume, answer typed before the
  pause is kept.

## 3. Offline saving

- B: open DevTools, Network tab, set throttling to **Offline**.
- Type a short answer and pick a multiple-choice option. A yellow bar says
  the connection was interrupted and the answers are kept on this device,
  rather than an error.
- Reload the tab while still offline (or close and reopen it, then go back
  online just enough to load the page). Both answers must still be there.
- Set throttling back to **No throttling**. A "Connection restored" message
  appears and within about 20 seconds the answers sync.
- A: open the student's attempt answers (or check the Live row); the answers
  are there.
- Pass: nothing lost across offline typing and a reload, and everything syncs
  after reconnecting.
- Also try: go offline, click **Submit**. It must wait and tell the student
  rather than submitting with missing answers; go online and it completes.

## 4. File picker does not count as cheating

- B: on the Image answer question, use the upload control and pick a photo.
  The system file dialog takes the page out of fullscreen.
- After choosing the file (or cancelling), fullscreen should return on its own
  or after one click, and the "you left fullscreen" warning should not
  escalate.
- A: open the student's integrity report afterwards. Exits tagged as a file
  picker are forgiven up to the allowance (2 + 2 per upload); the integrity
  score should stay Normal.
- Then leave fullscreen with Escape three or four times with no upload. Those
  must count and the score should drop.
- Pass: uploads are free within the allowance, plain exits still count.

## 5. Automatic resume after a long pause

Pauses end by themselves after 60 minutes (the student gets back exactly an
hour). To see it without waiting, in the app folder run, with the real attempt
id from the Live page URL or database:

```bash
npx prisma studio
```

Open `QuizAttempt`, set that attempt's `pausedAt` to more than an hour ago,
save, then watch B: within about 20 seconds the cover disappears.

## Report back

For each step: pass, fail, or "looked odd" with what you saw. A screenshot of
anything that looks wrong helps most.

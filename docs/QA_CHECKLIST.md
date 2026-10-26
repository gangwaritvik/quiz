# QA gap checklist

Found by the full test pass (see git log). `[x]` = fixed, `[ ]` = open.

## Fixed

- [x] Editing a bank question wiped answers recorded on submitted attempts (options now updated in place by position).
- [x] CSV question import shifted the correct letter when an option cell was blank (such rows are now reported).
- [x] Live exams "answered" counted single-choice answers only.
- [x] Class median wrong for an even number of attempts.
- [x] 500 instead of 422/409: duplicate student email, nonexistent image/subject on a question, unknown student on quiz create, NUL byte in any JSON body.
- [x] Question PATCH skipped the topic-belongs-to-subject check.
- [x] True/false and assertion-reason option sets were not enforced.
- [x] Events sent in one batch shared a timestamp, so the integrity timeline order was arbitrary.
- [x] `negativeMarks` could exceed `marks`.
- [x] A question read back from the API could not be sent to PATCH unchanged (`explanation: null`).

## Open (lower priority)

- [x] Import row numbers are off by one when the file has no header row (`students/import`, `questions/import`).
- [x] "Expected number, received nan" for a blank semester / empty AI-job params.
- [x] 409 text says "students" but counts attempts (`quizzes/[quizId]/questions`, `quizzes/[quizId]`).
- [x] Descriptive answer marked partially (e.g. 4.25/5) is counted as incorrect in the stats (`exam.ts` ~1081).
- [x] Double-click on "grant retake" grants two (`attempt-policy.ts` `grantOne`).
- [x] Extra time can never be lowered once granted (`maxExtensionMinutes` only rises).
- [x] `maxWords` is not enforced server-side.
- [x] Marks "abc"/99 in a question CSV silently become 1/20 with no row issue.
- [x] OTP request timing differs for known vs unknown accounts (`otp.ts`).
- [x] OTP request accepts very large bodies (no size guard before `request.json()`).
- [x] `/api/auth/refresh` redirect trusts the Host header (safe behind the proxy only).
- [ ] `npm audit`: the non-breaking fixes are applied; what is left needs major upgrades (next 16, zod 4, katex 0.19) and should be done as a planned upgrade, not blind.
- [ ] Not yet tested: student/auth API sweep (usage limit); real second-faculty ownership check. Browser UI is covered by tests/selenium (12 tests).

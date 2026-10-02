# E2E tests

`npm run test:e2e` drives the real HTTP API (student exam flow, faculty grading, cross-faculty
isolation, result-release window, device release, parallel start/submit, body-size and event
abuse cases) against a production build on :3001 and a throwaway Postgres database.

- **Prerequisites:** a fresh production build (`npm run build`; the run exits 2 with
  "Run npm run build first" if `.next/BUILD_ID` is older than `src/`), and the disposable
  Postgres 18 data dir at `%TEMP%\sq-staging-pg` (binaries via `PG_BIN`, default
  `C:/Program Files/PostgreSQL/18/bin`). Nothing else is installed.
- **What it does:** refuses unless the target DB differs from `.env` `DATABASE_URL`; starts
  Postgres on :5433 if needed; drops/creates `securequiz_e2e`; `prisma migrate deploy` + seed;
  starts `next start -p 3001` (OTP dev mode, temp upload dir); runs `e2e.mjs` (~3 min, it waits
  out the OTP cooldown and the post-submit window); stops everything it started.
- **Override the target:** `E2E_DATABASE_URL` (database name must end in `_e2e`).
- **Output:** a PASS/FAIL line per check, then a summary. Exit code 1 if any check fails.
- **Never touched:** the `.env` database and the server on :3000 (it only reads `.next`; do
  not run `npm run build` while another process serves it).
- **Cleanup:** the DB is dropped at the start of every run. To remove it by hand:
  `psql -h localhost -p 5433 -U securequiz -d postgres -c "DROP DATABASE IF EXISTS securequiz_e2e WITH (FORCE)"`
  then `pg_ctl -D "$TEMP/sq-staging-pg" stop` if you started Postgres yourself.

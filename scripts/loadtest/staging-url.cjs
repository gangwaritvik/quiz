// Staging DB = a throwaway local Postgres cluster on :5433 (trust auth, localhost only),
// started from %TEMP%\sq-staging-pg. The app DB user lacks CREATEDB on the main server,
// so staging cannot live there. This URL holds no secret.
process.stdout.write('postgresql://securequiz@localhost:5433/securequiz_staging?schema=public');

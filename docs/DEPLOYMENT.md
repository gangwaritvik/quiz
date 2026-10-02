# Deploying SecureQuiz to a VPS (pilot: 300+ concurrent students)

One Ubuntu server running PostgreSQL, the Next.js app, and Caddy for HTTPS.
Measured on staging: one Node process served 300 simulated students with 0 errors
(answer p95 138 ms, submit p95 223 ms), so start with one process and add a second
only if CPU stays above 70% during an exam.

## 0. Before you start

- Verify a sending domain in Resend (e.g. `quiz.college.edu`) and use an address on it for
  `OTP_FROM_EMAIL`. In production the app refuses to send codes from the `resend.dev` sandbox.
- Check Resend's sending limits cover 300+ codes within a few minutes before an exam.
- Publish a privacy notice to students (what is recorded, who sees it, how long it is kept,
  a contact for questions). Camera and screen checks stay on the student's device.
- Never set `OTP_DEV_MODE` or `OTP_DEV_MODE_ALLOW_IN_PRODUCTION` on the server: together they
  print login codes on screen for anyone.

## 1. Server

- Ubuntu 24.04 LTS, **4 vCPU (dedicated) / 8 GB RAM / 80 GB SSD**. For 1000 students: 8 vCPU / 16 GB.
- A domain, e.g. `quiz.college.edu`, with an `A` record pointing at the server.
- Firewall: allow 22, 80, 443 only (`ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable`).
- Check the campus uplink: every student downloads ~2-3 MB at exam start.

## 2. Install

```bash
sudo apt update && sudo apt install -y postgresql-16 debian-keyring debian-archive-keyring curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo apt install -y caddy   # see caddyserver.com/docs/install if the package is missing
sudo useradd --system --create-home --home-dir /opt/securequiz securequiz
sudo mkdir -p /var/lib/securequiz/uploads && sudo chown -R securequiz: /var/lib/securequiz
```

## 3. Database

```bash
sudo -u postgres psql -c "CREATE ROLE securequiz LOGIN PASSWORD '<strong-password>';"
sudo -u postgres psql -c "CREATE DATABASE securequiz OWNER securequiz;"
```

`/etc/postgresql/16/main/conf.d/securequiz.conf` (8 GB box), then `sudo systemctl restart postgresql`:

```
shared_buffers = 2GB
effective_cache_size = 5GB
work_mem = 8MB
max_connections = 100
random_page_cost = 1.1
```

## 4. App

```bash
sudo -u securequiz git clone <your-repo-url> /opt/securequiz/app
cd /opt/securequiz/app && sudo -u securequiz npm ci
```

`/opt/securequiz/app/.env` (owner `securequiz`, mode 600). Generate **new** secrets; the
ones on the development machine also sit in an old backup folder.

```
NODE_ENV=production
DATABASE_URL="postgresql://securequiz:<password>@localhost:5432/securequiz?schema=public&connection_limit=20&pool_timeout=20"
AUTH_SECRET="<node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\">"
HASH_PEPPER="<another fresh value>"
UPLOAD_DIR="/var/lib/securequiz/uploads"
RESEND_API_KEY="<key>"
OTP_FROM_EMAIL="SecureQuiz <noreply@quiz.college.edu>"
```

```bash
sudo -u securequiz npx prisma migrate deploy
sudo -u securequiz npm run build
sudo -u securequiz npm run db:create-faculty -- --email hod@college.edu --name "Dr. A. Sharma" --department CSE
# repeat per faculty member; each one sees only the quizzes they create
# then sign in as faculty and import students by CSV from /admin/students
```

Never run `npm run db:seed` or `db:reset` on this server: the seed loads demo data.

## 5. Run as a service

`/etc/systemd/system/securequiz.service`:

```ini
[Unit]
Description=SecureQuiz
After=network.target postgresql.service

[Service]
User=securequiz
WorkingDirectory=/opt/securequiz/app
Environment=NODE_ENV=production NODE_OPTIONS=--max-old-space-size=1536
ExecStart=/usr/bin/npx next start -p 3000 -H 127.0.0.1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now securequiz
```

## 6. HTTPS and proxy (Caddy)

`/etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`. Caddy obtains the certificate itself.

```
quiz.college.edu {
	request_body {
		max_size 6MB
	}
	reverse_proxy 127.0.0.1:3000 {
		header_up X-Real-IP {remote_host}
		header_up -X-Forwarded-For
	}
}
```

## 7. Backups (database and uploads together)

`/etc/cron.d/securequiz-backup`:

```
30 2 * * * postgres pg_dump -Fc securequiz > /var/backups/securequiz-$(date +\%F).dump
45 2 * * * root tar -czf /var/backups/uploads-$(date +\%F).tgz -C /var/lib/securequiz uploads
0 4 * * * root find /var/backups -name 'securequiz-*' -mtime +14 -delete; find /var/backups -name 'uploads-*' -mtime +14 -delete
```

Copy `/var/backups` off the server daily (rclone to cloud storage, or the college NAS), and
**restore it once onto a scratch database before the pilot**; an untested backup is not a backup.

## 8. Monitoring

- Uptime check on `https://quiz.college.edu/login` every minute (UptimeRobot, Better Stack, etc.).
- Logs: `journalctl -u securequiz -f`.
- During exams watch `htop` (CPU, RSS of the node process) and
  `sudo -u postgres psql -c "select count(*), state from pg_stat_activity group by state;"`.

## 9. Updating

```bash
cd /opt/securequiz/app && sudo -u securequiz git pull && sudo -u securequiz npm ci
sudo -u securequiz npx prisma migrate deploy && sudo -u securequiz npm run build
sudo systemctl restart securequiz
```

Never deploy during an exam window: a restart drops in-flight saves.

## 10. Pilot rollout

1. **Dry run**: 2-3 faculty, 10-20 volunteer students, an ungraded quiz. Confirm emails arrive
   on college addresses, fullscreen and camera checks work on the lab machines, and marking
   and release work end to end.
2. **Low-stakes quiz**: one real section (~60 students).
3. **Department-wide**: 300+ students, with a faculty member watching `/admin/live`.

Before each exam: no deploys scheduled, backup from last night exists, a named person to
contact if a student is locked out, and the privacy notice published to students.

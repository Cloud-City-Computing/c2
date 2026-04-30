```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   DEPLOYMENT                                                               ║
║   Production operations for the single-process self-hosted setup.          ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Deployment

Cloud Codex is designed to run on **one box**: one Node container, one
MySQL container, one named volume for the database. This document covers
production deployment, the operational rhythm that comes with it
(backups, upgrades, log handling), and the few production-specific
gotchas.

For local development setup, see [getting-started.md](./getting-started.md).
For things that go wrong, see [troubleshooting.md](./troubleshooting.md).

---

## Production topology

```
                    Internet
                       │
                       ▼
   ┌──────────────────────────────────────────────────────┐
   │   Reverse proxy  (Caddy / nginx / Cloudflare Tunnel) │
   │   · TLS termination                                  │
   │   · forwards Upgrade headers for /collab and         │
   │     /notifications-ws                                │
   │   · sets X-Forwarded-For for rate-limit accuracy     │
   └─────────────────────────┬────────────────────────────┘
                             │
                             ▼
   ┌──────────────────────────────────────────────────────┐
   │   Cloud Codex Node container  (docker-compose-prod)  │
   │   · vite-express serves dist/ + Express API          │
   │   · 2 WS servers attached (collab + notifications)   │
   │   · reads .env, exits if SMTP/admin missing          │
   │   · daily activity_log prune                         │
   └─────────────────────────┬────────────────────────────┘
                             │ mysql2 pool (10)
                             ▼
   ┌──────────────────────────────────────────────────────┐
   │   MySQL 8 container                                  │
   │   · named volume db-data                             │
   │   · port 3306 NOT exposed publicly                   │
   └──────────────────────────────────────────────────────┘
```

---

## Compose files

| File                          | When to use                                       |
|-------------------------------|---------------------------------------------------|
| `docker-compose.yaml`         | **Dev** — MySQL only, app runs from `npm run dev` |
| `docker-compose-prod.yml`     | **Prod** — MySQL + the Cloud Codex app together   |
| `docker-compose.linux.yml`    | WSL variant (host networking quirks)              |

For production:

```bash
cp .env.example .env       # fill every required variable (see below)
docker compose -f docker-compose-prod.yml up -d --build
```

The app container builds the Vite frontend during `docker build`. It
exits immediately on startup if SMTP or admin credentials are missing —
this is intentional. There are no hidden defaults.

---

## Required environment for production

The full reference lives in [getting-started.md](./getting-started.md).
Production-specific notes:

| Variable                   | Production note                                          |
|----------------------------|----------------------------------------------------------|
| `APP_URL`                  | Must be the public HTTPS URL — used in outbound emails  |
| `CORS_ORIGIN`              | Set to your `APP_URL` host. Empty = same-origin only     |
| `SMTP_*`                   | Hard requirement — server exits on missing credentials  |
| `ADMIN_*`                  | Hard requirement — admin is synced on every startup     |
| `GITHUB_CLIENT_SECRET`     | Doubles as the AES-256-GCM seed for stored OAuth tokens. **Never rotate without re-encrypting** existing rows or all linked GitHub accounts go invalid |
| `GOOGLE_OAUTH_DOMAIN`      | Locks SSO to a specific domain — leave unset to allow any Google account to *link*, but only same-domain users can *sign up* |

Add new env vars to `.env.example` (with a comment) when introducing them.

---

## TLS and reverse proxy

Cloud Codex serves plain HTTP on port 3000 inside its container. Production
should always sit behind a TLS-terminating reverse proxy. Two requirements
the proxy must satisfy:

1. **WebSocket upgrade passthrough.** Both `/collab/:logId` and
   `/notifications-ws` rely on the HTTP upgrade dance. A proxy that strips
   `Upgrade` / `Connection` headers will silently break collab and
   notifications.
2. **Same-origin headers.** `services/user-channel.js` enforces an
   `Origin` host check against `Host`. If your proxy rewrites either,
   make sure both end up matching the public hostname.

Helmet's CSP allows `connect-src 'self' ws: wss:` so cross-origin websocket
connections will be refused at the browser level too — that's deliberate.

---

## Backups

The only stateful container is MySQL; the named volume `db-data` is the
single source of truth.

```bash
# Logical dump (recommended — portable, point-in-time)
docker exec -t <mysql-container> \
   mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction \
            --routines --triggers c2 > c2-$(date +%F).sql

# Restore
docker exec -i <mysql-container> \
   mysql -u root -p"$MYSQL_ROOT_PASSWORD" c2 < c2-2026-04-29.sql
```

Schedule the dump however suits your environment (cron on the host,
managed snapshot on your cloud, GitHub Actions pulling a dump). The
`db-data` volume can also be snapshotted at the volume-driver level if
your storage supports it.

User-uploaded files (avatars and document images) live inside the **Node
container**, under `cloudcodex/public/avatars/` and
`cloudcodex/public/doc-images/`. Mount these as a volume in
`docker-compose-prod.yml` if you want them to persist across container
rebuilds.

---

## Upgrades

```
   ┌─────────────────┐   ┌────────────────────────┐   ┌──────────────────┐
   │ git pull main   │──►│ inspect migrations/    │──►│ docker compose   │
   │ (or pull image) │   │ for new files          │   │ up -d --build    │
   └─────────────────┘   │  · apply each in order │   └──────────────────┘
                         │    against running DB  │
                         │  · init.sql is for new │
                         │    installs only       │
                         └────────────────────────┘
```

**Rule:** `init.sql` and `migrations/*.sql` must stay in sync. Every
column or table added in a migration also lives in `init.sql` so a fresh
install converges to the same schema. New migrations are additive — no
file in `migrations/` is ever rewritten after it ships.

Apply pending migrations against the running DB via `make db-shell`:

```bash
make db-shell
mysql> source /var/lib/mysql/migrations/<file>.sql;
```

(or shell into the MySQL container directly with `docker exec`).

---

## Logs

Cloud Codex writes to **stdout/stderr only** — no logging library, no
file rotation. Capture with whatever your container runtime provides
(`docker logs`, journald, your cloud's log drain). The project format
for error lines is:

```
[2026-04-29T17:14:21.000Z] POST /api/save-document: <error message>
```

Anywhere `console.error` is used, this prefix is the convention. Don't
introduce a structured-logging library without discussing first.

---

## Background work

There is one scheduled task running inside the Node process: the
`activity_log` daily prune (rows older than 365 days are deleted at
startup and once per day after that). It's a `setInterval` in
`server.js` — there's no separate worker process or cron container.

If you ever need a true background worker, prefer adding a deliberate
single-process scheduler (BullMQ-like) over splitting into a second
container. The single-process story is load-bearing for self-hosting.

---

## Static asset caching

| Path                  | Cache headers              |
|-----------------------|-----------------------------|
| `/avatars/*`          | `max-age=604800, immutable` (7 days)  |
| `/doc-images/*`       | `max-age=2592000, immutable` (30 days) |
| Vite-built assets     | hashed filenames + long max-age (Vite default) |

Avatars and doc images are content-addressed by SHA — a new upload
gets a new URL, so long cache windows are safe.

---

## Rate limiters

`express-rate-limit` runs in-process and resets when the container does.
For a multi-replica deployment you'd need to switch to a shared store —
but the single-process architecture is the recommended topology, so
this is not a typical concern.

| Scope                | Limit                           |
|----------------------|---------------------------------|
| Auth endpoints       | 20 / 15 minutes per IP          |
| User search          | 60 / 15 minutes per IP          |
| WebSocket messages   | 60 / second per connection      |

`X-Forwarded-For` must be honored by your reverse proxy for these to
limit per-client rather than per-proxy — Cloud Codex does not currently
trust that header explicitly, so set `app.set('trust proxy', …)` if you
introduce a proxy that requires it (and add a test).

---

## Health checks

There's no dedicated `/healthz` endpoint today. A reasonable check for
your platform's health probe is:

```bash
curl -fsS http://localhost:3000/api/oauth/providers
```

It returns `200` once the app has booted past its SMTP + admin checks
and has a working DB pool.

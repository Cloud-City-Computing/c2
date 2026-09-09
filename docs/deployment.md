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
   │   · reads .env, exits if admin credentials missing   │
   │   · SMTP is optional; mail degrades if unconfigured  │
   │   · named volume app_public (avatars, doc-images)    │
   │   · daily activity_log prune                         │
   └─────────────────────────┬────────────────────────────┘
                             │ mysql2 pool (10)
                             ▼
   ┌──────────────────────────────────────────────────────┐
   │   MySQL 8 container                                  │
   │   · named volume db_data                             │
   │   · 3306 not published by docker-compose-release.yml │
   │   · 3306 IS published by docker-compose-prod.yml     │
   └──────────────────────────────────────────────────────┘
```

---

## Compose files

| File                          | When to use                                        |
|-------------------------------|----------------------------------------------------|
| `docker-compose.yaml`         | **Dev** — MySQL only, app runs from `npm run dev`  |
| `docker-compose-release.yml`  | **Prod, published image** — no build toolchain     |
| `docker-compose-prod.yml`     | **Prod, from source** — builds `./cloudcodex`      |
| `docker-compose.linux.yml`    | WSL variant (host networking quirks)               |

Running a published release, which is the recommended path unless you are
deploying modified source:

```bash
cp .env.example .env       # fill every required variable (see below)
docker compose -f docker-compose-release.yml up -d
```

This pulls `ghcr.io/cloud-city-computing/cloud-codex`, pinned by
`CLOUDCODEX_VERSION` (default `0.9.0`), so nothing is compiled locally and the
version does not move under you on the next publish. The published image is
`linux/amd64`; Apple Silicon runs it under Docker Desktop's emulation.

> **If the pull answers `unauthorized`,** the GHCR package is still private.
> Container packages created by Actions start private regardless of repository
> visibility, and it has to be flipped once by an org owner in Package settings.
> See the release section of
> [`docs/maps/build-test-and-ops.md`](maps/build-test-and-ops.md).

Building from your own source instead:

```bash
cp .env.example .env
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

Cloud Codex serves plain HTTP on port 3000 inside its container, or on `PORT`
if that is set. `docker-compose-prod.yml` publishes `${PORT:-3000}` on both
sides of the mapping, so setting `PORT` in `.env` moves the host port with it;
update `APP_URL` to match, and remember the smoke test below uses that port.
Production should always sit behind a TLS-terminating reverse proxy. Two
requirements the proxy must satisfy:

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

There are **two** stateful volumes, and a MySQL dump alone is not a complete
backup: `db_data` holds the database, and `app_public` holds uploaded avatars
and the images extracted out of documents. Back up both.

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
`db_data` volume can also be snapshotted at the volume-driver level if
your storage supports it.

**Uploaded files are not in the dump.** Avatars and document images are written
to `/app/public/avatars/` and `/app/public/doc-images/` inside the app
container, and both compose files mount the named volume `app_public` there so
they survive a container being recreated. They are not optional extras: when an
image is pasted into a document, `routes/helpers/images.js` extracts it to disk
and **replaces the base64 data URI in `html_content` with a `/doc-images/` URL**,
so after extraction the file on disk is the only copy. Lose the volume and every
affected document renders a broken image while the database still points at it.

```bash
# Back the uploads up alongside the SQL dump
docker run --rm -v cloudcodex_app_public:/data -v "$PWD":/backup alpine \
   tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

---

## Upgrades

**Applying migrations is a deliberate step on every upgrade path, including the
published image.** Bumping `CLOUDCODEX_VERSION` and running
`docker compose up -d` starts a newer app against an older schema, and it boots
cleanly before throwing 500s on whatever column it expects and cannot find.
`init.sql` will not save you: MySQL executes `docker-entrypoint-initdb.d` only
when it initialises an **empty** data directory, so on an existing `db_data`
volume it is skipped entirely.

There **is** a migration runner, `npm run migrate`. It applies every pending
file in `migrations/` in lexicographic order and records each one in a
`schema_migrations` table (filename, sha256 checksum, elapsed ms, timestamp), so
a second run is a no-op and an applied file that has since been edited is a hard
stop rather than a silent re-apply. Where you run it from depends on the
deployment: see "Running the migrations" below.

Take a dump before starting, and read the release's CHANGELOG entry for schema
changes.

```
   +------------------+   +------------------+   +------------------------+   +----------------+
   | 1. pull the new  |-->| 2. stop every    |-->| 3. run the migration   |-->| 4. start the   |
   |    image, or     |   |    WRITER        |   |    in a ONE-OFF        |   |    new image   |
   |    git pull main |   |    (the app, not |   |    container           |   |                |
   |                  |   |     the database)|   |  - applies pending in  |   |  docker        |
   |  docker compose  |   |                  |   |    lexicographic order |   |  compose up -d |
   |  ... pull app    |   |  docker compose  |   |  - records each in     |   |  [--build]     |
   +------------------+   |  ... stop app    |   |    schema_migrations   |   +----------------+
                          +------------------+   |  - init.sql is for new |
                                                 |    installs only       |
                                                 +------------------------+
```

**Rule:** `init.sql` and `migrations/*.sql` must stay in sync. Every
column or table added in a migration also lives in `init.sql` so a fresh
install converges to the same schema. New migrations are additive, no
file in `migrations/` is ever rewritten after it ships. The runner enforces
that second half: it checksums every file when it applies it, and refuses to
run again if one of them has changed since.

### Stop every writer first

**Order: stop every writer, apply the migration, start the new image.** Not the
other way round.

A migration that adds a `NOT NULL` column with no `DEFAULT` makes the schema
incompatible with the application in *both* directions, and no compose file
overrides `sql_mode`, so MySQL 8's default `STRICT_TRANS_TABLES` applies:

- **Old code against the new schema** fails every insert that omits the column
  (error 1364).
- **New code against the old schema** fails every insert that names it
  (error 1054).

Either way the affected endpoints 500 for real users for as long as the window
is open, and 500s are not always harmless: `2026-09-08-token-purpose.sql` would,
mid-window, make `POST /api/forgot-password` fail for an address that exists
while still answering 200 for one that does not, which is an account enumeration
oracle the code goes out of its way to close.

"Every writer", not "the app container": `docker-compose.yaml` (dev) defines a
single service, `database`. There is **no app container in dev**: the app runs
on the host under `npm run dev`, and that is the writer to stop. The
single-process architecture already makes a restart a brief total outage, so a
planned one costs nothing extra.

Stopping the writers also closes a partial-failure race for any migration that
deletes rows and then tightens the column: a row inserted in between makes the
tightening `ALTER` fail, and MySQL implicitly commits DDL, so the table is left
half-migrated with nothing recording it. For
`2026-09-08-token-purpose.sql` that error is 1265, `Data truncated for column
'purpose'`, because the `CHECK` in the same `ALTER` forces the table-copy path;
a bare `MODIFY` would report 1138 instead. Recovery is the same either way:
drop the column and re-apply with the writers down.

**Assume no rollback.** Reverting the application after applying a migration
lands you in old-code-against-new-schema. Getting back means undoing the DDL by
hand; each migration header says what that is.

`schema_migrations` is runner-owned bookkeeping and is deliberately **not** in
`init.sql`. If a fresh install arrived with the table already present and empty,
the runner would read "nothing applied" and try to replay every shipped delta
against the schema those deltas are already folded into.

### Stop every writer first

**Order: pull, stop every writer, apply the migrations, start the new image.**
Not the other way round. The runner does not stop anything for you.

A migration that adds a `NOT NULL` column with no `DEFAULT` makes the schema
incompatible with the application in *both* directions, and no compose file
overrides `sql_mode`, so MySQL 8's default `STRICT_TRANS_TABLES` applies:

- **Old code against the new schema** fails every insert that omits the column
  (error 1364).
- **New code against the old schema** fails every insert that names it
  (error 1054).

Either way the affected endpoints 500 for real users for as long as the window
is open, and 500s are not always harmless: `2026-09-08-token-purpose.sql` would,
mid-window, make `POST /api/forgot-password` fail for an address that exists
while still answering 200 for one that does not, which is an account enumeration
oracle the code goes out of its way to close.

"Every writer", not "the app container": `docker-compose.yaml` (dev) defines a
single service, `database`. There is **no app container in dev**: the app runs
on the host under `npm run dev`, and that is the writer to stop. The
single-process architecture already makes a restart a brief total outage, so a
planned one costs nothing extra.

Stopping the writers also closes a partial-failure race for any migration that
deletes rows and then tightens the column: a row inserted in between makes the
tightening `ALTER` fail (each migration header names the exact error it would
raise), and MySQL implicitly commits DDL, so the table is left half-migrated.
The runner records nothing for a file that failed, so `schema_migrations` will
not paper over it, but nothing undoes the DDL either.

**Assume no rollback.** Reverting the application after applying a migration
lands you in old-code-against-new-schema. Getting back means undoing the DDL by
hand; each migration header says what that is.

### Running the migrations

**Where you run it depends on which compose file you deploy with**, because the
runner needs three things at once: the `migrations/` directory, the app's Node
dependencies, and a reachable MySQL.

| Deployment | Command | Why |
|---|---|---|
| `docker-compose-release.yml` (published image) | `docker compose -f docker-compose-release.yml run --rm app npm run migrate` | 3306 is **not** published to the host, so the runner has to be inside the compose network. `run` builds a one-off container from the **current** compose file and the **new** image, so it has both `scripts/migrate.js` and the `./migrations` mount, and it removes itself afterwards. |
| `docker-compose-prod.yml` (built from source) | `docker compose -f docker-compose-prod.yml run --rm app npm run migrate` | Same shape, after `docker compose -f docker-compose-prod.yml build app`. 3306 *is* published here, so `cd cloudcodex && npm run migrate` on the host also works if you have run `npm install` there. |
| `docker-compose.yaml` (dev) | `cd cloudcodex && npm run migrate` | Dev has **no app container**: the writer to stop is `npm run dev` on the host. MySQL publishes 3306 and `node_modules` is installed, so the runner just runs there. |

**`run --rm`, not `exec`.** This matters most on the one upgrade every existing
operator performs: the one that installs the runner. `exec` runs inside the
container that is **already running**, which at that moment is the old one, and
it fails twice over:

- the running image is the previous `CLOUDCODEX_VERSION`, which predates
  `scripts/migrate.js` and the `migrate` script, so `exec` gets
  `npm error Missing script: "migrate"`;
- and even with the new image pulled, the running container was **created**
  before `./migrations:/migrations` existed in the compose file. `docker compose
  pull` does not recreate a container, so `/migrations` is simply absent inside
  it.

`run` has neither problem, because it creates a container from the compose file
and image you have right now, and it does not disturb the running app. From the
second upgrade onward `exec` would work, which is exactly why the broken
instruction reads fine.

The runner reads `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` from the
environment, the same variables the app uses. Inside the container `DB_HOST` is
already `database`; on the host it comes from `.env`. There is no `DB_PORT`:
the runner uses 3306, matching `mysql_connect.js`.

On an **SELinux** host (Fedora, RHEL, CentOS, Rocky) the `migrations/` bind
mount carries `:ro,z` in both compose files. Without a relabel flag the
directory keeps its host label and is unreadable inside the container, and the
runner would fail on a directory that is plainly there. `z` (shared) rather than
`Z` (private), because more than one container reads it.

Earlier releases of this document told you to run
`source /var/lib/mysql/migrations/<file>.sql` inside `make db-shell`. That never
worked: no compose file mounts `migrations/` into the **MySQL** container
(`docker-compose.yaml`, `docker-compose-prod.yml`, `docker-compose-release.yml`
and `docker-compose.linux.yml` mount only the data directory and `init.sql`), so
that path does not exist there. The mount added for the runner is on the **app**
service, which is where the runner runs.

### First run: record a starting point, once

The runner refuses to guess. Against a database with no `schema_migrations`
table it stops with instructions rather than applying anything, because without
bookkeeping it cannot tell a fully-migrated database from a partly-migrated one,
and either guess is destructive. Which command you run once depends on where the
schema came from, and **they are not interchangeable**:

| Situation | Command | What it records |
|---|---|---|
| **Upgrading** a database that already existed before this release. This is the usual case, and it includes every install that predates the runner | `npm run migrate -- --baseline` | Only the **thirteen** files that shipped before the runner existed. Anything added since is genuinely missing from that database and stays **pending**, to be applied for real by the next ordinary run. |
| A database `init.sql` **built minutes ago** and that has never been upgraded | `npm run migrate -- --adopt-fresh-install` | **Every** file in `migrations/`, without running any of them. Correct only because `init.sql` is kept in sync with all of them, so the schema already has every change. |

Both record checksums and apply nothing. After either, `npm run migrate` is the
only command you need, from then on.

**If you are not sure, it is not a fresh install.** "Brand-new install" means the
database, not the release: an install you are upgrading to a new version is an
existing database, however new the image is.

The thirteen are a closed list hardcoded in `scripts/migrate.js`
(`LEGACY_BASELINE`), deliberately not a scan of the directory. If `--baseline`
swept the directory, an operator upgrading across a release that adds a
fourteenth migration would mark it applied without running it, and the app would
then run against a schema that never got the change while the runner reported
success.

`--adopt-fresh-install` is the only mode that adopts everything, so it is the
one that can do that damage on purpose, and it is guarded twice:

- it **refuses** once `schema_migrations` holds a single row, which keeps it away
  from a tracked install;
- and for every file that postdates the thirteen, it **checks the live schema
  first**, through `information_schema`, and refuses unless the table or column
  that file adds is already there. Empty bookkeeping proves nothing (an install
  that predates the runner has none **by definition**), so the guard is that
  positive check rather than the absence of rows. It prints the exact list of
  files it is adopting before it adopts them.

The runner never bootstraps a schema, and refuses outright against a database
with no `users` table. Run `init.sql` first (a fresh Docker volume does this for
you).

So, end to end on a new published-image install:

```bash
docker compose -f docker-compose-release.yml up -d        # init.sql builds the schema
docker compose -f docker-compose-release.yml run --rm app \
   npm run migrate -- --adopt-fresh-install
```

Nothing is applied there, so the app can stay up for that one. Every upgrade
after that is the four-step order above:

```bash
docker compose -f docker-compose-release.yml pull app       # 1. new image
docker compose -f docker-compose-release.yml stop app       # 2. stop the writer
docker compose -f docker-compose-release.yml run --rm app \
   npm run migrate                                          # 3. migrate
docker compose -f docker-compose-release.yml up -d          # 4. start it again
```

`run --rm` rather than `exec` on the upgrade path: `exec` runs inside the
container that is **already** running, which on the upgrade that first installs
the runner is the old image, and that image has neither the `migrate` script nor
the `migrations/` mount. `run` builds a one-off container from the updated
compose definition, so it has both.

### Concurrency

The runner takes a MySQL advisory lock for the duration of a run and waits up to
10 seconds for it. A second run started while the first is working refuses with
a clear message instead of racing it.

The lock name is `cloudcodex_migrate:<database>`, built server-side with
`GET_LOCK(CONCAT('cloudcodex_migrate:', DATABASE()), 10)`. `GET_LOCK` names are
scoped to the MySQL **server**, not to a database, so an unqualified name would
make two Cloud Codex schemas on one server serialise against each other while
the loser was told the contention was against its own database. The runner also
distinguishes MySQL's two negative answers: `0` is "someone else holds it" and
`NULL` is "the attempt itself errored", and they get different messages.


### If a migration fails

**MySQL implicitly commits DDL.** The runner opens a transaction per file, which
covers the DML inside it, but no `ROLLBACK` can undo a `CREATE`, `ALTER` or
`DROP` that has already run. A file that fails halfway therefore leaves the
database **partially migrated**, and the runner says exactly that rather than
promising a rollback it cannot deliver. It stops at the failing file and does
not continue to the next one. Recovery is to inspect the schema, or restore the
dump you took before starting, and retry. This is why that dump is not optional.

**One failure means the opposite of that.** If MySQL reports `ER_DUP_FIELDNAME`,
`ER_TABLE_EXISTS_ERROR` or `ER_DUP_KEYNAME`, the object the file adds is already
present and the run may have changed nothing at all. The usual cause is a
starting point recorded with the wrong command: a database `init.sql` built
contains every migration already, so `--baseline` leaves the newer files pending
and the next ordinary run dies on their first `ALTER`, on an install minutes old
with no dump to restore. The runner says so, and prints the `INSERT INTO
schema_migrations` that records the file as applied by hand once you have
confirmed the schema really has the change.


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

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
   │   · one process per database (a per-schema lock)     │
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
`CLOUDCODEX_VERSION` (default `0.11.0`), so nothing is compiled locally and the
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
exits at startup, with a sentence naming the variable, if the admin
credentials are missing or `APP_URL` is unset; mail is optional.

---

## Required environment for production

**Every variable the server reads is listed in
[`cloudcodex/env-contract.js`](../cloudcodex/env-contract.js)**, with whether
it is required, required in production, defaulted (and to what) or optional,
and why. A test fails when the server reads a variable that file does not
list, so it is complete by construction; `.env.example` carries a comment for
each one, and [getting-started.md](./getting-started.md) walks through them.
Production-specific notes:

| Variable                   | Production note                                          |
|----------------------------|----------------------------------------------------------|
| `APP_URL`                  | **Required in production**: without an `http://` or `https://` URL the server exits at boot, and a `localhost` one boots with a warning. The public address people use, `https://` behind a TLS proxy; invitation, reset and notification links carry it |
| `CORS_ORIGIN`              | Leave empty. The app's own origin and `APP_URL`'s are always allowed; set it only for a separate front end |
| `TRUST_PROXY`              | Which proxies to believe about the client address, which is what the rate limiters count. Unset is `1`, right for one reverse proxy in front of the app. See [Rate limiters](#rate-limiters) |
| `DB_POOL_SIZE`             | MySQL connections the app holds open, 1 to 100. Unset is `10` |
| `SMTP_*`                   | Optional. Without them invitations show a copyable link and password reset is unavailable |
| `ADMIN_*`                  | Hard requirement. **They reset the admin's email and password at every boot**; see [The boot admin](#the-boot-admin) |
| `GITHUB_CLIENT_SECRET`     | Doubles as the AES-256-GCM seed for stored OAuth tokens. **Never rotate without re-encrypting** existing rows or all linked GitHub accounts go invalid |
| `GOOGLE_OAUTH_DOMAIN`      | Locks SSO to a specific domain — leave unset to allow any Google account to *link*, but only same-domain users can *sign up* |
| `AUTH_PROVIDERS`           | Leave unset. If set, it must include `local` and agree with the Google variables, or the server exits at boot with a sentence saying which |

Add new env vars to `.env.example` (with a comment) when introducing them.

### The boot admin

Every boot reconciles one admin from `ADMIN_USERNAME`, `ADMIN_EMAIL` and
`ADMIN_PASSWORD` (`ensureAdminUser` in `cloudcodex/routes/admin.js`), before
the port opens, and logs one line saying which of three things it did. None of
them logs the password.

- **Created.** No account has that name or that email: boot creates the admin.
- **Synced.** The account with that name or that email is already an admin:
  **boot resets its email to `ADMIN_EMAIL` and its password to
  `ADMIN_PASSWORD`, at every boot.** `.env` is the source of truth for the
  admin's credentials, so a password or address the admin changes in the app
  lasts only until the next restart; change it in `.env` instead. Its name is
  never rewritten.
- **Refused.** An account with that name or that email is **not** an admin.
  Boot never promotes one: it changes nothing, not that account and not the
  admin's, and logs

  ```
  admin sync: <ADMIN_USERNAME> / <ADMIN_EMAIL> matches an existing non-admin account (user <id>), refusing to promote it. Promote it in the admin console if that is intended.
  ```

  It happens when a member holds a name or address the admin has given up
  (the admin renamed, or changed email, and a member took the old one), or
  when `.env` is edited to name an existing member. If that account is meant
  to be the admin, promote it in the admin console (Users, click its **User**
  badge); from the next boot on it is synced as above, so its email and
  password become `ADMIN_EMAIL` and `ADMIN_PASSWORD`. If it is not, set
  `ADMIN_USERNAME` and `ADMIN_EMAIL` to the admin's current name and address,
  or to a name and address no account uses to have boot create a fresh admin,
  and restart. The refusal repeats at every boot until one of those is done.

A refused sync is not fatal: the instance starts, an existing admin keeps the
credentials it had, and the first-boot seed does not run on that boot.

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

Both WebSocket servers refuse a cross-origin upgrade themselves: each requires
an `Origin` whose host equals `Host`. Helmet's CSP (`connect-src 'self' ws: wss:`)
is not what enforces that. In production it does govern the page that opens the
sockets, but it allows any `ws:` or `wss:` host, and a CSP binds only the
browser that honours it, never a script calling the socket directly.

---

## Backups

There are **two** stateful volumes, and a MySQL dump alone is not a complete
backup: `db_data` holds the database, and `app_public` holds uploaded avatars
and the images extracted out of documents. When an image is pasted into a
document, `routes/helpers/images.js` extracts it to disk and **replaces the
base64 data URI in `html_content` with a `/doc-images/` URL**, so after
extraction the file on disk is the only copy. Lose the volume and every
affected document shows a broken image while the database still points at it.

One command backs up both, and one restores both. From the repository root,
with the stack's `.env` in place:

```bash
make backup OUT=backups/c2-$(date +%F).tar.gz     # scripts/backup.sh
make restore IN=backups/c2-2026-09-28.tar.gz       # scripts/restore.sh
```

Both drive the stack through `docker compose`, on
`docker-compose-release.yml` unless `COMPOSE_FILE` names another (for example
`COMPOSE_FILE=docker-compose-prod.yml` when you build from source), and
`COMPOSE_PROJECT_NAME` works as it does for Compose. Neither needs the MySQL
root password: they run inside the database service as the app's own MySQL
user (`DB_USER`), which the image grants everything on the app's database and
nothing else.

**What an archive holds.** One gzipped tar of three files: `database.sql`
(`mysqldump --single-transaction --routines --triggers --hex-blob` of the app's
database, including `schema_migrations`, so the migration ledger comes back
with the data), `app_public.tar.gz` (the uploads volume) and `manifest.json`
(the format, when it was taken, the database name, the app version, and the
SHA-256 of the other two). No host name, user or password is in it.

**Keep it the way you keep the database.** The archive is written readable by
its owner only (mode 0600) and never over an existing file. It holds
everything the database holds: password hashes, two-factor secrets, GitHub
tokens (encrypted), session digests and every document. It does **not** hold
`.env` or any key material, so back those up separately and just as carefully:
`GITHUB_CLIENT_SECRET` in particular, because every stored GitHub token is
encrypted under a key derived from it, and a restore under a different secret
leaves each linked account to link again. `SERVICE_TOKEN`, the sign-in
providers' client secrets, SMTP credentials and `ADMIN_PASSWORD` are in `.env`
too.

**What a backup is consistent to.**

- The dump is one consistent snapshot of InnoDB tables, which is every table
  `init.sql` creates. A table added by hand with another engine is not covered.
- A backup can run while the app serves. But the app keeps up to the last
  three seconds of live collaborative edits in memory before saving them, so
  only a backup taken **after a graceful stop** (`docker compose stop app`,
  see [Stopping cleanly](#stopping-cleanly)) is sure to have every edit. Stop,
  back up, start is the safe rhythm for a nightly job.
- The uploads are archived after the dump, so an image pasted between the two
  is in the archive with no document pointing at it, which is harmless.

**Restoring.** `make restore` restores into a stopped stack, then starts it:

```bash
docker compose -f docker-compose-release.yml stop app      # if it is running
make restore IN=backups/c2-2026-09-28.tar.gz
make restore IN=... ARGS="--replace"                        # over existing data
```

It checks everything before it writes anything, and each check is a refusal:
the archive holds exactly its three files and each matches the manifest's
checksum; the uploads hold only plain files and directories; the dump has no
statement that switches, creates or drops a database and no `mysql` client
command; the archive is a backup of a database with the same name as this
stack's (pass `--into <this stack's DB_NAME>` to restore it under a different
name on purpose); the app is not running and nothing holds the database's
[instance lock](#one-process-per-database); and the database holds no rows.
Tables with no rows at all are what the database service builds from
`init.sql` when a new stack first starts, so a restore onto a new machine needs
no flag. Over real data it needs `--replace`, which drops every table in the
database and empties `avatars/` and `doc-images/` before loading. The load runs
as the app's own MySQL user and holds the instance lock, so a statement naming
another database fails on the grant and an app that starts meanwhile refuses.
Then it runs `npm run migrate` (a backup from an older release is brought up to
date; restore onto the same release or a newer one, never an older one) and
`docker compose up -d`. `--no-start` stops after the data and prints the two
commands instead.

A load that fails part way leaves the database holding part of the backup, and
says so; fix the cause and run the restore again with `--replace`.

**Scheduling and keeping them.** Nothing here rotates or ships archives. A
nightly cron entry, for example:

```cron
0 3 * * * cd /srv/cloudcodex && docker compose -f docker-compose-release.yml stop app && make backup OUT=/var/backups/cloudcodex/c2-$(date +\%F).tar.gz; docker compose -f docker-compose-release.yml start app
```

then copy the archive off the machine, encrypted, and prune old ones. A
backup you have never restored is a guess: restore one onto a spare machine now
and then. `cloudcodex/tests/integration/backup-restore.test.js` runs that drill
in CI against a live MySQL, and the Compose path was drilled by hand when the
scripts landed: both volumes destroyed, then every document, comment, image and
avatar checked after the restore.

**Without Docker.** `scripts/backup.sh --local [--uploads DIR] <file>` and
`scripts/restore.sh --local [--uploads DIR] ... <file>` do the same with the
`mysql` and `mysqldump` clients on `PATH`, connecting over TCP as `DB_USER`
with `DB_PASS` to `DB_NAME` on `DB_HOST`, and with the uploads directory on
disk (default `cloudcodex/public`). They need MySQL's clients: MariaDB's
`mysqldump` writes the values of generated columns (`logs.plain_content`),
which MySQL refuses on restore, so `--local` refuses it. A MySQL server shared
by several instances is backed up the same way, one instance at a time, each
with its own user.

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

**Upgrading a 0.9.0 install is the one exception.** Two of the thirteen,
`widen_log_content.sql` and `drop_squad_permissions.sql`, shipped after 0.9.0 was
tagged, so a database that has only ever run 0.9.0 does not have them, and
`--baseline` records them anyway. Apply both by hand after `--baseline`; they
are idempotent. The exact commands are in the 0.10.0 entry of
[`CHANGELOG.md`](../CHANGELOG.md), under Migration.

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

Nothing is applied there, so the app can stay up for that one. Until it runs,
`/readyz` answers `503 {"ready":false,"reason":"migrations"}` and Docker
reports the container `unhealthy`, because a database with no bookkeeping
cannot be shown to be migrated; the app serves requests either way. Every
upgrade after that is the four-step order above:

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
the loser was told the contention was against its own database. MySQL caps a
lock name at 64 characters, so for a schema name longer than 45 the name is
`cloudcodex_migrate#` and the first 40 hex characters of the schema's SHA-256
instead; every shorter name is unchanged. The runner also
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

**A refusal is a third case.** Some migrations check the data before they
change the schema and refuse when it would break the change, for example
`2026-09-25-oauth-one-link-per-provider.sql` on a user linked twice to one
provider. The runner then reports `Migration <file> refused to run:` followed
by the file's own message, which names what to look for; it records nothing,
drops the throwaway guard procedure the file created, and the file stays
pending. Resolve what the message names (the file's header and the CHANGELOG
say how), then run `npm run migrate` again. Such a file needs the runner: the
`mysql` client cannot run it, because it splits the guard's body on its
semicolons.

### The document-images backfill, once

`2026-09-27-who-may-see-doc-images.sql` creates `doc_images`, the table that says which
documents hold which image, and the `/doc-images` handler now serves an image
only to its uploader and to readers of a document named there. The table starts
empty, so **on an install that already has documents with images, every image
is hidden from its readers until the backfill runs.** Run it once, after the
migration and before starting the new image, the same way as the runner:

| Deployment | Command |
|---|---|
| `docker-compose-release.yml` | `docker compose -f docker-compose-release.yml run --rm app npm run backfill:doc-images` |
| `docker-compose-prod.yml` | `docker compose -f docker-compose-prod.yml run --rm app npm run backfill:doc-images` |
| `docker-compose.yaml` (dev) | `cd cloudcodex && npm run backfill:doc-images` |

It records a row for every `/doc-images/` image in `logs.html_content` and
`versions.html_content` and prints `backfill-doc-images: recorded N image
reference(s) from D document(s) and V version(s)`. It trusts every reference
already stored, which is why it belongs before the app starts: run later, it
also trusts whatever was saved in between, including references pasted by
people who cannot see the image. So it refuses to run over a `doc_images` table
that already has rows. If an interrupted first run needs finishing before
go-live, add `--again` (`npm run backfill:doc-images -- --again`, or the same
after `run --rm app`); it is idempotent, so the rerun records only what was
missed. Do not rerun it after go-live. If the app has to start first, set
`DOC_IMAGES_PUBLIC=1` (images served to anyone with the address, as before),
run the backfill (it runs without `--again` while that is set), then unset it
and restart. A fresh install needs none of this.

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
| `/doc-images/*`       | `private, max-age=86400` (1 day); a refusal is `no-store`. With `DOC_IMAGES_PUBLIC=1`, `public, max-age=2592000, immutable` (30 days) |
| Vite-built assets     | hashed filenames + long max-age (Vite default) |

Avatars and doc images are content-addressed by SHA, so a new upload gets a new
URL and long cache windows are safe. Document images are `private` because they
are served per user: a reverse proxy or CDN in front of the app must not cache
`/doc-images/`, and `private` tells a standards-following one not to.

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

The limiters count per client address, which Express takes from
`X-Forwarded-For` as far as `TRUST_PROXY` allows, so set it to match how
clients actually reach the app. Unset, it is `1`: Express trusts exactly one
hop in front of it. With two proxies in front (a load balancer, then nginx)
set `TRUST_PROXY=2`; to trust only known proxy addresses, give `loopback` or a
comma list of addresses and CIDRs; with nothing in front, `false`. Never set
`true`: it believes whatever `X-Forwarded-For` a client sends, so anyone can
choose their own address and walk around every limit. A value Express cannot
parse stops the server at boot.

---

## Health checks

Two unauthenticated endpoints, outside `/api` and ahead of every rate limiter.
Neither says anything about the install: no version, no counts, no names.

| Endpoint | Answers | Use it for |
|---|---|---|
| `GET /healthz` | `200 {"ok":true}` whenever the process is serving HTTP. It touches nothing, not even the database. | **Liveness.** Restart the container only when this fails. |
| `GET /readyz` | `200 {"ready":true}`, or `503 {"ready":false,"reason":"..."}` | **Readiness.** Route traffic to the instance, and call a deploy done, only on 200. |

The `reason` is one of four words, checked in this order:

| `reason` | Means | What to do |
|---|---|---|
| `shutting_down` | a stop signal arrived and the app is flushing and closing | nothing: it exits within ten seconds |
| `lock` | this process does not hold the instance lock (see [One process per database](#one-process-per-database)) | read the log: MySQL restarted and the lock is being taken back (it retries every second), or another process took it, in which case this one stops |
| `database` | `SELECT 1` failed or took longer than two seconds | check MySQL and the network |
| `migrations` | a file in `migrations/` has not been applied, the database has never been adopted, or `migrations/` is not mounted | run `npm run migrate` (see [Upgrades](#upgrades)); on a brand-new install, the one-time `--adopt-fresh-install` |

The published image carries a Docker `HEALTHCHECK` on `/readyz` (every 10 s,
3 s timeout, 20 s start period, 3 retries), so `docker ps` and
`docker inspect --format '{{.State.Health.Status}}' cloudcodex-app` show
`healthy` once the app is ready. Plain Compose does not restart an unhealthy
container; the status is for you and for whatever sits in front.

```bash
curl -fsS http://localhost:3000/readyz     # exits non-zero on 503
```

Answering `/readyz` costs at most one `SELECT 1` and one read of
`schema_migrations` at a time, however many probes arrive together, but it is
still a database call anyone who can reach the port can make. If your proxy
forwards every path, consider not exposing `/healthz` and `/readyz` publicly;
your supervisor reaches the container port directly.

**Do not point a liveness probe at `/readyz`.** A database outage would then
restart a perfectly healthy app in a loop. Earlier releases of this document
suggested `GET /api/oauth/providers`, which reads no database and so proved
only that the process listened; use `/healthz` for that.

### Stopping cleanly

The image runs `node server.js` directly, so `docker stop` (SIGTERM) and
Ctrl-C (SIGINT) reach the app. It then answers `/readyz` with
`shutting_down`, stops taking connections, writes every open document's
not-yet-saved collaborative edits to the database, closes both WebSockets with
code 1001 (editors reconnect to the next process on their own), releases the
instance lock and the database pool, logs `stopped cleanly on SIGTERM` and
exits 0. It gives itself ten seconds and exits 1 past that. If a document's
final write fails, the last line is `stopped on SIGTERM with 1 document not
saved` instead (and the line before it names the document), so look for
`cleanly`, not just `stopped`. A stop signal that arrives during startup, before
the app is listening, ends it at once, and a second Ctrl-C does the same
mid-shutdown. Both production compose files set `stop_grace_period: 20s` so
Docker waits for it; if you run the image some other way, give it more than ten
seconds before a SIGKILL.

A SIGKILL, a crash or a power cut still loses up to the last three seconds of
live edits for documents nobody had saved, as before.

### One process per database

A Cloud Codex process keeps every open document's live state in memory, so
two processes on the same database would each keep their own copy and
overwrite each other's. At boot the app therefore takes a MySQL lock named for
its schema (`cloudcodex-instance:<database>`, or a SHA-256 digest of a schema
name longer than 44 characters, since MySQL caps lock names at 64) and holds it
on a connection of its own until it stops. A second process pointed at the same
database refuses to start and says which MySQL connection holds the lock:

```
✖ Another Cloud Codex process (MySQL connection 8) already serves this database.
Two processes would hold two different copies of every open document. Stop the other one,
or set C2_INSTANCE_LOCK=0 if you know exactly why you need both.
```

To find it, `SELECT * FROM performance_schema.processlist WHERE ID = 8;` on the
MySQL server. The lock goes when its process does, a `kill -9` included, so
there is nothing to clean up. Instances on **different** schemas of one MySQL
server never contend, and `npm run migrate` uses a lock of its own, so the
one-off migration container never collides with the running app.

If MySQL restarts under a running app, the lock goes with the connection:
`/readyz` answers `lock` while the app tries to take it back on a new
connection, once a second. If another process got it first (a duplicate that
was being refused and reconnected sooner), the app that lost it logs
`another process took the instance lock while this one had lost it`, stops
through the normal shutdown and exits 1; under `restart: unless-stopped` it
then comes back as an ordinary refusal naming the new holder, and you stop
whichever one you did not mean to run. `C2_INSTANCE_LOCK=0` turns the lock off entirely; it is an
escape for an operator who knows why, not a way to run replicas.

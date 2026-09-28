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
   │   · port published on 127.0.0.1 only (APP_BIND)      │
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
   │   · 3306 on 127.0.0.1 in docker-compose-prod.yml     │
   └──────────────────────────────────────────────────────┘
```

---

## Compose files

| File                          | When to use                                        |
|-------------------------------|----------------------------------------------------|
| `docker-compose.yaml`         | **Dev** — MySQL only, app runs from `npm run dev`  |
| `docker-compose-release.yml`  | **Prod, published image** — no build toolchain     |
| `docker-compose-prod.yml`     | **Prod, from source** — builds `./cloudcodex`      |
| `docker-compose.linux.yml`    | Native-Linux override for the dev file: `:Z` SELinux labels on its bind mounts, merged by `start.sh` on Linux but not WSL; publishes no port |

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
| `TRUST_PROXY`              | Which proxies to believe about the client address, which is what the rate limiters count. Unset believes a proxy connecting from loopback or a private range, right for nginx or Caddy on the same host and for a load balancer with a private address. A hop count or `true` stops the boot. See [Rate limiters](#rate-limiters) |
| `TRUST_PROXY_ALLOW_HOP_COUNT` | Leave unset. `true` accepts a hop count or `true` in `TRUST_PROXY` anyway, knowing that any client able to reach the app's port can then choose its own address |
| `APP_BIND`                 | Compose only, not read by the server: the host address the app port is published on. Unset or blank is `127.0.0.1`. See [TLS and reverse proxy](#tls-and-reverse-proxy) |
| `DB_BIND`                  | `docker-compose-prod.yml` (and the dev file), not read by the server: the host address MySQL's 3306 is published on. Unset or blank is `127.0.0.1`, which a mysql client or `npm run migrate` on the host reaches. Widen it only on purpose; the release file does not publish 3306 at all |
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
if that is set. Both production compose files publish it as
`${APP_BIND:-127.0.0.1}:${PORT:-3000}:${PORT:-3000}`: `PORT` moves the port on
both sides of the mapping (update `APP_URL` to match, and remember the smoke
test below uses that port), and **the host side is `127.0.0.1`**, so only this
machine reaches the app. A browser on the same machine opens
`http://localhost:3000` as before, and so does a reverse proxy running on the
host.

**Production belongs behind a TLS-terminating reverse proxy**, not on the app
port. Docker's published ports are a DNAT rule that sits in front of the host
firewall, so a port published on every interface is reachable past `ufw deny`
by anything that can route to the machine, and a client reaching the app
directly skips TLS altogether.

To expose the port deliberately (a load balancer on another machine that must
reach it, or an evaluation from another computer on your network), set
`APP_BIND` in `.env` to `0.0.0.0`, or to one interface's address to publish on
that interface only, and restrict who can reach it at the network edge
(a cloud security group, not a host firewall rule Docker bypasses). A reverse
proxy running in **another container** cannot reach the host's loopback: join it
to this compose project's network and proxy to `app:3000` (or `app:$PORT`)
instead of widening `APP_BIND`.

Requirements the proxy must satisfy:

1. **WebSocket upgrade passthrough.** Both `/collab/:logId` and
   `/notifications-ws` rely on the HTTP upgrade dance. A proxy that strips
   `Upgrade` / `Connection` headers will silently break collab and
   notifications.
2. **Same-origin headers.** `services/user-channel.js` enforces an
   `Origin` host check against `Host`. If your proxy rewrites either,
   make sure both end up matching the public hostname.
3. **A client address the app can believe.** The proxy sets
   `X-Forwarded-For` (nginx: `proxy_set_header X-Forwarded-For
   $proxy_add_x_forwarded_for;`; Caddy does it by default), and it connects to
   the app from an address `TRUST_PROXY` trusts. Unset, that is loopback or a
   private range, which covers a proxy on the host (it arrives over the Docker
   bridge, as the network's gateway address) and a load balancer with a private
   address. A proxy connecting from a public address must be listed in
   `TRUST_PROXY`. See [Rate limiters](#rate-limiters).

Both WebSocket servers refuse a cross-origin upgrade themselves: each requires
an `Origin` whose host equals `Host`. Helmet's CSP (`connect-src 'self' ws: wss:`)
is not what enforces that. In production it does govern the page that opens the
sockets, but it allows any `ws:` or `wss:` host, and a CSP binds only the
browser that honours it, never a script calling the socket directly.

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
| `docker-compose-prod.yml` (built from source) | `docker compose -f docker-compose-prod.yml run --rm app npm run migrate` | Same shape, after `docker compose -f docker-compose-prod.yml build app`. 3306 *is* published here, on 127.0.0.1 unless `DB_BIND` says otherwise, so `cd cloudcodex && npm run migrate` on the host also works if you have run `npm install` there. |
| `docker-compose.yaml` (dev) | `cd cloudcodex && npm run migrate` | Dev has **no app container**: the writer to stop is `npm run dev` on the host. MySQL publishes 3306 on 127.0.0.1 and `node_modules` is installed, so the runner just runs there. |

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

The limiters count per client address. Express takes it from the connection,
and from `X-Forwarded-For` only while each hop it walks through, starting with
the peer that connected, is a proxy `TRUST_PROXY` trusts. So `TRUST_PROXY`
names the proxies, by address, never by count.

- **Unset** (the default) is `loopback, linklocal, uniquelocal`: a peer on
  loopback, a link-local address, or a private range (`10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`) is believed. That is nginx or
  Caddy on the same host, which reaches the container over the Docker bridge
  from the network's gateway address, a cloud load balancer with a private
  address, and a chain of them. A client connecting from any other address is
  counted by that address, whatever `X-Forwarded-For` it sends.
- **A list** of those names, addresses and CIDRs believes exactly those. Use it
  when the proxy connects from a public address, from an address outside those
  ranges (a Tailscale `100.64.0.0/10` address, for one), or when other machines
  on the same private network can reach the app port and you want only the
  proxy believed: for example `TRUST_PROXY=10.0.1.25` or
  `TRUST_PROXY=loopback,172.16.0.0/12`.
- **`false`** believes no proxy; every request is counted by the address that
  connected. Right with nothing in front of the app.
- **A hop count (`1`, `2`, ...) or `true` stops the server at boot.** Either
  believes the `X-Forwarded-For` of whoever connects, so any client that can
  reach the app's port directly sends a new address with every request and
  gets a fresh bucket each time: unlimited password and two-factor guessing
  (GHSA-9fmx-frrf-xxmq). If the port truly is reachable only through the proxy
  and its address cannot be known, `TRUST_PROXY_ALLOW_HOP_COUNT=true` accepts a
  hop count anyway, and with it that risk.
- **A range wide enough to take in public addresses stops the server at boot
  too**, naming the entry: wider than an IPv4 /8 (`0.0.0.0/1,128.0.0.0/1` is
  every address), wider than an IPv6 /16 outside `fc00::/7` and `fe80::/10`, or
  an IPv6 range that holds the IPv4-mapped block `::ffff:0:0/96` (every IPv4
  client, which Express matches in that form) or more than an IPv4 /8 of it.
  It is `true` by another name. `TRUST_PROXY_ALLOW_HOP_COUNT=true` accepts it,
  with the same risk.
- **Every entry is a subnet name or an address in standard notation**, with an
  optional prefix length or IPv4 netmask, or the server stops at boot even
  with the opt-in. Express's parser accepts more, and reads it in ways nobody
  expects: `0/1` is half of IPv4, and `010.0.0.0/8` is octal, `8.0.0.0/8`,
  which is public space.

A value Express cannot parse stops the server at boot too.

**If you run behind a proxy, check after upgrading** that a real client's
address reaches the app. Sign in through the proxy, then read the address the
app recorded for that session:

```bash
docker compose -f docker-compose-release.yml exec database \
  sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e \
  "SELECT ip_address, last_active_at FROM sessions ORDER BY last_active_at DESC LIMIT 3"'
```

Your own address is right. The proxy's address, or the Docker network's
gateway (such as `::ffff:172.18.0.1`), means one of two things: the proxy is not
trusted (list its address in `TRUST_PROXY`), or it does not set
`X-Forwarded-For`. Either way every user shares one bucket of 20 sign-in
attempts per 15 minutes.

---

## Health checks

There's no dedicated `/healthz` endpoint today. A reasonable check for
your platform's health probe is:

```bash
curl -fsS http://localhost:3000/api/oauth/providers
```

It returns `200` once the app has booted past its SMTP + admin checks
and has a working DB pool.

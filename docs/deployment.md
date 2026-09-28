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
   │   · network pinned to 172.29.0.0/16 (gateway .1)     │
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
docker compose -f docker-compose-release.yml up -d        # init.sql builds the schema
docker compose -f docker-compose-release.yml run --rm app \
   npm run migrate -- --adopt-fresh-install
```

This pulls `ghcr.io/cloud-city-computing/cloud-codex`, pinned by
`CLOUDCODEX_VERSION` (default `0.12.0`), so nothing is compiled locally and the
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
docker compose -f docker-compose-prod.yml up -d --build   # init.sql builds the schema
docker compose -f docker-compose-prod.yml run --rm app \
   npm run migrate -- --adopt-fresh-install
```

The second command, in either snippet, runs once, on a brand-new install only:
it records that the schema `init.sql` just built already has every migration,
and applies nothing, so the app can stay up for it. Until it runs, `/readyz`
answers `503 {"ready":false,"reason":"migrations"}`. An install you are
upgrading follows [Upgrades](#upgrades) instead, and
[First run: record a starting point, once](#first-run-record-a-starting-point-once)
says which command an older database needs.

The app container builds the Vite frontend during `docker build`. It
exits at startup, with a sentence naming the variable, if the admin
credentials are missing or `APP_URL` is unset. **Mail is optional**: with no
SMTP the server starts anyway, invitations show a link to copy instead of
being emailed, and password reset, email two-factor codes (so turning
two-factor off too) and notification emails are unavailable until it is
configured.

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
| `TRUST_PROXY`              | Which proxies to believe about the client address, which is what the rate limiters count, named by address. Unset is `127.0.0.1/32, ::1/128, 172.29.0.1/32`, right for nginx or Caddy on the same host in front of either compose file; without Docker, set `127.0.0.1/32, ::1/128`. A proxy container, a load balancer, or `docker run` must be listed. A hop count, `true`, or a range past the width thresholds stops the boot. See [Rate limiters](#rate-limiters) |
| `TRUST_PROXY_ALLOW_HOP_COUNT` | Leave unset. `true` accepts a hop count, `true` or an over-wide range in `TRUST_PROXY` anyway, knowing that any client able to reach the app's port can then choose its own address |
| `APP_BIND`                 | Compose only, not read by the server: the host address the app port is published on. Unset or blank is `127.0.0.1`. **An IPv4 address only**: `::` or an IPv6 address publishes to IPv6 clients, who arrive as the network's gateway and are trusted. See [TLS and reverse proxy](#tls-and-reverse-proxy) |
| `DB_BIND`                  | `docker-compose-prod.yml` (and the dev file), not read by the server: the host address MySQL's 3306 is published on. Unset or blank is `127.0.0.1`, which a mysql client or `npm run migrate` on the host reaches. Widen it only on purpose; the release file does not publish 3306 at all |
| `DB_POOL_SIZE`             | MySQL connections the app holds open, 1 to 100. Unset is `10` |
| `SMTP_*`                   | Optional; the server starts without them. Without them invitations show a copyable link, and password reset, email two-factor codes and notification emails are unavailable |
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
`APP_BIND` in `.env` to `0.0.0.0`, or to one interface's IPv4 address to publish
on that interface only, and restrict who can reach it at the network edge
(a cloud security group, not a host firewall rule Docker bypasses). Four
conditions come with it:

- **With nothing in front of the app, also set `TRUST_PROXY=false`.** An
  evaluation from another computer reaches the app directly, so there is no
  proxy to believe, and `false` counts every client by the address that
  connected. That holds on every Docker runtime, including the ones below that
  present every client as the gateway, so it is the rule rather than a guess
  about which runtime you have.
- **IPv4 only.** `0.0.0.0` publishes on IPv4 alone (measured: an IPv6 client is
  refused). `APP_BIND=::`, or any IPv6 address, publishes to IPv6 clients, and
  the pinned network is IPv4-only, so Docker's userland proxy carries each one
  in from the network's gateway, `172.29.0.1`, which the default trusts:
  measured, an IPv6 client then named a new address on every attempt and
  never met a limit. The general rule: **an IPv4-only Docker network presents
  every IPv6 client of an all-interfaces or IPv6 publish as its gateway.**
- **A load balancer that reaches a widened bind must be listed in
  `TRUST_PROXY` itself**: Docker hands the container its real address, which
  the default does not name, so until you list it every client behind it
  shares its one rate-limit bucket. See [Rate limiters](#rate-limiters).
- **Every container on the host can then reach the port, and arrives as the
  gateway.** A sibling on the compose network going to `172.29.0.1:PORT`, and a
  container on another Docker network going to the host's own address, are
  presented as `172.29.0.1`, so each is trusted and can name its own address.
  On a box that also runs Cloud Command, its containers are such peers. With
  `APP_BIND` on `127.0.0.1`, no container reaches the port except one sharing
  the host's network namespace.

Some Docker runtimes carry **all** published traffic through a userland
proxy, not only IPv6 and loopback: `dockerd` with `"iptables": false`, rootless
Docker with its default (`builtin`) port driver, and Docker Desktop on macOS,
Windows and Linux. There every client, local or not, arrives as the gateway.
Behind a proxy on the host, keep `APP_BIND` on `127.0.0.1`; with it widened
and nothing in front, `TRUST_PROXY=false` (above) is what keeps each client in
its own bucket. A widened bind behind a load balancer on such a runtime is not
safe while anything but the load balancer can reach the port.

A reverse proxy running in **another container** cannot reach the host's
loopback: join it to this compose project's network, proxy to `app:3000` (or
`app:$PORT`) instead of widening `APP_BIND`, and list its address, as shown in
[Rate limiters](#rate-limiters).

Requirements the proxy must satisfy:

1. **WebSocket upgrade passthrough.** Both `/collab/:logId` and
   `/notifications-ws` rely on the HTTP upgrade dance. A proxy that strips
   `Upgrade` / `Connection` headers will silently break collab and
   notifications.
2. **Same-origin headers.** `services/user-channel.js` enforces an
   `Origin` host check against `Host`. If your proxy rewrites either,
   make sure both end up matching the public hostname.
3. **A client address the app can believe.** The proxy connects from an
   address `TRUST_PROXY` names (a proxy on the host does, by default), and it
   **sets** `X-Forwarded-For`. For nginx as the only proxy, overwrite it with
   the address nginx saw:

   ```nginx
   proxy_set_header X-Forwarded-For $remote_addr;
   ```

   Caddy's `reverse_proxy` already does the equivalent. With a load balancer in
   front of nginx, append instead, so the client's address the load balancer
   added survives, and list the load balancer in `TRUST_PROXY`:

   ```nginx
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   ```

   Appending is safe under address trust **as long as the address the proxy
   appends is the real client's, and `TRUST_PROXY` does not also name it**:
   the app reads the chain from the right and stops at the first address it
   does not trust, which is that client's, so whatever the client put on the
   left is never reached. It stops being safe when the proxy sees a trusted
   address instead of the client's, which is what happens to a proxy in a
   container whose published port reaches IPv6 clients over an IPv4-only
   network: it appends the gateway, the app trusts the gateway, and the walk
   goes on to the client's own entry. **The fatal configuration is setting
   nothing**: nginx then passes the client's own header through, the app trusts
   the proxy that delivered it, and the client names its own address. See
   [Rate limiters](#rate-limiters).

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

### The pinned compose network (upgrading from 0.11.0 or earlier)

Both production compose files pin their default network to `172.29.0.0/16`,
gateway `172.29.0.1`, because `TRUST_PROXY`'s default names that gateway. An
install created by an earlier file has its `<project>_default` network (the
project is the directory name, so `c2_default`) on whatever subnet Docker
chose. **For this upgrade, take the project down before the migration**, so
the network is created fresh:

```bash
docker compose -f docker-compose-release.yml pull app
docker compose -f docker-compose-release.yml down     # NOT down -v: that deletes db_data and app_public
docker compose -f docker-compose-release.yml run --rm app npm run migrate
docker compose -f docker-compose-release.yml run --rm app npm run backfill:doc-images   # once, from 0.11.0 or earlier
docker compose -f docker-compose-release.yml up -d
```

`down` stops and removes both containers and the old network and keeps both
volumes. The usual order below (stop only the app, then migrate) is **not
safe here**, measured on a live 0.11.0 install with Compose 5.3.1: `run`
replaces the changed network, and when the database container's own
configuration has not changed Compose reconnects it to the new network
**without its `database` alias**, so the migration fails with
`getaddrinfo ENOTFOUND database`, and the following `up -d` starts an app that
cannot reach its database at all (measured before this release's instance lock,
while the health check still answered 200; with the lock, the app exits at boot
and restarts in a loop).
With `down` first, the same install migrated, came back on `172.29.0.0/16` and
kept both volumes, and so did one whose images changed as well.

`docker network inspect c2_default` should then show `172.29.0.0/16`. If another network on the host already uses that range,
Compose cannot create this one: change the subnet and gateway in the compose
file, and put the new gateway's `/32` in `TRUST_PROXY` in place of
`172.29.0.1/32`. The same applies to `docker-compose-prod.yml`.

**Rule:** `init.sql` and `migrations/*.sql` must stay in sync. Every
column or table added in a migration also lives in `init.sql` so a fresh
install converges to the same schema. New migrations are additive, no
file in `migrations/` is ever rewritten after it ships. The runner enforces
that second half: it checksums every file when it applies it, and refuses to
run again if one of them has changed since.

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
not paper over it, but nothing undoes the DDL either. For
`2026-09-08-token-purpose.sql` the error is 1265, `Data truncated for column
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

Nothing is applied there, so the app can stay up for that one. Until it runs,
`/readyz` answers `503 {"ready":false,"reason":"migrations"}` and Docker
reports the container `unhealthy`, because a database with no bookkeeping
cannot be shown to be migrated; the app serves requests either way. Every
upgrade after that is the four-step order above (the upgrade from 0.11.0 or
earlier takes the project `down` once instead of `stop app`, and runs the
document-images backfill before the start; see
[The pinned compose network](#the-pinned-compose-network-upgrading-from-0110-or-earlier)):

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
| `GET /api/documents/state` | 120 / 15 minutes per IP, counted before authentication |
| WebSocket messages   | 60 / second per connection      |

The limiters count per client address. Express takes it from the connection,
and from `X-Forwarded-For` only while each hop it walks through, from the
right, starting with the peer that connected, is a proxy `TRUST_PROXY` names.
So `TRUST_PROXY` lists the proxies **by address**: never by count, and not by
range, since a range believes every client inside it too.

- **Unset** (the default) is `127.0.0.1/32, ::1/128, 172.29.0.1/32`: a proxy
  on this host in front of either production compose file. Directly, it
  connects from loopback; through the loopback publish, Docker presents it to
  the container as the pinned network's gateway, `172.29.0.1`. Anyone else is
  counted by the address that connected, whatever `X-Forwarded-For` it sends: a
  public client, a machine on the same LAN, VPN or VPC (AWS's default VPC is
  `172.31.0.0/16`), and a sibling container on the compose network. The
  default bridge's gateway, `172.17.0.1`, is deliberately not in it; see
  `docker run` below. **An install run without Docker** (`npm run start` on the
  host) sets `TRUST_PROXY=127.0.0.1/32, ::1/128`: `172.29.0.1` means nothing
  there, and on a LAN that uses `172.29.0.0/x` it may be a real router.
- **A list replaces the default**, so keep the entries you still need and add
  your proxy. The setups the default does not cover:
  - *A proxy running as another container on the compose network.* Pin its
    address and list that `/32` with loopback, and **not** the gateway. Docker
    hands out addresses from the start of the range, so pick one near the end.
    In the proxy's own compose file, with this project's network (named after
    its directory: `c2_default` for a checkout in `c2/`):

    ```yaml
    services:
      caddy:
        image: caddy:2
        ports:
          - "0.0.0.0:80:80"
          - "0.0.0.0:443:443"
        networks:
          codex:
            ipv4_address: 172.29.255.10
    networks:
      codex:
        name: c2_default
        external: true
    ```

    ```dotenv
    TRUST_PROXY=127.0.0.1/32, ::1/128, 172.29.255.10/32
    ```

    Publish the proxy's ports on explicit IPv4 addresses, as above, or give the
    pinned network IPv6 (`enable_ipv6: true`, and a ULA subnet such as
    `fd29::/64` beside the IPv4 one in its `ipam` config). A plain `"443:443"`
    also publishes on `[::]`, and over an IPv4-only network every IPv6 client
    reaches the proxy as `172.29.0.1`: all of them then share one bucket, and
    had the gateway been listed, a proxy that appends would let each choose its
    own address.

    With IPv6 on the network, pin the proxy's IPv6 address too and list it:
    `app` then resolves to an AAAA record as well as an A record, and nginx or
    Caddy sends some requests from the proxy's IPv6 address, which an
    IPv4-only list does not name. In this project's compose file:

    ```yaml
    networks:
      default:
        enable_ipv6: true
        ipam:
          config:
            - subnet: 172.29.0.0/16
              gateway: 172.29.0.1
            - subnet: fd29::/64
    ```

    and in the proxy's, beside its `ipv4_address`:

    ```yaml
        networks:
          codex:
            ipv4_address: 172.29.255.10
            ipv6_address: fd29::ff10
    ```

    ```dotenv
    TRUST_PROXY=127.0.0.1/32, ::1/128, 172.29.255.10/32, fd29::ff10/128
    ```
  - *A load balancer with a private address*, reaching nginx on the host or,
    with `APP_BIND` widened, the app itself. List the subnets the load balancer
    runs in, beside the defaults:

    ```dotenv
    TRUST_PROXY=127.0.0.1/32, ::1/128, 172.29.0.1/32, 10.0.1.0/24, 10.0.2.0/24
    ```

    Every address in a listed subnet is believed, so give the load balancer
    **dedicated subnets** that nothing else runs in, and a security group that
    lets only the load balancer reach the port. With nginx between the load
    balancer and the app, nginx appends (`$proxy_add_x_forwarded_for`);
    overwriting would make every client the load balancer. **A layer-4 load
    balancer that sets no `X-Forwarded-For` (an AWS Network Load Balancer, for
    one) must not be listed at all**: it passes each client's own header
    through, so trusting it lets every client choose its address.
  - *The image run with `docker run` behind a proxy on the host.* Publish on
    loopback and add the default bridge's gateway:

    ```bash
    docker run -d -p 127.0.0.1:3000:3000 --env-file .env ghcr.io/cloud-city-computing/cloud-codex:<version>
    ```

    ```dotenv
    TRUST_PROXY=127.0.0.1/32, ::1/128, 172.17.0.1/32
    ```

    Only with that loopback publish. `-p 3000:3000` publishes on `[::]` too,
    the default bridge is IPv4-only, and every IPv6 client then arrives as
    `172.17.0.1`: with it listed, each one chooses its own address with no
    proxy involved. **An IPv4-only Docker network presents every IPv6 client of
    an all-interfaces or IPv6 publish as its gateway.** Without the entry, a
    bare `docker run` behind a proxy on the host puts every client in one
    bucket, and the warning below names `172.17.0.1`.
  - Subnet names (`loopback`, `linklocal`, `uniquelocal`) are still accepted,
    but each believes every client in its range, which is the gap the default
    closed: behind a proxy that appends, a client in a trusted range names its
    own address with the left entry.
- **`false`** believes no proxy; every request is counted by the address that
  connected. Right with nothing in front of the app.
- **A hop count (`1`, `2`, ...) or `true` stops the server at boot.** Either
  believes the `X-Forwarded-For` of whoever connects, so any client that can
  reach the app's port directly sends a new address with every request and
  gets a fresh bucket each time: unlimited password and two-factor guessing
  (GHSA-9fmx-frrf-xxmq). If the port truly is reachable only through the proxy
  and its address cannot be known, `TRUST_PROXY_ALLOW_HOP_COUNT=true` accepts a
  hop count anyway, and with it that risk.
- **A range past the width thresholds stops the server at boot too**, naming
  the entry: wider than an IPv4 /8 (`0.0.0.0/1,128.0.0.0/1` is every
  address), wider than an IPv6 /16 outside `fc00::/7` and `fe80::/10`, or
  holding more than an IPv4 /8 of the IPv4-mapped block `::ffff:0:0/96` (all of
  it is every IPv4 client, which Express matches in that form). Those are the
  thresholds, not "anything public": a public /8, or an IPv6 /16 to /31, is
  accepted and believes everyone in it, so list only what your proxy uses.
  `TRUST_PROXY_ALLOW_HOP_COUNT=true` accepts an over-wide range, with the same
  risk as a hop count.
- **Every entry is a subnet name or an address in standard notation**, with an
  optional prefix length or IPv4 netmask, or the server stops at boot even
  with the opt-in. Express's parser accepts more, and reads it in ways nobody
  expects: `0/1` is half of IPv4, and `010.0.0.0/8` is octal, `8.0.0.0/8`,
  which is public space.

**One limit the default cannot remove.** Every process on the host that
reaches the published port, and every container sharing the host's network
namespace, arrives as the gateway, so it is trusted and can name its own
address. With `APP_BIND` widened, so does every container on the host (see
"TLS and reverse proxy"), and on a runtime that carries all published traffic
through the userland proxy, so does every client, which is why a widened bind
with nothing in front sets `TRUST_PROXY=false`. The loopback bind decides who
can reach the port, not whether they are believed once they do.

**A proxy the list leaves out is logged, not silent.** When a peer
`TRUST_PROXY` does not name sends `X-Forwarded-For`, the server logs one line,
once per address (an IPv6 peer once per /64) and for at most 32 of them per
process:

```
⚠ <address> sent X-Forwarded-For, but TRUST_PROXY does not name <address> as a proxy, ...
```

If that address is your proxy, every client behind it is sharing one bucket:
add it. If it is a client talking to the app directly, the header was ignored,
as it should be.

A value Express cannot parse stops the server at boot too.

**If you run behind a proxy, check after upgrading** that the app keys each
client on the client's own address. First, the line the server prints once it
is listening, which says what it trusts and whether that is the default:

```bash
docker compose -f docker-compose-release.yml logs app | grep 'Trusting proxies'
# ✔ Trusting proxies (the default): 127.0.0.1/32, ::1/128, 172.29.0.1/32
```

`(from TRUST_PROXY)` means your value was used. Make sure the list names the
address your proxy connects from.

Second, **from a machine outside**, through the proxy's public address, send
two failed sign-ins that each claim a different address, and compare how many
attempts the app says are left:

```bash
for claimed in 203.0.113.98 203.0.113.99; do
  curl -s -o /dev/null -D - -H "X-Forwarded-For: $claimed" -H 'Content-Type: application/json' \
    -d '{"username":"nobody","password":"x"}' https://codex.example.com/api/login \
    | grep -i '^ratelimit-remaining'
done
```

- **One lower the second time** (say 19, then 18): both requests shared a
  bucket, so the claimed addresses were ignored. Go on to the third check.
- **The same number twice**: each claimed address got its own bucket, so any
  client can pick its key. The proxy passes the client's header through
  (it sets none), or it appends and the address it appends is one
  `TRUST_PROXY` trusts (an IPv6 client reaching a proxy container as the
  gateway, above). Fix that first.

Third, sign in through the proxy in a browser and read the address the app
recorded for that session:

```bash
docker compose -f docker-compose-release.yml exec database \
  sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e \
  "SELECT ip_address, last_active_at FROM sessions ORDER BY last_active_at DESC LIMIT 3"'
```

- **Your own address**: right.
- **The proxy's address**: the proxy is not trusted, so every user shares its
  one bucket of 20 sign-in attempts per 15 minutes. List it in `TRUST_PROXY`
  (the warning above names it too).
- **The Docker network's gateway** (`::ffff:172.29.0.1`): a proxy on the host
  is trusted but hands on no client address, so every user shares the
  gateway's bucket. If the second check passed, the proxy clears the header
  without setting it; if it failed, the proxy sets none and your browser simply
  sent none, which is the fatal case above.

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

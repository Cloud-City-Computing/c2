# Changelog

All notable changes to Cloud Codex are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions before 1.0.0 make no stability promise about the database schema.
Schema changes ship as a file in [`migrations/`](migrations/), applied with
`npm run migrate` from `cloudcodex/`, and `init.sql` runs only when MySQL
initialises an empty data directory.

## [Unreleased]

### Added

- `LEGACY_SESSION_COOKIE`: whether a lone `sessionToken` cookie, the name the
  session cookie had before it became `__Host-sessionToken` on https (see
  Security), still signs its holder in. Unset keeps it on; exactly `0` turns
  it off, for an https instance that shares its domain with hosts you do not
  control.

### Fixed

- **Signing in over plain `http` to an address other than `localhost` keeps
  its session.** The page wrote the session cookie with `Secure` whatever the
  scheme, and a browser drops a `Secure` cookie set over plain `http`, so the
  sign-in reloaded signed out. The page now marks it `Secure` on https only,
  and the Google callback decides `Secure` from `APP_URL`'s scheme (as its
  state cookie already did) rather than from `NODE_ENV`.
- **A first boot on an empty volume no longer restarts the app** (listed as a
  known gap in 0.12.0's release notes). The MySQL healthcheck in both
  production compose files pinged over the socket, which the image's temporary
  initialisation server (networking off, while it runs `init.sql`) answers, so
  the database reported healthy while nothing listened on 3306. The app then
  exited with `Could not open a MySQL connection for the instance lock:
  connect ECONNREFUSED` until `restart: unless-stopped` brought it back (the
  0.11.0 image, which has no instance lock, started instead without its admin:
  `admin user sync failed: ... ECONNREFUSED`). The check now pings `127.0.0.1`
  over TCP, which only the real server answers, with a 300-second start period
  so a slow initialisation is not marked unhealthy, and `start.sh` waits the
  same way (for up to three minutes instead of one). Measured on fresh
  volumes: `docker-compose-prod.yml` restarted the app 4 times in each of two
  boots before and 0 after, and `docker-compose-release.yml` built locally 6
  before and 0 after. A test pins the check in both files and in `start.sh`.
- **The app's inline SVG icons declare the real SVG namespace.** The rename
  from organizations to workspaces had reached inside a URL, so the sidebar's
  icons and the search and explore boxes' declared `www.w3.workspace` where
  `www.w3.org` belongs. React drew them anyway, which is why it went unnoticed,
  but the markup was not valid SVG. A test now fails on any XML namespace
  outside a short list of W3C ones, and on any URL whose host ends in a product
  word (workspace, squad, archive, log).
- **The container's log no longer opens with dotenv's banner.**
  `mysql_connect.js` and `services/email.js` each call `dotenv.config()`, and
  dotenv 17 printed `injecting env (0) from ../.env` and an advert for each
  call on every boot, because the image has no `.env`. Both calls are quiet
  now and still read the same file.
- **No more refused GitHub requests in the browser console.** A signed-out
  visitor's landing page asked `GET /api/github/status` and got a 401, and
  every document view by a user with no GitHub account linked asked
  `GET /api/github/link/:id` and got a 403. The layout now asks for the GitHub
  status only once its sign-in check has found a user, and the editor asks for
  a document's link only once that status says an account is linked. The
  server refuses both exactly as before. The standalone editor route
  (`/editor/:id`) now renders inside the layout the way the archive view's
  embedded editor already did, so it also waits for the sign-in check.
- **The self-hosting documentation matches the code.** `docs/deployment.md`,
  `README.md` and `docs/architecture.md` now all say SMTP is optional and what
  running without it turns off (emailed invitations, which become a link to
  copy, password reset, email two-factor codes and notification emails).
  Both first-install snippets in `docs/deployment.md` now include the one-time
  `npm run migrate -- --adopt-fresh-install`. Its "Stop every writer first"
  section appeared twice and is now one. The environment table in
  `docs/getting-started.md` lists every variable in `env-contract.js` it
  lacked (`PORT`, `C2_INSTANCE_LOCK`, `DOC_IMAGES_PUBLIC`, `SERVICE_TOKEN`,
  `SERVICE_TOKEN_USER`), marks `ADMIN_USERNAME` required, and describes
  `NODE_ENV`'s effect on CORS as `app.js` implements it, and a test now fails
  when the table misses an entry or contradicts its kind.
- **README's release quick start reaches a ready instance.** It ran compose in
  the foreground and stopped there, so a reader who followed it alone never ran
  the one-time `npm run migrate -- --adopt-fresh-install`: `/readyz` stayed 503
  `migrations` and the container unhealthy. It now matches the 0.12.0 release
  notes' "Run it" block (`up -d`, then the adopt step, with `APP_URL` named among
  what to fill in), and both first-install blocks in `docs/deployment.md` name
  `APP_URL` too. A test fails when any documented first install on a production
  compose file leaves out one of the three.
- **Running without SMTP no longer reads as an error in the boot log.** The
  documented mail-off mode printed `✖ Email disabled: SMTP_HOST, SMTP_USER or
  SMTP_PASS not set`, the same glyph as a boot that cannot start. It now
  prints a report line styled like the trusted-proxy one, `✔ Email off (...)`,
  naming what is unavailable. A configured SMTP server that fails verification
  still prints `✖ Email disabled: SMTP connection failed`, since that is a
  fault. `initMail()` now also returns `configured`, which is how the two are
  told apart.
- **The rate-limit tables list every limiter.** `docs/deployment.md` and
  `docs/security.md` left out the one on `GET /api/documents/state`, 120
  requests per 15 minutes counted before authentication, and `security.md`'s
  "Search" row now says it is the user search it limits.
- **The configuration contract describes `NODE_ENV` correctly.** Its entry in
  `cloudcodex/env-contract.js` said production "arms the rate limiters", but
  they are on in every mode except `test`. It now lists what production
  actually changes: the built app, the security headers on every response,
  `APP_URL` required, and no localhost origins.

### Security

- **On https the session cookie is `__Host-sessionToken`, and a write
  authenticated by that cookie alone must carry an accepted `Origin`.** Any
  host under the same registrable domain could set a `sessionToken` cookie for
  the whole domain with a longer path, which a browser sends first, and the
  server and the page both took the first `sessionToken` they found, so a
  sibling host could sign a visitor in as someone else. A browser refuses a
  `__Host-` cookie with a `Domain`, so no other host can set this one; it wins
  over a legacy `sessionToken` wherever the two sit, on the server and in the
  page, and no writer sets `Domain`. Every cookie reader matches the name
  exactly, stripping only the ASCII space and tab between cookies, so a cookie
  whose name merely looks like `__Host-sessionToken` is never read as it. A
  lone legacy cookie still works while `LEGACY_SESSION_COOKIE` is on (the
  default): on its next visit over https the page asks the server to confirm
  it and moves it to the new name, and until then does not use it; the page
  waits at most five seconds for that answer and asks once per tab. Over plain
  http the cookie keeps the old name, the only one a browser can hold there.
  Separately, an `/api` `POST`, `PUT`, `PATCH` or `DELETE` that carries the
  session cookie and no bearer header is refused with `403` unless its
  `Origin` is one the CORS rule accepts; CORS admitted a request with no
  `Origin` at all, and `SameSite=Strict` treats sibling hosts as the same
  site. The app's own requests, which send a bearer header or an `Origin`, and
  every server-to-server caller are unaffected. Both WebSockets already
  refused an upgrade with no `Origin` or a sibling's; tests now pin it.
- **On https the OAuth state cookies are `__Host-` cookies too.** The cookie
  that ties a Google sign-in or a GitHub link to the browser that started it
  is now `__Host-oauth_state_google` or `__Host-oauth_state_github` (Secure,
  `Path=/`, no `Domain`), and the callback reads the state under that exact
  name only, the same rule as the session cookie. Over plain http the names
  stay `oauth_state_google` and `oauth_state_github` at `Path=/api/oauth`.

### Migration

**The cookie renames need nothing run.** Browsers that hold the older
`sessionToken` stay signed in and move to `__Host-sessionToken` on their next
visit over https. An https instance that sets `LEGACY_SESSION_COOKIE=0` signs
those browsers out instead, once. A script that posts to `/api` with only a
session cookie now needs an `Origin` header or the bearer header. On an https
instance, a Google sign-in or GitHub link that was in progress while you
upgraded fails once with `invalid_state` and works when started again.

## [0.12.0] - 2026-09-28

The hosting-readiness release. One security fix: anyone who could reach the
app's port directly could choose their own address in `X-Forwarded-For` and
step around every rate limiter, including the sign-in and two-factor limit
([GHSA-9fmx-frrf-xxmq](https://github.com/Cloud-City-Computing/c2/security/advisories/GHSA-9fmx-frrf-xxmq)).
`TRUST_PROXY` now names the proxies it believes by address, the app port is
published on `127.0.0.1`, and the production compose files pin their network.
Alongside it: session tokens stored only as a digest, with one session per
sign-in; document images served only to people who can read the document;
`/healthz` and `/readyz`; a container that stops cleanly; one process per
database; a reconciliation read for Cloud Command; and the configuration
contract, with `APP_URL` required in production. **Upgrading from 0.11.0 is a
breaking change for an install reached directly from another machine, or
behind a proxy that does not connect from `127.0.0.1`, `::1` or `172.29.0.1`;
it takes the project `down` before migrating, applies two migrations and runs
one backfill. See below and Migration.**

**Upgrading: a production instance now refuses to start without `APP_URL`.**
Check that `.env` sets it to the address people use before pulling.
`.env.example` ships `http://localhost:3000`, which boots but now prints a
warning in production, since emailed links would open only on the server
itself. MySQL is now pinned to `mysql:8.4.11`: an install whose cached `mysql:8`
is older pulls it and upgrades its data directory in place on first start, so
back the database up first. This release also has two migrations and a
backfill; see Migration below.

**Upgrading, BREAKING: the app port is published on `127.0.0.1`, and
`X-Forwarded-For` is believed only from a proxy named by address.** An install
reached directly on port 3000 from another machine stops answering there: put
it behind a TLS-terminating proxy, or set `APP_BIND=0.0.0.0` in `.env` to
expose it on purpose (an IPv4 address, never `::`), with `TRUST_PROXY=false`
when nothing is in front of it. `docker-compose-prod.yml`
publishes MySQL on `127.0.0.1` too, so a database client on another machine
needs `DB_BIND` or an SSH tunnel. `TRUST_PROXY` now defaults to
`127.0.0.1/32, ::1/128, 172.29.0.1/32`, which covers nginx or Caddy on the same
host in front of either compose file and nothing else (an install run without
Docker sets `127.0.0.1/32, ::1/128`): **a proxy running as
another container, a load balancer, or the image run with `docker run`
behind a proxy is no longer believed until you list its address** (worked
values in "Rate limiters", `docs/deployment.md`); until then every client
behind it shares one rate-limit bucket, and the server logs a warning naming
it. For a single nginx, set `proxy_set_header X-Forwarded-For $remote_addr;`.
The production compose files now pin their network to `172.29.0.0/16`, so
**this upgrade takes the project down before migrating**:

```bash
docker compose -f docker-compose-release.yml pull app
docker compose -f docker-compose-release.yml down     # never down -v
docker compose -f docker-compose-release.yml run --rm app npm run migrate
docker compose -f docker-compose-release.yml run --rm app npm run backfill:doc-images
docker compose -f docker-compose-release.yml up -d
```

The usual stop-the-app-then-migrate order makes Compose replace the network
under a running database and reconnect it without its `database` alias, so the
migration and then the app cannot find it (see "Upgrades",
`docs/deployment.md`). The backfill runs once, on an install that already has
documents, between the migrations and the start (see Migration below).

### Added

- `GET /api/documents/state?workspaceId=<id>&ids=<id,id,...>`, a reconciliation
  read for Cloud Command: for up to 100 document ids it returns the id, title,
  archive and last update of each one the caller can read in that workspace.
  An id that is deleted, unreadable, in another workspace or in a system
  archive is simply absent, and the answer does not say which. It is the third
  route the service token (`SERVICE_TOKEN`) reaches, beside `GET /api/search`
  and `GET /api/browse`, and like them it acts with the service user's
  ordinary, never-admin access. Rate-limited to 120 requests per 15 minutes. No
  migration and no new setting.
- **`GET /healthz` and `GET /readyz`.** `/healthz` answers `{"ok":true}` while
  the process serves HTTP and touches nothing. `/readyz` answers
  `{"ready":true}`, or 503 with one reason: `shutting_down`, `lock`,
  `database` (`SELECT 1` failed or took over two seconds) or `migrations` (a
  file in `migrations/` is not applied, or the database was never adopted).
  Neither carries a version, a count or a name. However many probes arrive at
  once, `/readyz` has at most one `SELECT 1` and one migrations read out. The
  image has a Docker `HEALTHCHECK` on `/readyz`. See "Health checks" in
  `docs/deployment.md`.
- **One process per database.** At boot the app takes a MySQL lock named for
  its schema and holds it until it stops, so a second process pointed at the
  same database refuses to start and names the connection that holds it,
  instead of both keeping their own diverging copy of every open document.
  `C2_INSTANCE_LOCK=0` turns it off. Instances on different schemas of one
  server, and `npm run migrate`, never contend with it. If MySQL restarts, the
  app takes the lock back within a second; if another process got it first,
  the app that lost it stops and exits 1 rather than keep serving beside it.
- `cloudcodex/env-contract.js`, the configuration contract: every environment
  variable the server reads, whether it is required, required in production,
  defaulted (and to what) or optional, whether linking an instance to its
  workspace supplies it, and why. It is data only, so a paired product can pin
  a copy. A test parses the whole server and fails on a variable read without
  an entry, an entry nothing reads, or one missing from `.env.example`, and
  every stated default is checked against what the code does when the
  variable is unset or blank.
- `TRUST_PROXY`, Express's `trust proxy` setting, which decides the address the
  rate limiters count: a list of addresses and CIDRs (subnet names such as
  `loopback` are accepted too), or `false`. Unset is the address list
  described under Security, and a value Express cannot parse stops the boot
  with a sentence naming the variable.
- `DB_POOL_SIZE`, the MySQL pool's connection limit. Unset keeps today's 10;
  anything but a whole number from 1 to 100 stops the boot.

### Changed

- `POST /api/doc-images/upload` needs a `logId` form field naming the document
  the images go into, and write access to it: without one it answers `400`,
  without access `403`, and nothing is processed either way. The editor sends
  it. `DOC_IMAGES_PUBLIC` is new in `.env.example` (see Security).
- **The container stops cleanly.** The image runs `node server.js` instead of
  `npm run start`, so `docker stop` reaches the app. On SIGTERM or SIGINT it
  reports `shutting_down`, writes every open document's not-yet-saved live
  edits to the database (previously the last three seconds were lost), closes
  both WebSockets with code 1001, releases the lock and the pool, and exits 0,
  within ten seconds or exits 1. It says `stopped cleanly` only when every
  pending document was written. A stop signal during startup, or a second
  Ctrl-C, ends it at once. The production compose files give it
  `stop_grace_period: 20s`.
- **Both production compose files pin `NODE_ENV=production`**, and
  `.env.example` ships it commented out. The image now runs `node server.js`
  directly, so its own `ENV` is all that sets it, and a blank `NODE_ENV=` line
  in `.env` (the `.env.example` of 0.9.0 to 0.11.0 has one) would have
  replaced it with an empty value and started the container in development
  mode. An install that runs the image some other way should delete that line
  from its `.env`.
- **The stop and the probes need nothing run on upgrade**, and no migration of
  their own. Two things read differently: a brand-new install reports
  `unhealthy` until its one-time
  `npm run migrate -- --adopt-fresh-install`, which was already the documented
  first-run step (the log says so once), and a container started without the
  `./migrations` mount the compose files provide reports `migrations`, because
  it cannot check.
- **`APP_URL` is required in production.** With `NODE_ENV=production` (the
  Docker image and `npm run start`) the server exits at boot when it is unset,
  blank or not an `http`/`https` URL, instead of emailing invitation,
  password-reset and notification links that point at `http://localhost:3000`.
  One on `localhost`, `127.x.x.x`, `[::1]` or a `.localhost` name still boots,
  with a warning. Development keeps the default.
- MySQL is pinned to `mysql:8.4.11` in every compose file, both workflows and
  `start.sh`, instead of the floating `mysql:8`. Both tags resolve to the same
  image today, so an install that pulled `mysql:8` recently already has it.
  Compose does not re-pull a tag it has cached, so an older install may still
  run an earlier 8.4 (8.4.8 shipped before): it pulls 8.4.11, and MySQL
  upgrades the data directory in place on first start, so back it up first. A
  test fails on a floating tag or on two files disagreeing.

- **Both production compose files publish the app port on `127.0.0.1`**
  (`${APP_BIND:-127.0.0.1}:${PORT:-3000}:${PORT:-3000}`), not on every
  interface. A browser or reverse proxy on the same machine reaches
  `http://localhost:3000` as before; another machine no longer does, and
  neither does a proxy in another container that used the host's address (join
  it to the compose network and proxy to `app:3000` instead). Production
  belongs behind a TLS-terminating reverse proxy; to expose the port on
  purpose, set `APP_BIND` in `.env` to `0.0.0.0` or one interface's IPv4
  address (never `::` or an IPv6 address), and with nothing in front of it
  `TRUST_PROXY=false`.
  `docker-compose-prod.yml` also publishes MySQL as
  `${DB_BIND:-127.0.0.1}:3306:3306` instead of `3306:3306`: a mysql client or
  `npm run migrate` on the host still reaches it, and anything else needs
  `DB_BIND` set on purpose (the release file publishes no database port). The
  development file, `docker-compose.yaml`, does the same for its MySQL, which
  runs with a development password: the dev server, `make` and a `mysql`
  client on the same machine reach it as before, and nothing else on the
  network does. A test reads every compose file at the root with a YAML
  parser, pins every mapping, fails on any default beyond loopback in either
  port syntax, and checks that `docker-compose.linux.yml` publishes nothing,
  however it is spelled.
- **Both production compose files pin their default network** to
  `172.29.0.0/16`, gateway `172.29.0.1` (Cloud Command uses `172.28.0.0/16`),
  so the address a proxy on the host arrives from is one `TRUST_PROXY`'s
  default can name. An existing install's network is replaced by the `down`
  and `up -d` the upgrade note above describes.

### Fixed

- **Deleting an archive is recorded in the activity log.** The route looked
  up the archive's workspace only after deleting the row that led to it, so
  every `archive.delete` event was dropped. It now reads the workspace and
  squad first. An archive with no squad has no workspace and stays
  unrecorded, as before.
- **Renaming or moving a document in the archive tree is recorded.**
  `PUT /api/archives/:archiveId/logs/:logId` now logs `log.rename` when the
  title changes and `log.move`, with the previous and new parent, when the
  parent changes; re-sending the stored values logs nothing, and neither
  event notifies watchers. It also applies the title rules of
  `PUT /api/document/:logId/title` (required, at most 255 characters, the
  same 400 responses), where it used to accept any length and answer a
  non-string title with a 500, and it answers 404 for a document that is not
  in the archive instead of reporting success.
- **The archive tree no longer loses documents to a bad parent.** The same
  route wrote any `parent_id` it was given. A document put under itself or
  under one of its own descendants dropped out of the tree with everything
  below it. Each is now a 400. A document also could be moved, created
  (`POST /api/archives/:archiveId/logs`) or uploaded under a document in
  another archive; all three routes now refuse that with a 400. Moves in one
  archive now take turns, so two opposite moves sent at once can no longer
  both pass the check and leave two documents each under the other.
- **`PUT /api/document/:logId/title` answers a title that is not a string
  with a 400**, as the tree route now does, where it used to fail with a 500.
- **A fresh install on an SELinux-enforcing host gets its schema.**
  `docker-compose-release.yml` and `docker-compose-prod.yml` mounted `init.sql`
  read-only with no SELinux relabel, so on Fedora, RHEL and their relatives the
  MySQL container could not read it, the first boot's initialisation failed,
  and MySQL came up with no tables ("Table 'c2.users' doesn't exist"). Both now
  mount it `:ro,z`, as `migrations/` already was, and a test pins a label on
  every host bind mount in the two files. An install that already hit this
  starts again from an empty data directory; see `docs/troubleshooting.md`.
- **The migration lock fits any schema name.** `npm run migrate` against a
  schema whose name is longer than 45 characters failed with MySQL's
  `User-level lock name ... should not exceed 64 characters`. Such a schema
  now gets a lock named by a digest; every shorter name keeps the lock it had,
  so an older runner and this one still exclude each other.
- **A blank `SMTP_FROM` sends from the default address.** `.env.example` ships
  `SMTP_FROM=` blank, and a blank value was used as the From, so an install
  that turned email on from it sent every email with an empty From. Blank now
  behaves as unset (`Cloud Codex <noreply@cloudcitycomputing.com>`), and so do
  a blank `SMTP_PORT` (587), `DB_HOST` (`localhost`) and `DB_NAME` (`c2`), in
  the server and in `npm run migrate`.

### Security

- **The rate limiters can no longer be walked around by choosing your own
  address**
  ([GHSA-9fmx-frrf-xxmq](https://github.com/Cloud-City-Computing/c2/security/advisories/GHSA-9fmx-frrf-xxmq)).
  Express's `trust proxy` was `1`, so every
  limiter keyed on the rightmost `X-Forwarded-For` entry of any request that
  carried one, and both production compose files published the app port on
  every interface, where Docker's DNAT rule sits in front of the host
  firewall. Anyone who could reach port 3000 directly could send a new address
  with each request and get a fresh bucket every time: unlimited password and
  two-factor guessing past the sign-in limit of 20 per 15 minutes, and
  unlimited user search. The address recorded against each session came from
  the same header. Now:
  - `trust proxy` defaults to `127.0.0.1/32, ::1/128, 172.29.0.1/32`:
    loopback, and the gateway of the network the production compose files now
    pin, which is where Docker presents a proxy on the host. Every other peer
    is counted by its own address, whatever `X-Forwarded-For` it sends: a
    public client, a machine on the same LAN, VPN or VPC, and a sibling
    container. A range is not trusted by default, because a client inside a
    trusted range, behind a proxy that appends the header, could name its own
    address with the left entry. The default bridge's gateway, `172.17.0.1`,
    is not trusted either: `docker run -p PORT:PORT` publishes on IPv6 too,
    that bridge is IPv4-only, and every IPv6 client arrives as its gateway.
    An IPv4-only Docker network presents every IPv6 client of an
    all-interfaces or IPv6 publish as its gateway, which is also why
    `APP_BIND` must be an IPv4 address.
  - `TRUST_PROXY` takes a list of addresses and CIDRs, subnet names, or
    `false`. A hop count, `true`, or a range wider than an IPv4 /8, wider than
    an IPv6 /16 outside `fc00::/7` and `fe80::/10`, or holding more than an
    IPv4 /8 of the IPv4-mapped `::ffff:0:0/96` (all of it is every IPv4
    client) stops the boot with a sentence saying why, unless
    `TRUST_PROXY_ALLOW_HOP_COUNT=true` says you accept that any client able to
    reach the port can choose its own address. Those are the thresholds: a
    public /8, or an IPv6 /16 to /31, is accepted. An entry not written in
    standard notation always stops the boot, since Express reads `010.0.0.0/8`
    as octal, public `8.0.0.0/8`.
  - A peer `TRUST_PROXY` does not name that sends `X-Forwarded-For` is logged,
    once per address (an IPv6 peer once per /64) and for at most 32 of them,
    so a proxy left out of the list shows up in the log instead of silently
    putting every client in one bucket. Once listening, the server also prints
    what it trusts: `✔ Trusting proxies (the default): ...`, or
    `(from TRUST_PROXY)`.
  - The app port is published on `127.0.0.1` (Changed, above), and the prod
    file's MySQL port is no longer published on every interface.

  **If you run behind a proxy, check two things:** that `TRUST_PROXY` names the
  address it connects from (nginx or Caddy on the same host needs nothing; a
  proxy container, a load balancer or `docker run` must be listed), and that
  the proxy **sets** `X-Forwarded-For` (for nginx alone, `$remote_addr`;
  appending is also safe, and is what nginx behind a load balancer should do,
  as long as the address it appends is the client's own and not one
  `TRUST_PROXY` trusts). A proxy that sets nothing lets each client choose its
  own address. Every process on the host that reaches the published port, and
  with `APP_BIND` widened every container on the host, arrives as the gateway
  and is trusted too; the loopback bind is what keeps that to this machine.
  "Rate limiters" in `docs/deployment.md` has a check to run from outside,
  with a forged `X-Forwarded-For`, and says what each result means.
- **Session tokens are stored only as a SHA-256 digest, and every sign-in is
  its own session.** `sessions.id` held the raw token, so a copy of the table
  (a backup, a dump) was a list of working sign-ins; it now holds
  `hashSessionToken(token)`, and every lookup and delete hashes the presented
  token first. Each sign-in also gets a row of its own: a second device used to
  be handed the first device's token, so signing out anywhere signed out
  everywhere, and a sign-in after a password change was handed the caller's
  fresh token. Now `POST /api/logout` signs out only the device that sent it; a
  password reset, and an email or password change, still sign out every device.
  Each row records the flow that minted it (`sessions.auth_provider`, `local`
  or `google`), and the replacement an email or password change hands the
  caller keeps the tag of the session it replaces. Expired sessions are
  deleted daily.
- **Document images are served only to people who can read the document.**
  `/doc-images/<hash>.webp` was a public static mount, cached `public` for 30
  days, so anyone with an image's address could fetch it. It now serves an
  image to its uploader and to users who can read a document that holds it,
  cached `private` for a day; everyone else, signed in or not, gets the same
  empty `404`. A reference is recorded for a document only by the write that
  adds it, from a writer who can see the image, so pasting another document's
  image URL into a document you can write grants nothing, and neither does a
  later save, publish or restore of that document by someone who can see it.
  Export inlines only the images the exporting user can see. `DOC_IMAGES_PUBLIC=1` restores the old public mount. Avatars stay
  public.
- **In production the security headers cover the whole app, not only `/api`.**
  The single-page app's HTML, its built assets and the `/avatars` and
  `/doc-images` files now carry the Content-Security-Policy, including
  `frame-ancestors 'none'`, and `X-Frame-Options: DENY`. The policy also
  allows `https:` images (documents hold remote images, and a linked GitHub
  account's avatar is remote), turns off Helmet's `upgrade-insecure-requests`
  so an install served over plain `http` still loads, and sends
  `Cross-Origin-Opener-Policy: same-origin-allow-popups` so the draw.io
  editor popup can still answer the page. Development keeps the `/api`-only
  scope for the Vite dev server. Exporting a document as PDF now prints its
  window from the page rather than from a script written into the window,
  which the policy would block.

### Migration

**The session migration,**
[`migrations/2026-09-27-session-per-sign-in.sql`](migrations/2026-09-27-session-per-sign-in.sql),
adds `sessions.auth_provider` (existing rows become `local`, then the default is
dropped) with `CHECK (auth_provider IN ('local', 'google'))`, and hashes every
stored session id in place, so nobody is signed out by the upgrade. **Stop every
writer, apply it, then start the new image**, from `cloudcodex/`:

```sh
npm run migrate
```

In containers, `docker compose ... run --rm app npm run migrate` with the app
stopped. The schema is incompatible with the app in both directions: the old
image against it fails every sign-in (error 1364) and cannot find any existing
session, and the new image against the old schema fails every sign-in (error
1054) and cannot find any either. The hash step is idempotent (it skips any id
that is already a lowercase hex digest), so a re-run changes nothing it already
changed; if a run is interrupted partway, drop the column
(`ALTER TABLE sessions DROP COLUMN auth_provider;`) and run it again. There is
no rollback of the hash: going back to an older image means dropping the column
and every user signing in again. On an install that `init.sql` builds fresh,
`--adopt-fresh-install` checks that `auth_provider` is already there before it
records the file.

**The document-images migration,**
[`migrations/2026-09-27-who-may-see-doc-images.sql`](migrations/2026-09-27-who-may-see-doc-images.sql),
adds the `doc_images` table: which documents hold which image. Apply it with
`npm run migrate` as usual. **Then run the backfill once, before starting the
new image,** or every image in an existing document is hidden from its readers:

```bash
docker compose -f docker-compose-release.yml run --rm app npm run backfill:doc-images
# built from source: docker compose -f docker-compose-prod.yml run --rm app npm run backfill:doc-images
# dev: cd cloudcodex && npm run backfill:doc-images
```

It records every image that a document's current HTML or any of its versions
shows, and prints how many. It trusts every reference already stored, so run it
once, before the new image serves anyone, and not again after go-live: it
refuses to run over a table that already has rows, and
`npm run backfill:doc-images -- --again` is only for rerunning an interrupted
first run. If the app has to start before it runs, set `DOC_IMAGES_PUBLIC=1`
for that window (the backfill then runs without `--again`) and unset it after.
A fresh install needs neither. See `docs/deployment.md`, "The document-images
backfill, once".

## [0.11.0] - 2026-09-27

The account-security release. Three security fixes: Google sign-in no longer
links an account that has two-factor authentication on
([GHSA-6q9j-5qr9-7f2p](https://github.com/Cloud-City-Computing/c2/security/advisories/GHSA-6q9j-5qr9-7f2p)),
the boot admin sync no longer promotes an existing account
([GHSA-w8q3-r34w-3pjh](https://github.com/Cloud-City-Computing/c2/security/advisories/GHSA-w8q3-r34w-3pjh)),
and changing an account's email or password now needs its current password and
signs every device out. Google sign-in also no longer attaches a second Google
account to a user, which a database key now enforces for every provider.
Alongside them: an identity seam that sign-in methods resolve through, and
`AUTH_PROVIDERS` to choose which ones an instance offers. **Upgrading from 0.10.0
applies two migrations with `npm run migrate`, and the first refuses on an
install that already holds a double link; see Migration below.**

### Added

- `AUTH_PROVIDERS`, an optional comma list of the sign-in methods an instance
  offers (`local`, `google`), validated at boot. Unset keeps today's set: local
  always, Google when it is configured. A value naming an unknown provider,
  leaving out `local`, listing an unconfigured Google, or leaving out a
  configured one stops the boot with a sentence naming the variable.

### Changed

- `npm run migrate` reports a migration that refuses on purpose (a guard in the
  file raising `SIGNAL`) as a refusal: it leads with the guard's own message,
  says the file stays pending, and drops the guard procedure the file created,
  instead of warning that the database may be partially migrated. And
  `--adopt-fresh-install` now checks a key a newer migration adds against
  `information_schema`, as it already did for tables and columns.
- The account page says what happened after linking GitHub: the Linked
  Accounts panel shows "GitHub account linked." or the reason a link was
  refused (cancelled, expired, already linked to another user, and so on).
  It used to show nothing either way.
- **`POST /api/update-account` needs `currentPassword` for an email or password
  change.** Without it the request is a 400, with a wrong one a 401, and
  nothing is written either way; a name change needs nothing extra, and an
  `email` equal to the one on file is not a change. An email or password
  change now answers `{ success: true, token }`: every session of the user,
  the caller's included, has been deleted, so a client must store the returned
  token in place of the one it sent. For an account with no password, an
  email change answers `{ success: true, requires_email_code: true,
  confirmToken }` and completes at the new
  `POST /api/update-account/confirm-email` with `{ confirmToken, code }`. Both
  routes now share the sign-in rate limit (20 requests per 15 minutes per IP).
  See `docs/api/auth.md`.

### Fixed

- The account page's **Update Info** button never saved anything: the panel
  sent no session token in the request body, so every submit came back "Error
  updating account: Token and userId are required". It now sends the token,
  and only the fields that changed.
- The 6-digit code row (the account page's email confirmation and the
  two-factor setup and disable steps) no longer pushes its Cancel button out of
  view on a phone-width screen.
- The Linked Accounts panel told an account with no password to "Set a
  password in Account Info above", which has never been possible; it now points
  at "Forgot Password?" on the sign-in screen.
- Relinking GitHub to an account that another user already has linked answered
  with a server error. It is now refused as `already_linked_other`, as a first
  link always was, and the account page says so.

### Security

- **Google sign-in no longer links an account that has two-factor
  authentication on**
  ([GHSA-6q9j-5qr9-7f2p](https://github.com/Cloud-City-Computing/c2/security/advisories/GHSA-6q9j-5qr9-7f2p)).
  Signing in with Google for the email of an existing account with no Google
  account linked yet linked the two and signed in, without asking for that
  account's two-factor code. An account with two-factor on (authenticator app
  or email code alike) is now never linked by email: the sign-in is refused as
  `/?oauth_error=two_factor_enabled` with nothing written, and the sign-in form
  says to sign in with the password and code instead. A Google account that is
  already linked signs in as before, without the local code, even after its
  user turns two-factor on: once linked, Google's own sign-in, its MFA
  included, governs the account. Links made before this release are kept, and
  the database cannot tell one the owner made from one made without their
  second factor. `docs/troubleshooting.md` has a query listing every Google
  link made by email. Ask each owner whether they linked Google themselves;
  where that cannot be confirmed, delete the link (the owner can link again
  deliberately) and the account's session:

  ```sql
  DELETE FROM oauth_accounts WHERE user_id = <id> AND provider = 'google';
  DELETE FROM sessions WHERE user_id = <id>;
  ```

  The session goes too because an account has one session, shared by every
  sign-in to it, so removing the link alone leaves whoever used it signed in.
  A password reset through Forgot password also ends every session, and so,
  from this release, does an email or password change (below), so either does
  the same job as the second statement. Then have the owner confirm that the
  account's email address, password and two-factor setting are theirs: before
  this release a session alone was enough to change the first two.
- **The boot admin sync no longer promotes an existing account**
  ([GHSA-w8q3-r34w-3pjh](https://github.com/Cloud-City-Computing/c2/security/advisories/GHSA-w8q3-r34w-3pjh)).
  At every boot the server makes sure the admin named in `.env` exists. It
  looked for an account whose name was `ADMIN_USERNAME` or whose email was
  `ADMIN_EMAIL`, took whichever it found first, made it an admin, and replaced
  its password and email with `ADMIN_PASSWORD` and `ADMIN_EMAIL`. So an
  ordinary member who held that name or that address became the instance admin
  at the next restart, and any session they already had was an admin session
  from then on. The simplest way there was for a member to change their own
  name or email to the one the admin had just given up. Boot now does one of
  three things and logs one line saying which, never the password: it
  **creates** the admin when no account matches; it **syncs** an account that
  is already an admin, whose email and password `.env` still resets at every
  boot, as before; and when a matching account is not an admin it **refuses**,
  changing nothing (not that account, and not the admin's either), and logs:

  ```
  admin sync: <ADMIN_USERNAME> / <ADMIN_EMAIL> matches an existing non-admin account (user <id>), refusing to promote it. Promote it in the admin console if that is intended.
  ```

  If that line appears, decide whose name or address it is. If that account is
  meant to be the admin, promote it in the admin console (Users, click its
  **User** badge); from the next boot on it is synced like any admin, so its
  email and password become `ADMIN_EMAIL` and `ADMIN_PASSWORD`. If it is not,
  set `ADMIN_USERNAME` and `ADMIN_EMAIL` to the admin's current name and
  address, or to a name and address no account uses to have boot create a
  fresh admin, and restart. If you ran an earlier release, look in the Users
  panel for an admin you did not make: revoke it there (boot no longer puts it
  back), and treat that account as one that had admin access.
- **Changing an account's email or password now needs its current password,
  and signs every other device out.** Before, anyone holding a signed-in
  session could change the account's email and password with nothing else, and
  a password change deleted every session except the caller's own. Sessions
  are one per account today, so the caller's session is the same one every
  other device holds: a stolen session survived the owner changing their
  password, and could itself change the email and take the account over. Now
  the account page asks for the current password when the email field is
  changed (there is still no password field on that page; passwords change
  through "Forgot Password?"), a wrong one is refused with "Your current
  password is incorrect.", and after the change every device signed in to the
  account is signed out while the one that made the change carries on with a
  new session. The old address gets an email saying the address was changed.
  An account created by an external sign-in has no password to give, so its
  email change is confirmed with a 6-digit code sent to its current address;
  when this instance cannot send email, that change is refused with a sentence
  saying why. Such an account still sets a first password only through Forgot
  Password. A name change is unaffected.
- **Google sign-in no longer attaches a second Google account to a user.** A
  Google account not yet linked to anyone was linked to whichever user held its
  verified email, even when that user already had a different Google account
  linked, so a reassigned Workspace address or a deleted and recreated Google
  account signed straight into the previous owner's account. That case is now
  refused as `/?oauth_error=identity_conflict` with nothing written, and the
  sign-in form says so. Relinking is by hand; see `docs/troubleshooting.md`. A
  double link made before this release is not undone automatically: the
  migration below refuses to run until an operator resolves it.
- **The same rule is now a database key.** `oauth_accounts` gains
  `UNIQUE (user_id, provider)`, so two different Google accounts signing in for
  one user at the same instant can no longer both be linked. The one that lands
  second gets the same `identity_conflict` answer instead of an error. The same
  holds for GitHub linking: of two GitHub accounts linking one user at once, the
  second is refused as `/account?github_error=link_conflict` instead of a 500.

### Migration

**The one-link-per-provider migration,**
[`migrations/2026-09-25-oauth-one-link-per-provider.sql`](migrations/2026-09-25-oauth-one-link-per-provider.sql),
adds `UNIQUE KEY uq_oauth_user_provider (user_id, provider)` to
`oauth_accounts`. Apply it with `npm run migrate` from `cloudcodex/`, not by
piping it into the `mysql` client, which splits the file's guard procedure on
its semicolons. Stopping writers is not required: new code against the old
schema only carries a catch that never fires, and old code against the new
schema gets an error, not a second row, where it would have written a double
link.

**It refuses, and deletes nothing, on an install where some user already holds
two links to one provider.** The refusal names the query that lists every
offending `(user_id, provider)` pair, which you can run yourself before
upgrading:

```sql
SELECT user_id, provider FROM oauth_accounts GROUP BY user_id, provider HAVING COUNT(*) > 1
```

To resolve a pair it lists, take a dump, look at the rows, and decide which
link the person really signs in with:

```sql
SELECT id, provider_user_id, provider_email, provider_username, created_at
  FROM oauth_accounts WHERE user_id = <user_id> AND provider = '<provider>';
DELETE FROM oauth_accounts WHERE id = <id of the link to remove>;
```

Then run `npm run migrate` again; the refused file is still pending and applies
once the query returns no rows. Deleting a Google link stops that Google account
signing in to the user; deleting a GitHub link drops its stored token, and the
user relinks GitHub from the account menu. A refused run leaves the schema as it
found it: nothing is recorded, and the runner drops the throwaway guard
procedure (`migration_guard_oauth_one_link_per_provider`) the file creates.

**The email-change token migration,**
[`migrations/2026-09-25-token-purpose-email-change.sql`](migrations/2026-09-25-token-purpose-email-change.sql),
adds `password_reset_tokens.new_email`, widens the `purpose` `CHECK` to include
`email_change`, and adds `chk_password_reset_tokens_new_email`, which requires
an address on every `email_change` row and refuses one on any other. Apply it
with `npm run migrate` from `cloudcodex/`. Stopping writers is not required:
old code never names the column and mints only rows both constraints accept,
and new code against the old schema fails only an email change on an account
with no password (a 500 until the file is applied). Rows already in the table
satisfy both constraints, so it applies with rows present. On an install that
`init.sql` builds fresh, `--adopt-fresh-install` checks that `new_email` is
already there before it records the file.

## [0.10.0] - 2026-09-25

The security and infrastructure release. Everything since 0.9.0 closes a
defect in the shipped image or makes an install upgradable: four places where
one workspace could reach into another, a credential-flow bug, a GitHub
account link that a second person could complete, GitHub link routes that
checked nothing, a migration runner so an upgrade can actually be
applied, and the first machine interfaces a paired product (Cloud Command) reads
through. **Upgrading from 0.9.0 needs one extra step; see Migration below.**

### Added

- A database migration runner (`cloudcodex/scripts/migrate.js`,
  `npm run migrate`). It applies pending `migrations/*.sql` in lexicographic
  order, records each in a new `schema_migrations` table with its sha256, and
  refuses to run when an already-applied file has been edited. Concurrent runs
  are serialised by a MySQL advisory lock. Each database takes one adoption
  command first: `npm run migrate -- --baseline` for a database that already
  existed before this release (the usual case, and the one an upgrade is in), or
  `npm run migrate -- --adopt-fresh-install` for one `init.sql` has just built.
  The second records every file without running any, so it refuses unless the
  live schema already contains what each post-baseline file adds, and it prints
  the exact list before adopting it. Both adoption modes write their rows in one
  transaction. MySQL implicitly commits DDL, so a failed migration reports that
  the database may be partially migrated rather than claiming a rollback, except
  for the duplicate-object errors, which say the schema already has the change
  and how to record it. The release and prod compose files now mount
  `migrations/` into the app container (`:ro,z`, so the mount is readable on an
  SELinux host), which is where the runner runs when MySQL is not published to
  the host: `docker compose ... run --rm app npm run migrate`, in a one-off
  container, after stopping the app.
- **A scoped service token, for a machine that needs to read your documents.**
  Set `SERVICE_TOKEN` (at least 32 characters) and `SERVICE_TOKEN_USER` (the
  email of an existing, non-admin user) and a caller presenting
  `Authorization: Bearer <SERVICE_TOKEN>` can read `GET /api/search` and
  `GET /api/browse`, and nothing else. Set neither and nothing changes: there
  is no new authentication path on an install that does not opt in.
  The token acts as that user through the ordinary archive ACLs, so you widen
  or narrow what a machine sees by changing that user's squad membership and
  archive grants, not by editing permission code. An admin
  `SERVICE_TOKEN_USER` is refused outright, because an admin principal matches
  every archive in the install. Rotating the secret is immediate and needs no
  database change, and any caller still holding the old value starts getting
  401s. See [`docs/security.md`](docs/security.md) and `.env.example`.
- **A workspace reader check, for the product the service token serves.**
  `GET /api/workspaces/:workspaceId/reader-check?email=<address>` answers
  `{ "canRead": true | false }` to the service token and to nothing else: a new
  `requireMachine` guard refuses a signed-in session with the same 401 an
  anonymous caller gets, because the answer is about someone else's access.
  "Can read" means an admin, the workspace owner, or a member of any squad in
  that workspace. An unknown email, an unauthorised user and a workspace that
  does not exist all answer `false` identically, and the route shares the login
  rate limit. Cloud Command asks it before letting an admin map a workspace. An
  install without `SERVICE_TOKEN` is unaffected.

### Changed

- CI builds the production frontend as well as linting, testing and checking
  coverage, and that check is required on `main`, so a red run can no longer
  merge.

### Fixed

- **Documents over 64 KiB save.** `logs.html_content`, the `plain_content`
  generated from it and `versions.html_content` were `TEXT`, so a save between
  64 KiB and the application's own 2 MiB ceiling failed with an opaque 500 and
  the edit was lost. All three are `MEDIUMTEXT`
  ([`migrations/widen_log_content.sql`](migrations/widen_log_content.sql)).
- **Squad-to-GitHub-team sync no longer removes members past the first page.**
  Both routes fetched one page of team members and treated everyone beyond it
  as removed. They paginate now, and a truncated listing removes nobody.
- **The `email_squad_invite` preference is honoured.** Squad invitation emails
  were sent whatever it said.
- **Committing a file through the browser no longer marks its linked documents
  clean.** `PUT /api/github/contents/*` set every linked document's merge base
  to the new commit, so the next push from any of them silently overwrote the
  change. It now records the new remote version and marks them `remote_ahead`.
- **Document titles are reachable by keyboard** in the browse grid, the archives
  page, the editor's page tree and the search dropdown, which closes the 0.9.0
  known gap.
- **Glyph-only controls have names.** Twelve controls announced as their glyph
  (a star, a plus, a cross) rather than their purpose; each now names what it
  does and to which document, and the version history row is a real button.
- `docs/deployment.md` documented applying migrations with
  `source /var/lib/mysql/migrations/<file>.sql` inside `make db-shell`. No
  compose file mounts `migrations/` into the MySQL container, so that path does
  not exist there and the documented upgrade path could not work.
- The upgrade procedure now stops the app before migrating and runs the runner
  in a one-off container. `docker compose exec app` runs inside the container
  that is already running, which on the upgrade that first ships the runner is
  the old image: no `migrate` script, and no `/migrations` mount, because
  `docker compose pull` does not recreate a container.

### Security

- **OAuth state is bound to the browser that started the flow**
  ([GHSA-34pj-8475-rqwf](https://github.com/Cloud-City-Computing/c2/security/advisories/GHSA-34pj-8475-rqwf)).
  The GitHub link callback trusted a state value for whichever browser
  completed it, so a link one user started could be completed by another, and
  the second person's GitHub token was stored against the first person's Codex
  account. Each initiation now sets a short-lived httpOnly, SameSite=Lax cookie
  holding the state, one per provider, and each callback refuses, before any
  token exchange or write, unless the completing browser presents the same
  value. A refused attempt still consumes the state. Google sign-in gets the
  same binding.
- **Typed `password_reset_tokens.purpose`.** Four flows mint into that table
  (password reset, the 2FA login challenge, TOTP enrolment, the 2FA-disable
  confirmation) and no reader constrained which flow minted the row it found.
  `POST /api/login` returns its 2FA challenge token to the caller, and
  `POST /api/reset-password` accepted it. Impact was a persistent password
  rewrite plus a full session wipe of the victim, so lockout and an integrity
  defect: reset-password issues no session and does not clear
  `two_factor_method`, and the caller must already hold the victim's password
  to reach the challenge. Not account takeover.
- **`POST /api/logout` terminates the server-side session.** It read
  `req.body.token`, which no client sends, so every logout was a 400 the caller
  swallowed and no `sessions` row was ever deleted. It now resolves the token
  the same way `requireAuth` does.
- **The workspace is a tenant boundary.** Four surfaces read a global
  permission flag as "may act in any workspace": squad creation let any account
  make itself a squad owner inside any workspace; `POST /api/archives` let any
  account plant an archive in any squad; the archive access-grant route wrote
  any user or squad id into an archive's grants; and `GET /api/users/search`
  returned every account and its email address across the install. All four now
  check workspace membership, and answer 404 where a 403 would confirm that a
  workspace exists.
- **GitHub link routes check document access.** `GET`, `PUT` and
  `DELETE /api/github/link/:logId` checked nothing, so any user could read
  another document's GitHub binding, repoint that document's next push into a
  repository of their own, or delete the binding. They now require read, write
  and write access respectively.
- **A read-only collaborator can no longer rename a document** through the
  collaborative-editing socket, the one mutating message that was not gated on
  write access.
- **Pull-request discussions are scoped to the pull request.** A PR opened as a
  document is granted through a hidden archive of its own, and the session route
  asks GitHub whether the caller can see the pull request before creating one.

### Removed

- The `squad_permissions` table and its two routes. Nothing enforced them, so a
  value saved there changed no behaviour
  ([`migrations/drop_squad_permissions.sql`](migrations/drop_squad_permissions.sql)).

### Migration

**Upgrading from 0.9.0: one extra step.** Two files on the runner's pre-runner
list, `widen_log_content.sql` and `drop_squad_permissions.sql`, shipped after
0.9.0 was tagged, so a database that has only ever run 0.9.0 does not have them,
but `npm run migrate -- --baseline` records them as applied without running
them. After `--baseline`, and before starting the new image, apply both by hand.
Both are idempotent, so running them on a database that already has them is
harmless:

```bash
for f in widen_log_content drop_squad_permissions; do
  docker compose -f docker-compose-release.yml exec -T database \
    sh -c 'exec mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
    < "migrations/$f.sql"
done
```

Without the first, documents over 64 KiB still fail to save on the upgraded
install.

**The token-purpose migration,**
[`migrations/2026-09-08-token-purpose.sql`](migrations/2026-09-08-token-purpose.sql):
**stop every writer, apply, then start the new image**, and note there is no
rollback. The new column is `VARCHAR(32) NOT NULL` with a `CHECK` constraint and
no `DEFAULT`, which makes the schema incompatible with the application in both
directions, and the migration deletes existing token rows because they cannot be
classified after the fact: in-flight password resets and 2FA challenges must be
restarted. Apply it with the new runner (`npm run migrate`), which lands in the same
release. Full reasoning is in the migration header and in
[`docs/deployment.md`](docs/deployment.md).

## [0.9.0] - 2026-08-08

The first release since the March alpha. Five months of work, most of it aimed
at the gap between "this looks interesting" and "this is running on my server":
the app now boots without SMTP configured, lands a new admin inside a seeded
workspace, and publishes a container image so evaluating it does not require a
build toolchain.

### Added

- **Published container image.** `ghcr.io/cloud-city-computing/cloud-codex` is
  built and pushed on every version tag, and
  [`docker-compose-release.yml`](docker-compose-release.yml) runs a release
  without compiling anything locally.
- **First-run experience.** A guided welcome that every user reaches, including
  the admin synced from `.env` at boot, backed by a new `GET /api/first-run`.
  It creates nothing, it points at the squad, archive and document the user
  already has, or at their pending squad invitations if they are in no squad
  yet.
- **Invitations that land somewhere.** `POST /api/admin/invitations` can carry a
  `squadId`, a role and permission flags, so an invited user joins that squad in
  the same transaction that creates their account.
- **Mail-optional boot and a non-empty first boot.** `initMail()` degrades
  instead of exiting when no SMTP is configured, and `bootstrapInstance()` seeds
  a workspace so a fresh admin does not land on an empty screen.
- **Admin-side two-factor reset**, for the account that has lost its device.
- **Notifications, activity feed, and watches.** One funnel for every
  user-facing alert, with per-user email preferences, a push-only user-scoped
  WebSocket, coalescing windows, and watches that cascade from an archive to its
  documents.
- **GitHub integration**, as a live API proxy with no webhooks and no background
  sync: repository browsing, file add / delete / rename / move, commit history
  drill-down and diff view, pull requests, bidirectional document sync with a
  local three-way merge, live code embeds, and manual squad-to-team sync.
- **Draw.io diagrams** in documents, searchable by label, alongside syntax
  highlighting, resizable images, mentions, and inline comments.
- **Google Workspace SSO** and GitHub OAuth, with tokens encrypted at rest.
- **Admin console** for workspaces, users, invitations, squads, permission
  flags, and live presence telemetry.
- **Deep documentation maps** in [`docs/maps/`](docs/maps/), each citing
  `file:line`, plus an adoption roadmap in [`docs/specs/`](docs/specs/).
- **Test suite and coverage gates.** Backend Vitest + Supertest and frontend
  Vitest + jsdom as separate projects, with per-glob coverage thresholds
  enforced in CI.
- **Mobile CSS** across the interface.
- `CODE_OF_CONDUCT.md`, and this changelog.
- An application-wide error boundary, so a render failure is recoverable rather
  than a blank page.

### Changed

- **Workspace ownership is a foreign key.** `workspaces.owner` was a TEXT column
  holding an email address with no constraint, so changing your email silently
  lost ownership and a deleted user's address could be inherited by a later
  signup. It is now `workspaces.owner_id`, an `INT` FK to `users(id)` with
  `ON DELETE SET NULL`.
- **The production image is a multi-stage build**, 2.86 GB to 679 MB. The
  previous single-stage image shipped devDependencies and, lacking a
  `.dockerignore`, a second copy of `node_modules` carried in from the host.
- **The editor is Tiptap 3** on ProseMirror, replacing the previous WYSIWYG.
- **Collaborative editing uses native Yjs binary sync** for conflict-free merges.
- **Vocabulary settled** on Workspaces, Squads, Archives and Logs, and a
  commitment that a day-one user meets three levels: Squad, Archive, Log. The
  welcome screen now says three rather than four, matching that.
- Documentation reorganised around per-area API contracts and architecture docs.

### Fixed

- **Navigating away from an open editor no longer blanks the application.** The
  collaborative cursor and comment overlays were rendered into DOM that
  ProseMirror owns, so tearing the editor down threw during unmount and, with no
  error boundary anywhere, took down the whole page until a manual reload.
- **The app has an error boundary.** A render error now shows a recoverable
  message instead of an empty window.
- **Same-origin API requests work in production.** A self-hosted instance
  following `.env.example` rejected its own browser's writes with a 500, which
  made logging in impossible.
- **`PORT` is honoured** through the app, Docker, and `start.sh`, and the boot
  log no longer reports a successful start when the bind actually failed.
- **Account creation is rejected when the invitation was revoked mid-signup.**
- Admin invitations send working default permissions instead of a no-op role.
- The welcome flow awaits its completion request before navigating away.
- Failing API endpoints return real HTTP status codes rather than a bare 200.
- `.env.example` and the README agree on variable naming.

### Removed

- **`POST /api/setup`** and its unused `setupWorkspace` frontend wrapper. It had
  no callers, and its only behaviour was creating an archive with a `NULL`
  `squad_id`, an orphaned archive that only its creator could ever reach.
- The `workspaces.owner` TEXT column, replaced by `owner_id`.

### Known gaps

- The published image is `linux/amd64` only. Apple Silicon runs it under Docker
  Desktop's emulation.
- The `LICENSE` is a bespoke source-available licence, so GitHub reports it as
  "Other". This is deliberate, not an oversight.
- Documents edited only over the collaborative WebSocket have a stale
  `html_content` until an explicit save, which affects search, exports, and
  GitHub pushes. See [`docs/maps/documents-and-collab.md`](docs/maps/documents-and-collab.md).
- Document titles in list views are click-only and cannot be reached by
  keyboard.

## [0.1.0-alpha] - 2026-03-27

Initial public pre-release.

[Unreleased]: https://github.com/Cloud-City-Computing/c2/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/Cloud-City-Computing/c2/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/Cloud-City-Computing/c2/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/Cloud-City-Computing/c2/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/Cloud-City-Computing/c2/compare/alpharelease...v0.9.0
[0.1.0-alpha]: https://github.com/Cloud-City-Computing/c2/releases/tag/alpharelease

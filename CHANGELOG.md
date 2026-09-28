# Changelog

All notable changes to Cloud Codex are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions before 1.0.0 make no stability promise about the database schema.
Schema changes ship as a file in [`migrations/`](migrations/), applied with
`npm run migrate` from `cloudcodex/`, and `init.sql` runs only when MySQL
initialises an empty data directory.

## [Unreleased]

**Upgrading: a production instance now refuses to start without `APP_URL`.**
Check that `.env` sets it to the address people use before pulling.
`.env.example` ships `http://localhost:3000`, which boots but now prints a
warning in production, since emailed links would open only on the server
itself. MySQL is now pinned to `mysql:8.4.11`: an install whose cached `mysql:8`
is older pulls it and upgrades its data directory in place on first start, so
back the database up first. No migration.

**Upgrading: the app port is published on `127.0.0.1`, and `X-Forwarded-For`
is believed only from a proxy on loopback or a private network.** An install
reached directly on port 3000 from another machine stops answering there: put
it behind a TLS-terminating proxy, or set `APP_BIND=0.0.0.0` in `.env` to
expose it on purpose. `docker-compose-prod.yml` publishes MySQL on `127.0.0.1`
too, so a database client on another machine needs `DB_BIND` or an SSH tunnel.
Behind a proxy, check that a real client's address still reaches the app
(Security, below).

### Added

- `cloudcodex/env-contract.js`, the configuration contract: every environment
  variable the server reads, whether it is required, required in production,
  defaulted (and to what) or optional, whether linking an instance to its
  workspace supplies it, and why. It is data only, so a paired product can pin
  a copy. A test parses the whole server and fails on a variable read without
  an entry, an entry nothing reads, or one missing from `.env.example`, and
  every stated default is checked against what the code does when the
  variable is unset or blank.
- `TRUST_PROXY`, Express's `trust proxy` setting, which decides the address the
  rate limiters count: a list of subnet names (`loopback`, `linklocal`,
  `uniquelocal`), addresses and CIDRs, or `false`. Unset is the trusted-subnet
  default described under Security, and a value Express cannot parse stops the
  boot with a sentence naming the variable.
- `DB_POOL_SIZE`, the MySQL pool's connection limit. Unset keeps today's 10;
  anything but a whole number from 1 to 100 stops the boot.

### Changed

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
  purpose, set `APP_BIND` in `.env` to `0.0.0.0` or one interface's address.
  `docker-compose-prod.yml` also publishes MySQL as
  `${DB_BIND:-127.0.0.1}:3306:3306` instead of `3306:3306`: a mysql client or
  `npm run migrate` on the host still reaches it, and anything else needs
  `DB_BIND` set on purpose (the release file publishes no database port). The
  development file, `docker-compose.yaml`, does the same for its MySQL, which
  runs with a development password: the dev server, `make` and a `mysql`
  client on the same machine reach it as before, and nothing else on the
  network does. A test pins every mapping in all three files, fails on any
  default beyond loopback, and checks that `docker-compose.linux.yml`
  publishes nothing.

### Security

- **The rate limiters can no longer be walked around by sending
  `X-Forwarded-For` straight to the app port (GHSA-9fmx-frrf-xxmq).** Express's
  `trust proxy` was `1`, so every limiter keyed on the rightmost
  `X-Forwarded-For` entry of any request that carried one, and both production
  compose files published the app port on every interface, where Docker's DNAT
  rule sits in front of the host firewall. Anyone who could reach port 3000
  directly could send a new address with each request and get a fresh bucket
  every time: unlimited password and two-factor guessing past the sign-in
  limit of 20 per 15 minutes, and unlimited user search. `trust proxy` now
  defaults to `loopback, linklocal, uniquelocal`: `X-Forwarded-For` is believed
  only when the peer that connected is on loopback or a private range, and any
  other client is counted by its own address. The address recorded against
  each session came from the same header and is fixed the same way.
  `TRUST_PROXY` takes a list of addresses, subnets and those names, or
  `false`; a hop count, `true`, or a range wide enough to take in public
  addresses (wider than an IPv4 /8 or an IPv6 /16, or the IPv4-mapped
  `::ffff:0:0/96`, which is every IPv4 client) stops the boot with a sentence
  saying why, unless `TRUST_PROXY_ALLOW_HOP_COUNT=true` says you accept that
  any client able to reach the port can choose its own address. An entry not
  written in standard notation always stops it, since Express reads
  `010.0.0.0/8` as octal, public `8.0.0.0/8`. The app port is also published
  on `127.0.0.1` now (Changed, above), and the prod file's MySQL port is no
  longer published on every interface. **If you run behind a proxy,
  check two things:** that the proxy connects to the app from an address in a
  trusted range or listed in `TRUST_PROXY` (nginx or Caddy on the same host
  does, over the Docker bridge; a proxy on a public address must be listed),
  and that the proxy sets `X-Forwarded-For` itself. Otherwise every user shares
  the proxy's one bucket. "Rate limiters" in `docs/deployment.md` shows how to
  read the address the app recorded for your own sign-in.
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

### Fixed

- **A blank `SMTP_FROM` sends from the default address.** `.env.example` ships
  `SMTP_FROM=` blank, and a blank value was used as the From, so an install
  that turned email on from it sent every email with an empty From. Blank now
  behaves as unset (`Cloud Codex <noreply@cloudcitycomputing.com>`), and so do
  a blank `SMTP_PORT` (587), `DB_HOST` (`localhost`) and `DB_NAME` (`c2`), in
  the server and in `npm run migrate`.
- **A fresh install on an SELinux-enforcing host gets its schema.**
  `docker-compose-release.yml` and `docker-compose-prod.yml` mounted `init.sql`
  read-only with no SELinux relabel, so on Fedora, RHEL and their relatives the
  MySQL container could not read it, the first boot's initialisation failed,
  and MySQL came up with no tables ("Table 'c2.users' doesn't exist"). Both now
  mount it `:ro,z`, as `migrations/` already was, and a test pins a label on
  every host bind mount in the two files. An install that already hit this
  starts again from an empty data directory; see `docs/troubleshooting.md`.

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

[Unreleased]: https://github.com/Cloud-City-Computing/c2/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/Cloud-City-Computing/c2/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/Cloud-City-Computing/c2/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/Cloud-City-Computing/c2/compare/alpharelease...v0.9.0
[0.1.0-alpha]: https://github.com/Cloud-City-Computing/c2/releases/tag/alpharelease

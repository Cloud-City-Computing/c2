# Changelog

All notable changes to Cloud Codex are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions before 1.0.0 make no stability promise about the database schema.
Schema changes ship as a file in [`migrations/`](migrations/), applied with
`npm run migrate` from `cloudcodex/`, and `init.sql` runs only when MySQL
initialises an empty data directory.

## [Unreleased]

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

[Unreleased]: https://github.com/Cloud-City-Computing/c2/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/Cloud-City-Computing/c2/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/Cloud-City-Computing/c2/compare/alpharelease...v0.9.0
[0.1.0-alpha]: https://github.com/Cloud-City-Computing/c2/releases/tag/alpharelease

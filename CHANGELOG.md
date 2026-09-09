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

### Fixed

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

### Migration

[`migrations/2026-09-08-token-purpose.sql`](migrations/2026-09-08-token-purpose.sql).
**Stop every writer, apply, then start the new image**, and note there is no
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

[Unreleased]: https://github.com/Cloud-City-Computing/c2/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/Cloud-City-Computing/c2/compare/alpharelease...v0.9.0
[0.1.0-alpha]: https://github.com/Cloud-City-Computing/c2/releases/tag/alpharelease

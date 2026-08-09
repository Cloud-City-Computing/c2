# Changelog

All notable changes to Cloud Codex are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions before 1.0.0 make no stability promise about the database schema.
There is no migration runner: schema changes ship as a file in
[`migrations/`](migrations/) that you apply by hand, and `init.sql` runs only
when MySQL initialises an empty data directory.

## [Unreleased]

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
  commitment that a day-one user meets three levels: Squad, Archive, Log.
- Documentation reorganised around per-area API contracts and architecture docs.

### Fixed

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

## [0.1.0-alpha] - 2026-03-27

Initial public pre-release.

[Unreleased]: https://github.com/Cloud-City-Computing/c2/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/Cloud-City-Computing/c2/compare/alpharelease...v0.9.0
[0.1.0-alpha]: https://github.com/Cloud-City-Computing/c2/releases/tag/alpharelease

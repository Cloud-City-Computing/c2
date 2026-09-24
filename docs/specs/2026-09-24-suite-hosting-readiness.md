# Suite hosting readiness track: an instance that can be operated

Agreed 2026-09-24. Every `file:line` claim below was re-derived against `origin/main` `91493a6`.
Every PR in this track re-derives the anchors it touches at the then-current `main` before
editing.

- **Track:** Wave 6 suite, hosting readiness. Sessions W6-CDX-31 to W6-CDX-36. This document is
  the documents half of W6-CDX-30; W6-CDX-30's other half, the live-MySQL test project, is the
  shared W6-CDX-10, specified in [`2026-09-24-suite-identity.md`](2026-09-24-suite-identity.md)
  and run first.
- **Plan:** [`../plans/2026-09-24-suite-hosting-readiness.md`](../plans/2026-09-24-suite-hosting-readiness.md)
- **Requested by:** Kyle, in the 2026-09-24 decisions recorded in the Cloud Command ADR
  `wave-6-is-one-sign-in-events-and-a-shared-shell.md` (a private repository; what binds this
  spec is restated here).

## Why this spec exists

Kyle's order for the suite: **Wave 6, then a single-EC2 test deploy of Cloud Command, Cloud Codex
and Cloud City ID that Kyle performs himself, then the design-partner beta, then a containerized
service for real users.** Every Cloud Command workspace maps to exactly one Codex instance, so the
test box runs at least one Codex instance from a published image under a supervisor, behind a
TLS-terminating proxy, beside other services.

The published image cannot yet be operated safely that way. It has no stop handling, no health
endpoint, nothing enforcing the single process CLAUDE.md decision 1 depends on, a production
default that points at `localhost`, document images served to anyone with the address, and no
backup script. None of this is suite-specific: every item here also helps any self-hoster who runs
the image under Docker, which is why it lives in this repository.

## Does "one Codex instance per workspace" need Codex to know its instance id?

**No.** Cloud Command mints the instance id and keeps, per workspace, that instance's base URL,
machine credential and event-channel claim. The id reaches the outside world only inside the
receiver URL the operator configures (the events track) and the names Cloud City ID gives the
instance's registrations (the identity track). Codex never stores it, and it keeps its own integer
ids.

What the decision does require of Codex is small, and it is all in this track:

- **A written per-instance configuration contract** (W6-CDX-32): every environment variable a Codex
  instance reads, and whether each is required, degrades or defaults. Cloud Command's operator link
  tool (W6-CMD-31) prints its snippet from this list, so a variable one track adds and the snippet
  forgets is caught by a test here, not on the box.
- **Several instances on one MySQL server without seeing each other** (W6-CDX-33): one schema and
  one DML-only user per instance, proved on real MySQL.
- **A single-writer lock keyed per instance** (W6-CDX-31), so two containers pointed at one schema
  refuse rather than diverge.

## Current behaviour, the starting point

**Stop signals.** The image runs `CMD ["npm", "run", "start"]` (`cloudcodex/Dockerfile:45`), so
`npm` stands between the container's stop signal and Node. `server.js` registers no `SIGTERM` or
`SIGINT` handler (`server.js:1-150`). Collaborative state is an in-memory map per open document
(`services/collab.js:36`) saved on a 3-second debounce (`collab.js:41`, `scheduleSave` at
`:110-122`), so a stop inside that window loses the most recent edits' CRDT state.

**Health.** There is no health endpoint. `docs/deployment.md:518-527` recommends probing
`GET /api/oauth/providers`, which reads no database (`routes/oauth.js:143-151`), so it proves only
that the process listens. `GET /api/admin/status` requires a session (`routes/admin.js:160`).

**The single process is load-bearing and unenforced.** CLAUDE.md decision 1 says a second replica
would hold a second, divergent copy of every open document. Nothing stops one from starting. The
migration runner already takes a `GET_LOCK` named per database (`scripts/migrate.js:266`,
`:287-322`), which is the pattern, but only for the duration of a migration.

**Production defaults.** `APP_URL` defaults to `http://localhost:3000`
(`routes/helpers/shared.js:146`), and that default is what invitation, password-reset and
notification links carry when the variable is unset (`routes/admin.js:449`, `routes/auth.js:716`,
`services/email-templates.js:24-26`). The CORS rule reads the variable directly and simply loses
its `APP_URL` arm (`app.js:89`). `trust proxy` is hard-coded to `1` (`app.js:42`) and the pool to
10 connections (`mysql_connect.js:24`). Every compose file floats
MySQL at `mysql:8` (`docker-compose.yaml:8`, `docker-compose-prod.yml:3`,
`docker-compose-release.yml:12`).

**The admin sync promotes.** `ensureAdminUser` (`routes/admin.js:37-54`) finds any row matching
`ADMIN_USERNAME` by name or `ADMIN_EMAIL` by email, sets `is_admin`, and overwrites its password,
so an existing member whose email equals `ADMIN_EMAIL` is silently made the admin.

**Document images are public.** `/doc-images` is an `express.static` mount (`app.js:176-180`)
cached `public, immutable` for 30 days. Names are the first 16 hex characters of the image's
SHA-256 (`routes/helpers/images.js:40-43`), so the only control is that a stranger does not know
the address.

**Backups are a manual recipe.** `docs/deployment.md:140-175` documents a `mysqldump` plus a tar of
the `app_public` volume, and no script does either.

## Decisions this spec records

1. **`CMD ["node", "server.js"]`**, and a bounded 10-second graceful shutdown that flushes every
   open document's pending CRDT save before exiting.
2. **`GET /healthz` and `GET /readyz`, both information-free.** `/healthz` touches nothing;
   `/readyz` checks the database, pending migrations and the instance lock, and answers
   `{ ready, reason }` with no version, count or table name.
3. **A single-writer lock by default**: `GET_LOCK` named for the schema (a fixed prefix plus
   `DATABASE()`), held on a dedicated connection for the life of the process, and named distinctly
   from the runner's migration lock. `GET_LOCK` names are server-wide, and a schema name is unique
   per instance on a server, so instances sharing one MySQL never contend.
   `C2_INSTANCE_LOCK=0` is the named escape, for an operator who knows why.
4. **`APP_URL` is fatal when unset in production**; `TRUST_PROXY` and `DB_POOL_SIZE` become
   configuration with today's values as defaults.
5. **MySQL is pinned to an 8.4 patch release** in every compose file.
6. **The admin sync creates or syncs, and never promotes**: an existing non-admin whose email matches
   is refused loudly instead.
7. **Document images are served to their readers only**, with `DOC_IMAGES_PUBLIC=1` restoring
   today's behaviour. Avatars stay public, as a documented decision.
8. **One schema and one DML-only user per instance** is the recipe for several instances on one MySQL
   server, and it is proved, not asserted.
9. **Backup and restore are one command each**, with a drill.
10. **The test box pins a Wave 6 release** (W6-CDX-36), cut after this track and the other tracks'
    deploy-path sessions merge. It is separate from the release that carries C2-0 to C2-5, which is
    cut from the changelog this spec's PR prepares.

## Ordering constraint

```
W6-CDX-10 (live MySQL, identity plan PR 1)
     ├──► W6-CDX-31 (signals, health, lock) ──► W6-CDX-35 (backup and restore) ──┐
     ├──► W6-CDX-32 (configuration) ──► W6-CDX-33 (grants and isolation proof) ─┤
     └──► W6-CDX-34 (document images) ──────────────────────────────────────────┤
                                        the other tracks' deploy-path sessions ──┴──► W6-CDX-36 (the release)
```

---

## W6-CDX-31. A container that stops cleanly and says when it is ready

### In scope

- `Dockerfile:45` becomes `CMD ["node", "server.js"]`, keeping `NODE_ENV=production` from the
  image's `ENV`.
- A `SIGTERM`/`SIGINT` handler, bounded at 10 seconds: stop accepting connections; `/readyz`
  answers 503; write `ydoc_state` for every collab entry with a pending save; close both WebSocket
  servers with code 1001; `pool.end()`; exit 0, or non-zero on timeout. It is built as an exported
  `shutdown(deps)` so it can be tested with fake timers.
- `GET /healthz` and `GET /readyz` as Decision 2; a Dockerfile `HEALTHCHECK`; `stop_grace_period:
  20s` in the prod and release compose files.
- The single-writer lock as Decision 3; its error message names the holder's connection and the
  escape.
- `docs/deployment.md`'s health checks section rewritten; the request-lifecycle and
  build-test-and-ops maps.

### Done means

- `/healthz` issues zero queries. `/readyz` answers 503 with a reason when a migration is pending.
  Neither body contains a version or a table name.
- `shutdown(deps)` under fake timers flushes every dirty entry, stays within its bound, and carries
  on past one flush that throws.
- On live MySQL: a second process on the same schema exits non-zero and names the holder; after a
  `kill -9` of the first, a third boots; a `SIGTERM` in the middle of an edit, then a restart,
  preserves the last edit in `ydoc_state`.
- The built image reports healthy within 30 seconds and stops within the grace period.

### Explicitly deferred

A client flush handshake before shutdown, and closing the `html_content` divergence after a
restart: a document edited only over the socket still reads stale to non-editors until an explicit
save, as documented in `docs/maps/documents-and-collab.md`.

---

## W6-CDX-32. Production configuration that cannot silently point at localhost

### In scope

- `APP_URL` unset with `NODE_ENV=production` exits at boot, naming the variable; development keeps
  the `shared.js:146` default.
- `TRUST_PROXY` (default `1`) and `DB_POOL_SIZE` (default `10`).
- `mysql:8.4.x` pinned in `docker-compose.yaml`, `docker-compose-prod.yml` and
  `docker-compose-release.yml`, with the exact patch recorded in the PR.
- `ensureAdminUser` as Decision 6.
- **The configuration contract**: a test that enumerates every `process.env` read under
  `cloudcodex/` (outside `tests/`) and pins, per variable, whether it is required, degrades or
  defaults, and whether it is per-instance. `.env.example` documents each one. A variable a later
  PR reads without adding it to the contract fails this test.

### Done means

Tests for the `APP_URL` exit and the development default; `TRUST_PROXY` and `DB_POOL_SIZE` reaching
Express and the pool; the admin sync creating, syncing and refusing (refusal is the new behaviour);
the contract pinning every default; and no compose file using a floating `mysql:8`.

### Explicitly deferred

A separate `TOKEN_ENCRYPTION_KEY` for GitHub tokens (today derived from `GITHUB_CLIENT_SECRET`, see
`docs/maps/open-questions.md` C3), and structured logging, which CLAUDE.md rules out.

---

## W6-CDX-33. Many instances, one MySQL server: the grant recipe and the isolation proof

### In scope

- The recipe in `docs/deployment.md`: one schema per instance, a DML-only `c2_app` user, a
  `c2_mig` user for the runner, and no `PROCESS`, `FILE`, `SUPER` or global grant.
- `tests/integration/tenancy.test.js` runs the 2026-08-24 proof's cross-schema shapes against two
  schemas and two users: every cross-schema statement fails with error 1142 or 1044, `SHOW
  DATABASES` and `information_schema` show only the caller's schema, `LOAD_FILE` is blocked, and
  DDL is denied to the app user.
- `tests/integration/grants-sufficient.test.js` boots the app as the DML-only user and runs a smoke
  path (login, then workspace, squad, archive and document, a collab edit and a comment) with zero
  `ER_TABLEACCESS_DENIED_ERROR`.
- The runner runs as the migration user; a test proves two instances' single-writer locks (one
  per schema) are held at once on one server; the maps gain a tenancy section saying what the
  boundary is and what it is not.

### Done means

Both suites are green in the integration step. A deliberately widened grant (`GRANT SELECT ON *.*`)
turns `tenancy.test.js` red, confirmed to have landed. The result is recorded as the evidence for
"one container and one schema per customer".

**Required before a second Codex instance shares the test box's MySQL server.** Whether it blocks
the beta depends on open question 2.

---

## W6-CDX-34. Document images only for people who can read the document

### In scope

- The `/doc-images` static mount (`app.js:176-180`) becomes an authorized handler. A
  `doc_images (hash, log_id, uploaded_by)` table is written at upload time (the upload route gains
  a `logId` and requires write access to it) and at extraction time (`routes/helpers/images.js`).
- The handler serves the bytes when the requester uploaded the image, or when `checkLogReadAccess`
  passes for any document that holds it, so live collaborators see an image before an explicit
  save. Responses are cached privately.
- `DOC_IMAGES_PUBLIC=1` restores today's behaviour, and is documented.
- A backfill scans `html_content` for `/doc-images/` references.

### Done means

An unauthenticated request and an authenticated non-reader get the same 404; a reader and the
uploader get the bytes with the right content type and private caching; the opt-out reproduces
today; after the backfill every existing image is reachable by its readers (a live-MySQL test on a
seeded schema); export still inlines images.

### Explicitly deferred

Avatars (public by decision), and deleting an image when its last document stops using it.

---

## W6-CDX-35. Backup and restore as one command, with a drill

### In scope

`scripts/backup.sh` and `scripts/restore.sh`: `mysqldump --single-transaction --routines
--triggers`, the `schema_migrations` ledger, and a tar of `app_public`, in one archive with a
manifest; `make backup` and `make restore`; honest notes (consistency holds for InnoDB only, and
the in-memory CRDT window is lost unless the backup follows a graceful stop); and the backups
section of `docs/deployment.md` pointing at them. Cloud Command's box script calls these rather
than duplicating them.

### Done means

A drill on live MySQL: seed a document with a pasted image and a comment; back up; drop the schema
and wipe the upload directory; restore into a scratch schema and boot; `/readyz` answers 200, the
document's HTML is intact, and its image is served to its reader.

---

## W6-CDX-36. The Wave 6 Codex release the test box pins

### In scope

- Precondition: this track has merged, and so have the other tracks' deploy-path sessions (the
  identity relying party, the events emitter and worker, and the UI track through W6-CDX-27).
- Retire this spec and its plan; update the roadmap.
- Move the changelog's `[Unreleased]` into a version, bump `cloudcodex/package.json`, and move the
  default in `docker-compose-release.yml`, which `release.yml`'s guard checks.
- Tag through `release.yml`. **Kyle authorizes the tag**, because the release is public.
- Verify that the pulled GHCR image boots with the box's environment and reports healthy, and hand
  its digest and an idle-memory reading to Cloud Command's W6-CMD-38.

### Done means

The release workflow is green and the GHCR digest is recorded; `docker compose -f
docker-compose-release.yml up` from a clean clone reaches `/readyz` 200; the spec and plan are
deleted and the maps are current.

---

## Cross-repo dependencies

| This session | Is needed by (Cloud Command) |
|---|---|
| W6-CDX-31, W6-CDX-32 | W6-CMD-36 (the box's compose file, health checks and smoke test) |
| W6-CDX-32 (the configuration contract) | W6-CMD-31 (the operator link tool's printed snippet) |
| W6-CDX-33 | the runbook appendix that adds a second instance by hand |
| W6-CDX-35 | W6-CMD-37 (the whole-box backup) |
| W6-CDX-36 | W6-CMD-38 (the full-box rehearsal and v1.0.0) |

Cloud Command's W6-CMD-30 measures idle and warm memory against the release that carries C2-0 to
C2-5, before this track starts, and re-measures on the W6-CDX-36 image.

## Explicitly deferred, track level

- **Structured logging.** CLAUDE.md rules out a logging library, and nothing here needs one.
- **Tenant export and erasure**, **a scoped operator role**, and **provisioning automation**: the
  later containerized-service era, with billing, entitlements and the seat taxonomy.
- **UUIDs.** Per-instance integers stay, by decision.

## Open questions for Kyle

1. **Host names.** Which registrable domain and host names do the three services use on the test
   box? The choice fixes certificates, OIDC redirect URIs and the issuer URL, and the issuer is half
   of every user's identity key.
2. **Beta scale.** How many design-partner workspaces, and so Codex instances, must the single box
   carry at once? That sizes the machine and decides whether W6-CDX-33 blocks the beta or can wait.
3. **Who links an instance.** Is linking a Codex instance to a workspace always Cloud City's
   operator act (assumed here), or may a workspace admin connect a Codex they run themselves?

## Retirement

W6-CDX-36 deletes this spec and its plan and marks the hosting row in [`roadmap.md`](roadmap.md)
shipped; the maps updated by each session are the record.

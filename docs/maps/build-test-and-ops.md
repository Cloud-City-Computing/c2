# Build, Test & Ops Map

How the repo is laid out, how it runs locally and in production, and exactly
what CI enforces.

---

## 1. The dual-root quirk

The repo root holds Docker, docs, SQL and Make. The Node application lives one
level down in `cloudcodex/`.

```
c2/                          <- git root; docker, docs, SQL, Makefile, start.sh
└── cloudcodex/              <- the npm package; package.json lives HERE
```

**Every `npm` command runs from `cloudcodex/`.** Every `make` target and
`docker compose` command runs from the root. This catches out both humans and
agents; a `npm test` at the root fails with a missing package.json.

The `.env` file lives at the **root**, and `mysql_connect.js:16` reaches up for
it with `path.resolve(dirname, '..', '.env')`. Importing `mysql_connect.js` is
what loads env for the whole process, so any module that needs env must import
it (directly or transitively) before reading `process.env`.

## 2. npm scripts (`package.json:6-19`)

| Script | Command | Notes |
|---|---|---|
| `dev` | `node server.js` | **not** `vite dev`. `vite-express` runs Vite in middleware mode inside the same process. |
| `start` | `NODE_ENV=production node server.js` | serves the prebuilt `dist/` |
| `build` | `vite build` | frontend only; the backend is not bundled |
| `preview` | `vite preview` | |
| `lint` | `eslint .` | flat config, whole package |
| `test` | `vitest run --project backend --project frontend` | the two default projects; never `integration` |
| `test:watch` | `vitest --project backend --project frontend` | |
| `test:coverage` | `vitest run --coverage --project backend --project frontend` | v8 provider, enforces thresholds |
| `test:integration` | `vitest run --project integration` | opt-in, needs a live MySQL; see section 5 |
| `test:backend` / `test:frontend` | `vitest run --project <name>` | one project at a time |
| `migrate` | `node scripts/migrate.js` | applies pending `migrations/*.sql`, records them in `schema_migrations`. One-time adoption first: `-- --adopt-fresh-install` on a database `init.sql` just built, `-- --baseline` on an install that predates the runner. Run it inside the app container on the release compose file (3306 is not published there). See [data-model.md](data-model.md) and `docs/deployment.md`. |

`NODE_ENV` matters in three places: CORS localhost allowance
(`app.js:101`), rate-limiter `skip` when `'test'` (`app.js:133`,
`app.js:155`), and Vite's dev-vs-prod mode. It is **not** in `.env.example`.

## 3. Local development

`./start.sh` from the root is the one-shot bootstrap: it checks Docker, Docker
Compose, Node and npm, brings up MySQL, installs dependencies, and starts the
dev server. On Linux it merges `docker-compose.linux.yml`, which re-declares the
bind mounts with the `:Z` SELinux label (`docker-compose.linux.yml:6-8`).

Manual equivalent:

```
docker compose up -d          # from the root: MySQL only
cd cloudcodex && npm install && npm run dev
```

Make targets (`Makefile`) all shell into the running container:

| Target | Effect |
|---|---|
| `make seed` | pipes `seed.sql` in |
| `make reset-db` | pipes `init.sql` then `seed.sql` in |
| `make db-shell` | interactive `mysql` CLI |

The Makefile does `include .env` / `export` at the top, so it needs a populated
root `.env`, and it resolves the container via
`docker compose ps -q database`.

`init.sql`'s `DROP TABLE IF EXISTS` block now covers all 25 tables, including
`github_links`, `activity_log`, `watches` and `notifications`, which used to be
missing and made `make reset-db` fail partway on a database that already had
them. See [data-model.md](data-model.md).

## 4. Docker topologies

**Dev** (`docker-compose.yaml`): MySQL 8 only, port 3306 published, data in a
bind mount `./db-data/`, `init.sql` mounted into
`/docker-entrypoint-initdb.d/`. The app runs on the host.

**Prod** (`docker-compose-prod.yml`): MySQL 8 plus the app.

- MySQL uses a **named volume** `db_data`, not the bind mount, and gets a
  `mysqladmin ping` healthcheck (`docker-compose-prod.yml:22-27`).
- The app builds from `cloudcodex/Dockerfile`, waits on
  `condition: service_healthy`, publishes 3000, and takes `env_file: .env`.
- `cloudcodex/Dockerfile` is a **two-stage** build on `node:20-slim`: the build
  stage runs `npm ci` and `npm run build`, and the runtime stage runs
  `npm ci --omit=dev`, copies the source, then copies `dist/` across from the
  build stage. `CMD npm run start`.
- The runtime stage sets `ENV NODE_ENV=production` rather than relying on the
  `npm run start` script, because `vite-express` reads it when `server.js` is
  imported to decide between serving `dist/` and booting a Vite dev server.
- `src/` is copied whole rather than dropped in favour of `dist/`: the server
  imports `src/lib/githubDiff.js` directly.
- `cloudcodex/.dockerignore` excludes `node_modules`, `dist`, `tests`,
  `coverage` and `.env*`. Without it, `COPY . .` shipped the host's 405 MB
  `node_modules` on top of the tree `npm ci` had just installed, so every
  dependency was in the image twice. Single-stage with no ignore file produced
  a **2.86 GB** image; the current one is **679 MB**.
- `docker-compose-prod.yml` sets `DB_HOST: database` under the app service's
  `environment`, overriding `.env`'s `DB_HOST=localhost` (correct for dev,
  where the app runs on the host, and wrong inside the prod container).
  `environment` takes precedence over `env_file`.

One thing to get right when deploying: **`init.sql` only executes on a fresh
volume.** The MySQL entrypoint skips `/docker-entrypoint-initdb.d/` when the
data directory is already initialised. Editing `init.sql` and restarting
changes nothing; existing databases need the matching file from `migrations/`,
applied with `npm run migrate` (one-time adoption first, see
`docs/deployment.md`). No compose file mounts `migrations/` into the **MySQL**
container, so it is never applied from inside `make db-shell`; the release and
prod compose files mount it into the **app** container (`:ro,z`, because an
unlabelled bind mount is unreadable on an SELinux host), which is where the
runner runs. Run it with `docker compose ... run --rm app npm run migrate`, not
`exec`: on the upgrade that first ships the runner, the already-running
container is the old image, with neither the script nor the mount.

## 5. Testing

**Vitest 4, three projects** in one config (`vitest.config.js:24-70`). A single
`npm test` runs the two default ones, `backend` and `frontend`; the third,
`integration`, is opt-in because it needs a MySQL server:

| Project | Environment | Setup file | Includes |
|---|---|---|---|
| `backend` | node | `tests/setup.js` | `tests/routes/`, `tests/middleware/`, `tests/services/`, `tests/helpers/`, `tests/extensions/`, `tests/scripts/`, `tests/*.test.js` |
| `frontend` | jsdom + `@vitejs/plugin-react` | `tests/setup.frontend.js` | `tests/src/**` |
| `integration` | node | `tests/setup.integration.js`, plus `globalSetup` `tests/integration/global-setup.js` | `tests/integration/**/*.test.js` |

Current state: the default run is **76 files, 1545 tests, all passing**; the
integration project is **2 files, 6 tests**.

**The default run is pinned by name, not by omission.** `test`,
`test:watch` and `test:coverage` name `--project backend --project frontend`,
because a bare `vitest run` runs every declared project, integration included.
`tests/test-projects.test.js` (a backend test) fails if a declared project other
than `integration` is missing from `test`, `test:watch` or `test:coverage`, or if
`test:integration` runs anything but `integration`. A fourth project added to
`vitest.config.js` without joining those scripts turns it red instead of
silently never running.

### The live-MySQL project (`tests/setup.integration.js`)

The only tests in the repo that touch a real database. The per-file setup runs
before each test file is imported and **does not** mock `mysql_connect.js`:

1. Opens an admin connection from `IT_DB_HOST` (default `127.0.0.1`),
   `IT_DB_ROOT_USER` (default `root`) and `IT_DB_ROOT_PASSWORD` (required; the
   setup throws without it). The server must answer on **3306**, because
   `mysql_connect.js` reads no `DB_PORT`.
2. Creates a throwaway schema `c2_it_<12 hex>`, builds `init.sql` into it over a
   `multipleStatements` connection (`init.sql` has no `USE`, so it builds into
   the current schema), and adopts it with the runner's exported
   `runMigrations({ adoptFreshInstall: true })`. If either step throws, it drops
   the schema before rethrowing.
3. Sets `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` to that server and schema,
   **before** the test file imports any app module, which is what makes the
   pool in `mysql_connect.js` bind to it. `dotenv` never overrides a variable
   already set, so a developer's `.env` cannot redirect it.
4. Drops the schema in `afterAll`.

The admin helpers (`adminConfig`, `buildSchemaFromInitSql`, `queryVia`,
`dropSchema`, `throwawaySchemaName`) live in `tests/integration/mysql-admin.js`;
a test that needs a second schema (as the adoption-refusal test does) builds it
with them and drops it in its own `finally`. `queryVia` wraps **one**
connection, never a pool, because the runner's advisory lock is per connection.

The global teardown drops every `c2_it_` schema still on the server and fails
the run naming them. **Trap: Vitest 4 only logs an error thrown from a
globalSetup teardown ("error during close") and exits 0**, so the teardown sets
`process.exitCode = 1` before it throws; the throw alone would leave a leak
green (found by mutation, 2026-09-25). Because it counts every `c2_it_` schema,
two integration runs sharing one server at once would report each other's; give
each concurrent run its own server.

`tests/integration/migrate.test.js` holds four tests: a canary that
fails if `c2_query` is a mock, adoption recorded every migration file, a second
run is a no-op, and adoption refuses a schema missing a post-baseline column
(`password_reset_tokens.purpose`). Each was mutation-checked on 2026-09-25:
reintroducing the mock fails the canary, skipping the `afterAll` drop fails the
teardown, a migration that `ALTER`s a missing table fails the setup, and
dropping `--project frontend` from `test` fails the guard.

**Trap: the setup never executes a migration file.** `adoptFreshInstall`
records every file and applies none (`scripts/migrate.js` `runUnderLock`); its
only check on a post-baseline file is `schemaClaims`, which asks whether the
table or column the file adds already exists. A file with broken SQL whose
objects `init.sql` already has adopts cleanly (reproduced in review,
2026-09-25). `tests/integration/upgrade-path.test.js` is what runs migration
SQL: it builds `init.sql` into a second schema, applies the undo statements in
`tests/integration/pre-runner-state.js` newest first, records the baseline with
`runMigrations({ baseline: true })`, applies every post-baseline file with a
plain `runMigrations`, and requires an information_schema fingerprint
(columns, indexes, table constraints, checks, foreign keys) equal to the
per-file schema's. A second test fails when a post-baseline file has no undo
entry or an entry names a file that is gone. Mutation-checked on 2026-09-25:
invalid SQL in `2026-09-08-token-purpose.sql` (a parse error), `VARCHAR(64)`
for `VARCHAR(32)` and the `CHECK` dropped (fingerprint mismatch), and the undo
entry removed (both tests) each turn it red. Its limits: the upgrade runs on
empty tables, so a migration's handling of existing rows is not exercised, and
the `LEGACY_BASELINE` files are never run.

Tests mirror the source tree:

```
routes/foo.js            -> tests/routes/foo.test.js
routes/helpers/foo.js    -> tests/helpers/foo.test.js
services/foo.js          -> tests/services/foo.test.js
middleware/foo.js        -> tests/middleware/foo.test.js
src/**                   -> tests/src/**
```

### The backend mock surface (`tests/setup.js`)

Four global `vi.mock` calls apply to **every** backend test:

- `../mysql_connect.js`: `c2_query` returns `[]`, `generateSessionToken`
  returns `'mock-session-token'`, `validateAndAutoLogin` returns `null`,
  `touchSession` no-ops.
- `../services/email.js`: `sendEmail` and `verifyEmailConnection` stubbed.
- `sharp`: a chainable stub with `resize`/`webp`/`toFile`.
- `fs/promises`: **only `mkdir` and `unlink`.**

That last one is a sharp edge. `routes/helpers/images.js` also calls `fs.stat`,
`fs.writeFile` and `fs.readFile`, which the global mock does not provide, so a
test touching those paths must supply its own mock. `tests/helpers/images.test.js`
does.

Because `c2_query` is a mock returning `[]` by default, **most backend tests
assert against a queue of `mockResolvedValueOnce` calls in the exact order the
handler issues queries.** Adding a query to a handler, even a harmless one,
shifts that queue and breaks tests that were passing for the right reason. When
a test breaks after a route change, check the mock ordering before assuming the
change is wrong.

Helpers in `tests/helpers.js`: `TEST_USER`, `TEST_USER_2`,
`mockAuthenticated(user)`, `mockUnauthenticated()`, `resetMocks()`. Note there
is **no `ADMIN_USER`** despite the root `CLAUDE.md` listing one; admin tests
pass `mockAuthenticated({ ...TEST_USER, is_admin: true })` explicitly.

`tests/setup.frontend.js` adds jest-dom matchers and, after each test, runs
Testing Library `cleanup()`, clears `localStorage` and `sessionStorage`, and
empties `document.body`.

### Coverage thresholds

`vitest.config.js:99-164`. The global floor is deliberately low because
`src/pages/` and `src/extensions/` are untested by policy:

```
lines 43   statements 40   branches 33   functions 26
```

Above that sit **30 per-glob thresholds** (this map and the root `CLAUDE.md`
both used to say 26, which was a miscount). The 30th, `services/identity.js`,
arrived with the identity seam. The security-critical and
well-covered modules are ratcheted high:

| Glob | lines |
|---|---|
| `routes/documents.js` | 95 |
| `routes/notifications.js` | 95 |
| `routes/comments.js` | 92 |
| `routes/admin.js`, `routes/archives.js` | 90 |
| `services/notifications.js` | 90 |
| `services/identity.js` | 95 |
| `routes/helpers/**` | 88 |
| `routes/auth.js`, `routes/squads.js`, `routes/watches.js`, `mysql_connect.js` | 85 |
| `middleware/**` | 80 |
| `services/collab.js` | 65 (raised from 25 in the gap-fix pass) |
| `src/util.jsx` | 65 |

Plus `services/email.js` and `email-templates.js` at 95, `app.js` at 75 lines
but only 5 branches, `src/editorUtils.js` and `src/userPrefs.js` at 95,
`scripts/**` at 82, and five per-hook thresholds.

`coverage.include` is an allowlist, so a directory absent from it is **invisible
to coverage rather than under-covered**. `scripts/**/*.js` was added to it when
the migration runner landed; anything new outside `routes/`, `middleware/`,
`services/`, `scripts/`, `src/` and the three named root files needs the same
treatment or it silently counts for nothing.

**The practical consequence:** adding an uncovered branch to a high-threshold
file fails CI even though every test passes. Write the test with the code. When
you raise real coverage, ratchet the threshold up in the same PR; the comment at
`vitest.config.js:93-98` explains the "achieved minus a small buffer" policy.

## 6. CI

`.github/workflows/ci.yml`, on push to `main` and on every pull request. Ubuntu, Node 20, npm
cache keyed on `cloudcodex/package-lock.json`, working directory `cloudcodex`:

```
npm ci -> npm run lint -> npm test -> npm run test:integration -> npm run test:coverage -> npm run build
```

The job carries a `mysql:8.4` **service container** (root password
`ci-root-password`, published on 3306, health-checked with `mysqladmin ping`),
and the `Integration tests (live MySQL)` step runs `npm run test:integration`
against it with `IT_DB_HOST=127.0.0.1`. The password is not a secret: it guards
an ephemeral container that lives only as long as the job. Both sit **inside**
the existing job, so the check `main` already requires covers the live-MySQL
project with no branch-protection change.

The job is named `Lint, test and build`, and that name (not the job id `test`)
is the check run context. Renaming the job renames the check, and would break
the gate until branch protection is updated to match.

**Whether that check is actually required on `main` is repository configuration,
not repository content, and it is applied by hand.** Until someone runs the
`PUT` on `/branches/main/protection`, `main` has no `required_status_checks` key
at all and a red run is mergeable on one approval. Verify rather than assume:

```
gh api repos/Cloud-City-Computing/c2/branches/main/protection/required_status_checks
```

A 404 means no status check is required yet.

`npm run build` is the newest step and the reason for the job's name: lint and
the suite never exercise the production Vite build, so a bad import or a
dependency missing from `vite.config.js`'s `manualChunks` used to pass CI and
reach `main`. The build emits a "Circular chunk" warning about the vendor chunks
and still exits 0, so that warning is not a gate failure.

Coverage is uploaded as an artifact with 14-day retention,
`if: always()`. That `if` makes the upload run even when an earlier step failed;
it does not affect the job's own pass or fail conclusion.

**There are no pre-commit hooks.** Running lint and tests locally is on you.
`npm ci` means the lockfile must be committed and current.

On **push** the filter is still `main` only, so work on a side branch does not
burn CI until it becomes a pull request. On **pull_request** there is no branch
filter: every PR runs, whatever its base. That matters for stacked PRs, whose
base is another feature branch. Under the old `pull_request: branches: [main]`
filter they reported no checks at all, and a required status check that never
reports blocks a merge permanently rather than failing it.

## 6b. Releases

`.github/workflows/release.yml`, triggered by pushing a `v*` tag. Two jobs:

1. **verify** re-runs `npm ci`, `npm run lint`, `npm test`,
   `npm run test:integration` (against the same `mysql:8.4` service CI uses)
   **and `npm run test:coverage`**. The integration step means a tag cannot
   publish an image whose `init.sql` does not build on MySQL 8.4, or whose
   post-baseline migrations do not upgrade a pre-runner schema to exactly what
   `init.sql` builds (section 5). A tag is not evidence the commit is green, because
   tags can point at any commit and `ci.yml` only runs on `main`. The coverage
   run is not optional padding: the 30 per-glob thresholds are CI's real gate,
   so omitting it would make the release path weaker than the thing it claims
   to be re-proving.
2. **publish** needs `verify`, then builds `./cloudcodex` with buildx and
   pushes `ghcr.io/cloud-city-computing/cloud-codex` at both the bare version
   and `:latest`, with `packages: write` and the GITHUB_TOKEN.

Deliberate details, each of which is load-bearing:

- The image is named for the **product**, not the repository. `c2` is a legacy
  codename and a string people type into `docker pull` is user-facing. The
  owner is spelled out in lowercase because ghcr.io rejects the mixed-case
  `Cloud-City-Computing` that `github.repository_owner` would give.
- A guard step fails the build when the tag does not match
  `cloudcodex/package.json`'s version **or** the default pinned in
  `docker-compose-release.yml`. A published image that misreports its own
  version is worse than no image, and a stale compose default means the
  documented `docker compose up` silently runs an older release than the
  README describes.
- **The tag name reaches that guard through `env:`, never through a `${{ }}`
  expansion inside `run:`.** A tag is attacker-choosable and `v1.0.0$(id)` is a
  valid, pushable ref, so interpolating it into the script body would be
  command execution in a job holding `packages: write` and a ghcr.io login.
- The trigger is `v[0-9]+.[0-9]+.[0-9]+`, not `v*`, so a prerelease tag cannot
  start a publish.
- **`:latest` is only moved when the tag is the highest version tag in the
  repo.** A hotfix on an older line (`v0.9.1` cut after `v1.0.0` shipped) is
  normal, and republishing `:latest` from it would downgrade everyone tracking
  that tag onto a database a newer release has already migrated. The job checks
  `git tag --sort=-v:refname` and, when it is not the newest, publishes the
  version tag alone and says so with a `::notice::`.

**Known gap: `linux/amd64` only.** arm64 would mean cross-building `sharp` and
`bcrypt` under QEMU, which is slow and fails in ways that only appear at
runtime. Apple Silicon runs the amd64 image under Docker Desktop's emulation.

**One-time setup the workflow cannot do for you: make the package public.**
A container package first created by Actions is **private**, whatever the
repository's visibility, and nothing in `release.yml` can change that. The
publish job goes green and an anonymous `docker pull` still answers
`unauthorized`, which is the worst possible failure here because the whole point
of the image is that a stranger can run it. Confirmed after the 0.9.0 publish.

Fix it once, in the web UI. Straight to the page:

https://github.com/orgs/Cloud-City-Computing/packages/container/cloud-codex/settings

**Danger Zone → Change visibility → Public.** While you are there, "Manage
Actions access" → add the `c2` repository with Write, so future publishes keep
working if the default token scope tightens.

**This cannot be scripted.** There is no REST endpoint: `GET` on the package
answers 403 asking for `read:packages`, while `PATCH .../packages/container/
cloud-codex -f visibility=public` answers **404**, because the route does not
exist. No token scope changes that. It is a click, once per package, forever.

Verify from a logged-out client rather than trusting the workflow:

```
docker logout ghcr.io
docker pull ghcr.io/cloud-city-computing/cloud-codex:0.10.0
```

`docker-compose-release.yml` consumes the published image instead of building,
pinned to `${CLOUDCODEX_VERSION:-0.10.0}` so an evaluator's install does not
move under them on the next publish. It also differs from
`docker-compose-prod.yml` in not publishing 3306: the app reaches MySQL over the
compose network, and Docker's published ports are a DNAT rule that sits in front
of the host firewall, so publishing it on a VPS exposes the database to the
internet past a `ufw deny`.

**Both** compose files mount a named volume `app_public` at `/app/public`.
Uploaded avatars and extracted document images live only there:
`routes/helpers/images.js` writes the file and then replaces the base64 data URI
in `html_content` with a `/doc-images/` URL, so after extraction the file on
disk is the sole copy. Without the volume, `docker compose pull && up -d`
recreates the container and destroys every one of them while the database keeps
pointing at them.

## 7. Shippability checklist

Before calling a change done:

1. `npm run lint` clean, no new warnings.
2. `npm test` green. A schema or migration change also needs
   `npm run test:integration` green against a live MySQL, and a new migration
   file needs its undo in `tests/integration/pre-runner-state.js`, or the
   upgrade-path test is red. That test runs on empty tables: a migration that
   rewrites existing rows needs its own seeded test.
3. New env vars in `.env.example` with a comment.
4. New heavy frontend deps added to `manualChunks` in `vite.config.js`.
5. New SQL in **both** `migrations/` and `init.sql`. Never add the new file to
   `LEGACY_BASELINE` in `scripts/migrate.js`; that list is closed.
6. New admin-visible behaviour documented in the relevant `docs/*.md`, and any
   architectural change reflected in the matching `docs/maps/` file.
7. UI changes verified in a browser at desktop and mobile widths.
8. No `console.log`, no commented-out code, no `.only`/`.skip` in tests, no
   unlinked `TODO`/`FIXME`.

---

## Related

- [data-model.md](data-model.md) for the `init.sql` and migration contract.
- [request-lifecycle.md](request-lifecycle.md) for what `app.js` exposes to
  Supertest.
- [open-questions.md](open-questions.md) for the ops issues above that read as
  defects.

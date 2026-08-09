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

## 2. npm scripts (`package.json:6-16`)

| Script | Command | Notes |
|---|---|---|
| `dev` | `node server.js` | **not** `vite dev`. `vite-express` runs Vite in middleware mode inside the same process. |
| `start` | `NODE_ENV=production node server.js` | serves the prebuilt `dist/` |
| `build` | `vite build` | frontend only; the backend is not bundled |
| `preview` | `vite preview` | |
| `lint` | `eslint .` | flat config, whole package |
| `test` | `vitest run` | both projects |
| `test:watch` | `vitest` | |
| `test:coverage` | `vitest run --coverage` | v8 provider, enforces thresholds |
| `test:backend` / `test:frontend` | `vitest run --project <name>` | one project at a time |

`NODE_ENV` matters in three places: CORS localhost allowance
(`app.js:52`), rate-limiter `skip` when `'test'` (`app.js:87`,
`app.js:109`), and Vite's dev-vs-prod mode. It is **not** in `.env.example`.

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
changes nothing; existing databases need the matching file from `migrations/`
applied by hand.

## 5. Testing

**Vitest 4, two projects** in one config (`vitest.config.js:18-50`), so a single
`npm test` runs both:

| Project | Environment | Setup file | Includes |
|---|---|---|---|
| `backend` | node | `tests/setup.js` | `tests/routes/`, `tests/middleware/`, `tests/services/`, `tests/helpers/`, `tests/extensions/`, `tests/*.test.js` |
| `frontend` | jsdom + `@vitejs/plugin-react` | `tests/setup.frontend.js` | `tests/src/**` |

Current state: **58 files, 1154 tests, all passing.**

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

`vitest.config.js:78-124`. The global floor is deliberately low because
`src/pages/` and `src/extensions/` are untested by policy:

```
lines 43   statements 40   branches 33   functions 26
```

Above that sit **26 per-glob thresholds**. The security-critical and
well-covered modules are ratcheted high:

| Glob | lines |
|---|---|
| `routes/documents.js` | 95 |
| `routes/notifications.js` | 95 |
| `routes/comments.js` | 92 |
| `routes/admin.js`, `routes/archives.js` | 90 |
| `services/notifications.js` | 90 |
| `routes/helpers/**` | 88 |
| `routes/auth.js`, `routes/squads.js`, `routes/watches.js`, `mysql_connect.js` | 85 |
| `middleware/**` | 80 |
| `services/collab.js` | 65 (raised from 25 in the gap-fix pass) |
| `src/util.jsx` | 65 |

Plus `services/email.js` and `email-templates.js` at 95, `app.js` at 75 lines
but only 5 branches, `src/editorUtils.js` and `src/userPrefs.js` at 95, and five
per-hook thresholds.

**The practical consequence:** adding an uncovered branch to a high-threshold
file fails CI even though every test passes. Write the test with the code. When
you raise real coverage, ratchet the threshold up in the same PR; the comment at
`vitest.config.js:72-77` explains the "achieved minus a small buffer" policy.

## 6. CI

`.github/workflows/ci.yml`, on push and PR to `main` only. Ubuntu, Node 20, npm
cache keyed on `cloudcodex/package-lock.json`, working directory `cloudcodex`:

```
npm ci  ->  npm run lint  ->  npm test  ->  npm run test:coverage
```

Coverage is uploaded as an artifact with 14-day retention,
`if: always()`.

**There are no pre-commit hooks.** Running lint and tests locally is on you.
`npm ci` means the lockfile must be committed and current.

Note the branch filter: work on `dev` does not trigger CI until it targets
`main`.

## 6b. Releases

`.github/workflows/release.yml`, triggered by pushing a `v*` tag. Two jobs:

1. **verify** re-runs `npm ci`, `npm run lint` and `npm test`. A tag is not
   evidence the commit is green, because tags can point at any commit and
   `ci.yml` only runs on `main`.
2. **publish** needs `verify`, then builds `./cloudcodex` with buildx and
   pushes `ghcr.io/cloud-city-computing/cloud-codex` at both the bare version
   and `:latest`, with `packages: write` and the GITHUB_TOKEN.

Two deliberate details:

- The image is named for the **product**, not the repository. `c2` is a legacy
  codename and a string people type into `docker pull` is user-facing. The
  owner is spelled out in lowercase because ghcr.io rejects the mixed-case
  `Cloud-City-Computing` that `github.repository_owner` would give.
- A guard step fails the build when the tag does not match
  `cloudcodex/package.json`'s version. A published image that misreports its
  own version is worse than no image.

**Known gap: `linux/amd64` only.** arm64 would mean cross-building `sharp` and
`bcrypt` under QEMU, which is slow and fails in ways that only appear at
runtime. Apple Silicon runs the amd64 image under Docker Desktop's emulation.

`docker-compose-release.yml` consumes the published image instead of building,
pinned to `${CLOUDCODEX_VERSION:-0.9.0}` so an evaluator's install does not
move under them on the next publish.

## 7. Shippability checklist

Before calling a change done:

1. `npm run lint` clean, no new warnings.
2. `npm test` green.
3. New env vars in `.env.example` with a comment.
4. New heavy frontend deps added to `manualChunks` in `vite.config.js`.
5. New SQL in **both** `migrations/` and `init.sql`.
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

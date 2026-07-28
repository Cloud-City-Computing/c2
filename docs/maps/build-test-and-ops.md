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

**`make reset-db` is not a clean reset.** `init.sql`'s `DROP TABLE IF EXISTS`
block omits `github_links`, `activity_log`, `watches` and `notifications`, and
none of their `CREATE TABLE` statements use `IF NOT EXISTS`, so it fails partway
on a database that already has them. See [data-model.md](data-model.md).

## 4. Docker topologies

**Dev** (`docker-compose.yaml`): MySQL 8 only, port 3306 published, data in a
bind mount `./db-data/`, `init.sql` mounted into
`/docker-entrypoint-initdb.d/`. The app runs on the host.

**Prod** (`docker-compose-prod.yml`): MySQL 8 plus the app.

- MySQL uses a **named volume** `db_data`, not the bind mount, and gets a
  `mysqladmin ping` healthcheck (`docker-compose-prod.yml:22-27`).
- The app builds from `cloudcodex/Dockerfile`, waits on
  `condition: service_healthy`, publishes 3000, and takes `env_file: .env`.
- `cloudcodex/Dockerfile` is `node:20`, `npm install` (not `npm ci`), `COPY . .`,
  `npm run build`, then `CMD npm run start`.

Two things to get right when deploying:

1. **`DB_HOST` must be the compose service name `database`, not `localhost`.**
   `.env.example` ships `DB_HOST=localhost`, which is correct for dev where the
   app runs on the host, and wrong for the prod compose where the app runs in a
   container. Nothing overrides it in `docker-compose-prod.yml`.
2. **`init.sql` only executes on a fresh volume.** The MySQL entrypoint skips
   `/docker-entrypoint-initdb.d/` when the data directory is already
   initialised. Editing `init.sql` and restarting changes nothing; existing
   databases need the matching file from `migrations/` applied by hand.

The Dockerfile using `npm install` rather than `npm ci` means a production
image can resolve different transitive versions than the lockfile CI tested.

## 5. Testing

**Vitest 4, two projects** in one config (`vitest.config.js:18-50`), so a single
`npm test` runs both:

| Project | Environment | Setup file | Includes |
|---|---|---|---|
| `backend` | node | `tests/setup.js` | `tests/routes/`, `tests/middleware/`, `tests/services/`, `tests/helpers/`, `tests/extensions/`, `tests/*.test.js` |
| `frontend` | jsdom + `@vitejs/plugin-react` | `tests/setup.frontend.js` | `tests/src/**` |

Current state: **57 files, 1128 tests, all passing.**

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

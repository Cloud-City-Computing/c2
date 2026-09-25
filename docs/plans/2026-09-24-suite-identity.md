# Plan: suite identity track

Implements [`../specs/2026-09-24-suite-identity.md`](../specs/2026-09-24-suite-identity.md).

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to
> implement this plan task by task, one fresh subagent per task, with review between tasks. This is
> the standing convention for a written plan in this repo (`docs/plans/README.md`), not a choice to
> re-present. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloud Codex signs people in through any OIDC issuer (Cloud City ID in the suite), keyed on
`(issuer, sub)`, with one hashed session per sign-in, sign-out that propagates in both directions,
machine JWTs for Cloud Command, and an OIDC-only hosted mode, while an install that sets none of
the new variables behaves exactly as it does today.

**Architecture:** a live-MySQL Vitest project lands first so every schema change here is proved on
a real database. Sessions become one row per sign-in, stored as a SHA-256 digest. A pure
identity-resolution seam (`services/identity.js`) takes the Google ladder, then the OIDC relying
party (`services/oidc.js`, `routes/oidc.js`) is a port of Cloud Command's, with a new
`user_identities` table and session provenance. Back-channel logout deletes sessions and closes
exactly their sockets. `verifyMachineCredential` gains a JWT branch behind a subject allowlist.

**Tech stack:** Node 22 (from PR 5), Express 5, MySQL 8.4 (`mysql2/promise`), `openid-client` 6,
`jose` 6, Vitest 4 + Supertest, Docker Compose.

**Order:** one PR per session, merged in this order. PR 3 (W6-CDX-4) has no dependency on PR 2 and
may run beside it. PR 8 also needs the hosting plan's PR 2 (W6-CDX-32) merged first, because
both change `ensureAdminUser` and W6-CDX-32's never-promote rule lands first. Every PR here is on
the test-deploy path, PR 9 included (Kyle's decision D-M).

| PR | Session | Branch |
|---|---|---|
| 1 | W6-CDX-10, the live-MySQL test project | `w6/cdx-10-live-mysql` |
| 2 | W6-CDX-2, one hashed session per sign-in | `w6/cdx-2-sessions` |
| 3 | W6-CDX-4, the identity-resolution seam | `w6/cdx-4-identity-seam` |
| 4 | W6-CDX-3, the `__Host-` cookie and Origin-required writes | `w6/cdx-3-cookie-origin` |
| 5 | W6-CDX-5, the OIDC relying party | `w6/cdx-5-oidc-rp` |
| 6 | W6-CDX-6, sign-out that propagates | `w6/cdx-6-sign-out` |
| 7 | W6-CDX-7, machine JWTs | `w6/cdx-7-machine-jwt` |
| 8 | W6-CDX-8, hosted mode | `w6/cdx-8-hosted-mode` |
| 9 | W6-CDX-9, machine membership endpoints for the sync | `w6/cdx-9-machine-members` |

**Baseline**, measured 2026-09-24 in a worktree of `origin/main` `91493a6` after `npm ci`:
`npm test` reports `Test Files 71 passed (71)` and `Tests 1479 passed (1479)`. CI runs Node 20;
the measurement ran on Node 22.22.2.

`npm test | tail` reports `tail`'s exit code, not Vitest's. Read the summary line.

## Before every PR

- [ ] `git fetch origin && git switch -c <branch> origin/main` from the repository root.
- [ ] Re-derive every anchor this PR's section names. Anchor on the **named function, route or
      column** and find its line with `grep -n`; the `:line` numbers below are from `91493a6` and
      will have moved.
- [ ] For PRs 5 to 8 (W6-CDX-5 to W6-CDX-8, the sessions W6-CCID-3 gates): read Cloud City ID's
      issuer-contract results (W6-CCID-3, in that private repository's
      `docs/research/issuer-contract-<date>/`). **If a finding contradicts this PR's section, edit
      the section in this plan first, in the same PR**, and say so in the PR body.
- [ ] `cd cloudcodex && npm ci && npm test`, and record the counts in the PR body.
- [ ] Before `gh pr create`: an adversarial review of the diff (the `momus` reviewer), given the
      riskiest file and the claims to disprove. Watch CI to green; never report done on a pending
      or red run.

## Global constraints

Every task's requirements implicitly include this section.

- **Run `npm` from `cloudcodex/`.** `make` and `docker compose` run from the repository root.
- **Every new source file opens with the project header** (one-line description, then
  `All Rights Reserved to Cloud City Computing, LLC 2026` and `https://cloudcitycomputing.com`).
- **`no-console` allows only `console.error`**, in the format
  `` `[${new Date().toISOString()}] ${req.method} ${req.path}:` `` for request-scoped logs.
- **`no-implicit-coercion`**: `Boolean(x)` and `Number(x)`, never `!!x` or `+x`.
- **All SQL is parameterized** through `c2_query(sql, params)`; identifiers that cannot be bound
  (a throwaway schema name) go through `mysql.escapeId`.
- **Every async handler is wrapped in `asyncHandler`**, and every router ends with
  `router.use(errorHandler)`.
- **Backend tests queue `c2_query` mocks in the exact order the handler issues queries.** Moving
  code must keep the query order, or the tests that were right start failing for the wrong reason.
- **Schema changes are a dated `migrations/YYYY-MM-DD-<topic>.sql` and an `init.sql` edit**, and
  every such file declares at least one `CREATE TABLE` or `ADD COLUMN`, or `--adopt-fresh-install`
  refuses it (`scripts/migrate.js:389-404`). Never append to `LEGACY_BASELINE`.
- **Coverage is per-glob** (`vitest.config.js:79-137`). New modules under `services/` get their
  own threshold entry at the level they achieve minus a small buffer.
- **Maps move in the same PR** as the code they describe (CLAUDE.md checklist item 7). New env vars
  go in `.env.example` with a comment (item 3).
- **Every new env var joins the configuration contract in the PR that reads it.** The contract is
  `cloudcodex/env-contract.js`, the hosting plan's PR 2 (W6-CDX-32), and its test fails on a
  variable read without an entry. If the file exists, add the entry with the `kind`,
  `requiredWith` and `perInstance` this plan gives; if it does not yet, the hosting plan's Task 2.1
  finds the variable on its first run and takes the same values from here. Read each variable as
  `process.env.NAME`, by literal name, never as `env.NAME` on an object passed in: the contract's
  scan sees only literal reads, so a parameter would hide the variable from it. Tests set and
  restore `process.env` instead.
- **The source never names Cloud City, Cloud City ID or Zitadel.** Tests may name Zitadel only
  when they record a real issuer's behaviour. The suite's display name is the `SUITE_NAME`
  setting (the UI plan's PR 5 adds it and its single-source test), and the company's legal name,
  `Cloud City Computing, LLC`, in each file header is the only `Cloud City` the source carries.
- **No em dash characters** in code comments, commit messages or docs.

---

## PR 1: W6-CDX-10, the live-MySQL integration test project

### Task 1.1 Record the baseline

- [ ] Run `cd cloudcodex && npm test 2>&1 | grep -E 'Test Files|Tests '`.

**Expected:** `Test Files  71 passed (71)` and `Tests  1479 passed (1479)` at `91493a6`, or whatever
`main` reports today. Paste both lines into the PR body; Task 1.7 compares against them.

### Task 1.2 The project guard, failing first

`cloudcodex/tests/test-projects.test.js`, which the backend project already picks up through its
`tests/*.test.{js,jsx}` include (`vitest.config.js:33`):

```javascript
/**
 * Pins which Vitest projects the default `npm test` runs
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../vitest.config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Projects that need something a contributor may not have (a MySQL server).
// Everything else MUST be in the default run, or it silently stops running.
const OPT_IN = new Set(['integration']);

const projectFlags = (script) => [...script.matchAll(/--project\s+(\S+)/g)].map((m) => m[1]).sort();

describe('the default test run', () => {
  const declared = config.test.projects.map((p) => p.test.name);

  it('declares the integration project', () => {
    expect(declared).toContain('integration');
  });

  for (const script of ['test', 'test:coverage']) {
    it(`${script} names every project except the opt-in ones`, () => {
      expect(projectFlags(pkg.scripts[script])).toEqual(declared.filter((n) => !OPT_IN.has(n)).sort());
    });
  }

  it('test:integration runs the integration project and nothing else', () => {
    expect(projectFlags(pkg.scripts['test:integration'])).toEqual(['integration']);
  });
});
```

- [ ] Run `npm test`. **Expected:** this file fails (no `integration` project, no flags); nothing
      else changes.

### Task 1.3 The project, and the scripts

`cloudcodex/vitest.config.js`, a third entry in `test.projects` after `frontend`:

```javascript
      {
        plugins: [],
        test: {
          name: 'integration',
          globals: true,
          environment: 'node',
          setupFiles: ['./tests/setup.integration.js'],
          globalSetup: ['./tests/integration/global-setup.js'],
          include: ['tests/integration/**/*.test.js'],
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
```

`cloudcodex/package.json` scripts:

```json
    "test": "vitest run --project backend --project frontend",
    "test:watch": "vitest --project backend --project frontend",
    "test:coverage": "vitest run --coverage --project backend --project frontend",
    "test:integration": "vitest run --project integration",
```

Update the file header comment in `vitest.config.js` ("Two projects") to name all three.

### Task 1.4 The per-file setup

`cloudcodex/tests/setup.integration.js`. It runs once per test **file**, before the file is
imported, which is what lets it set `DB_NAME` before `mysql_connect.js` binds its pool
(`mysql_connect.js:18-32`). It deliberately does **not** mock `mysql_connect.js`.

```javascript
/**
 * Per-file setup for the live-MySQL integration project
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { afterAll } from 'vitest';
import { runMigrations, MIGRATIONS_DIR } from '../scripts/migrate.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// mysql_connect.js reads no DB_PORT, so the server must answer on 3306.
const admin = {
  host: process.env.IT_DB_HOST ?? '127.0.0.1',
  user: process.env.IT_DB_ROOT_USER ?? 'root',
  password: process.env.IT_DB_ROOT_PASSWORD,
};
if (!admin.password) {
  throw new Error('IT_DB_ROOT_PASSWORD is required for npm run test:integration (see tests/README.md)');
}

export const schema = `c2_it_${randomBytes(6).toString('hex')}`;

const conn = await mysql.createConnection({ ...admin, multipleStatements: true });
await conn.query(`CREATE DATABASE ${mysql.escapeId(schema)}`);
await conn.changeUser({ database: schema });
// init.sql has no USE statement, so it builds into whichever schema is current.
await conn.query(readFileSync(path.join(REPO_ROOT, 'init.sql'), 'utf8'));

const query = async (sql, params) => {
  const [rows] = await conn.query(sql, params);
  return Array.isArray(rows) ? rows : [];
};
await runMigrations({ query, dir: MIGRATIONS_DIR, adoptFreshInstall: true, log: () => {} });

// Bound before any test file imports an app module.
process.env.DB_HOST = admin.host;
process.env.DB_USER = admin.user;
process.env.DB_PASS = admin.password;
process.env.DB_NAME = schema;

afterAll(async () => {
  await conn.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(schema)}`);
  await conn.end();
});
```

`cloudcodex/tests/integration/global-setup.js` exports `teardown()`, which connects as the admin,
runs `SHOW DATABASES LIKE 'c2\\_it\\_%'`, drops whatever it finds, and **then throws** naming them
if the list was non-empty, so a file that crashed before its `afterAll` turns the run red instead of
leaking a schema onto the developer's server.

### Task 1.5 The first real tests

`cloudcodex/tests/integration/migrate.test.js`:

- **Canary.** `import * as db from '../../mysql_connect.js'`, then
  `expect(vi.isMockFunction(db.c2_query)).toBe(false)` and
  `expect((await db.c2_query('SELECT DATABASE() AS d', []))[0].d).toBe(process.env.DB_NAME)`.
- **Adoption recorded every file.** `SELECT COUNT(*) AS n FROM schema_migrations` equals
  `listMigrationFiles(MIGRATIONS_DIR).length`.
- **A second run is a no-op.** `runMigrations({ query, dir: MIGRATIONS_DIR })` resolves with
  `applied: []` and `pending: []`.
- **The schema check refuses a schema missing a post-baseline column.** In a second throwaway
  schema built the same way but **not** adopted, run
  `ALTER TABLE password_reset_tokens DROP CHECK chk_password_reset_tokens_purpose, DROP COLUMN purpose`,
  then expect `runMigrations({ ..., adoptFreshInstall: true })` to reject with a message containing
  `password_reset_tokens.purpose`. Drop that schema in the test's own `finally`.

- [ ] Run, with a MySQL 8.4 on 3306 (the repo's compose file, `make` target or a scratch
      container): `IT_DB_ROOT_PASSWORD=<pw> npm run test:integration`.

**Expected:** 4 tests pass; `SHOW DATABASES LIKE 'c2\_it\_%'` afterwards returns nothing.

### Task 1.6 CI, inside the required job

`.github/workflows/ci.yml`, on the existing `test` job (`name: Lint, test and build`), so the check
that is already required on `main` covers it and no branch-protection change is needed:

```yaml
    services:
      mysql:
        image: mysql:8.4
        env:
          MYSQL_ROOT_PASSWORD: ci-root-password
        ports:
          - 3306:3306
        options: >-
          --health-cmd "mysqladmin ping -h 127.0.0.1 -pci-root-password"
          --health-interval 5s --health-timeout 5s --health-retries 30
```

and, after `npm test` and before coverage:

```yaml
      - name: Integration tests (live MySQL)
        env:
          IT_DB_HOST: 127.0.0.1
          IT_DB_ROOT_PASSWORD: ci-root-password
        run: npm run test:integration
```

The password is a throwaway for an ephemeral service container, not a secret, and says so in a
comment. `release.yml`'s `verify` job gains the same service and step, so a tag cannot publish an
image whose schema changes were never run.

### Task 1.7 Prove it, then document it

- [ ] `npm test`: **Task 1.1's counts plus exactly one file and four tests**, the ones in
      `test-projects.test.js`, and nothing from `tests/integration/`. Record both runs in the PR
      body.
- [ ] Mutations, each confirmed to have **landed** before its red run is trusted: re-add
      `vi.mock('../mysql_connect.js')` to the integration setup (the canary fails); skip the
      `afterAll` drop (the teardown throws); add a migration file that `ALTER`s a table that does
      not exist (the integration step fails); drop `--project frontend` from `test` (the guard
      fails). Revert each.
- [ ] `docs/maps/build-test-and-ops.md`: section 5 (three projects, what the integration project
      needs, `IT_DB_*`), section 6 (the service and step); `cloudcodex/tests/README.md`; CLAUDE.md's
      Testing section gains one sentence naming the integration project and its opt-in.
- [ ] `npm run lint`, `npm run test:coverage`, `npm run build` all exit 0.

---

## PR 2: W6-CDX-2, one hashed session per sign-in

### Task 2.1 The digest helper

`cloudcodex/services/session-token.js`:

```javascript
/**
 * The one definition of how a session token is stored
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { createHash } from 'node:crypto';

/**
 * SHA-256 of the token, lowercase hex. sessions.id holds this, never the token:
 * a database dump then yields nothing a browser can present. 64 characters, so
 * the CHAR(64) column is unchanged.
 * @param {string} token
 * @returns {string}
 */
export function hashSessionToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
```

It lives outside `mysql_connect.js` so the global mock in `tests/setup.js` does not have to
reproduce it. Unit test `tests/services/session-token.test.js`: a known vector
(`hashSessionToken('abc')` is
`ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`), 64 lowercase hex characters,
and different inputs give different digests.

### Task 2.2 `generateSessionToken` inserts, and every lookup hashes (tests first)

In `tests/mysql_connect.test.js`, **replace** the two reuse tests (`reuses an existing non-expired
session and updates metadata`, `refreshes an expired session in place with a new random token`)
and extend the insert test; list all three in the PR body:

- a sign-in issues exactly one statement, an `INSERT INTO sessions`, binding
  `[7, hashSessionToken(token), 'local', null, null]`, and returns a 64-character alphanumeric
  token that is **not** the bound id;
- two calls for the same user return two different tokens and issue two inserts;
- `{ provider: 'google' }` binds `'google'`;
- `validateAndAutoLogin('raw')` and `touchSession('raw')` bind `hashSessionToken('raw')`.

Watch them fail, then `cloudcodex/mysql_connect.js`:

```javascript
import { hashSessionToken } from './services/session-token.js';

/**
 * Mints a new session for `user`: one row per sign-in, so signing out of one
 * device leaves the others alone. Returns the raw token; only its digest is
 * stored.
 * @param { Object } user - Must contain an `id` property
 * @param { string } [ip]
 * @param { string } [userAgent]
 * @param { { provider?: 'local'|'google' } } [options]
 * @returns { Promise<String> }
 */
export async function generateSessionToken(user, ip = null, userAgent = null, { provider = 'local' } = {}) {
  const token = createNewSessionToken();
  await c2_query(
    `INSERT INTO sessions (user_id, id, auth_provider, created_at, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY), ?, ?)`,
    [user.id, hashSessionToken(token), provider, ip, userAgent]
  );
  return token;
}
```

and `hashSessionToken(sessionToken)` as the bound parameter in `validateAndAutoLogin` and
`touchSession`.

### Task 2.3 The routes bind the digest

`routes/auth.js`: logout (`DELETE FROM sessions WHERE id = ?`) and update-account's
keep-this-device delete (`... WHERE user_id = ? AND id != ?`) bind `hashSessionToken(token)`.
Reset's `DELETE FROM sessions WHERE user_id = ?` is unchanged. `routes/oauth.js`'s Google callback
calls `generateSessionToken(user, req.ip, ua, { provider: 'google' })`.

Test edits, listed in the PR body: the two logout assertions at `tests/routes/auth.test.js:279-281`
and `:294-295` expect `[hashSessionToken('header-token')]` and `[hashSessionToken('cookie-token')]`.
New: update-account binds the digest; the Google callback passes `{ provider: 'google' }`.

### Task 2.4 The migration and `init.sql`

`migrations/<today>-session-per-sign-in.sql`, with a header in the style of
`2026-09-08-token-purpose.sql` explaining the deploy order and why the hash rides with a column:

```sql
ALTER TABLE sessions
  ADD COLUMN auth_provider VARCHAR(16) NOT NULL DEFAULT 'local' AFTER user_id;

ALTER TABLE sessions
  ALTER COLUMN auth_provider DROP DEFAULT;

ALTER TABLE sessions
  ADD CONSTRAINT chk_sessions_auth_provider CHECK (auth_provider IN ('local', 'google'));

-- Existing ids are raw 64-character tokens drawn from [A-Za-z0-9]. A digest is
-- lowercase hex, so only rows holding a character outside [0-9a-f] are raw:
-- the statement is idempotent, and harmless if the new image already wrote
-- digests. 'c' makes the match case-sensitive whatever the column collation.
UPDATE sessions SET id = SHA2(id, 256) WHERE REGEXP_LIKE(id, '[^0-9a-f]', 'c');
```

`init.sql`'s `CREATE TABLE sessions` gains, with comments, `auth_provider VARCHAR(16) NOT NULL`
after `user_id` and
`CONSTRAINT chk_sessions_auth_provider CHECK (auth_provider IN ('local', 'google'))`, and a comment
on `id` saying it is the digest.

- [ ] `node -e "import('./scripts/migrate.js').then(m => console.log(m.schemaClaims(require('fs').readFileSync('../migrations/<file>', 'utf8'))))"`
      **Expected:** `[ { kind: 'column', table: 'sessions', column: 'auth_provider' } ]`.

### Task 2.5 Reap expired sessions

`server.js`, beside `pruneOldActivity`:

```javascript
// Daily prune of expired sessions. Every row now has a fixed 7-day life and
// nothing refreshes one in place, so without this the table only grows.
async function pruneExpiredSessions() {
  try {
    const result = await c2_query(`DELETE FROM sessions WHERE expires_at < NOW()`, []);
    if (result?.affectedRows) {
      console.error(`[${new Date().toISOString()}] session prune: removed ${result.affectedRows} rows`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] session prune failed:`, err);
  }
}
setInterval(pruneExpiredSessions, ONE_DAY_MS).unref();
setTimeout(pruneExpiredSessions, 60 * 1000).unref();
```

Extend `tests/server.test.js` the way it covers the activity prune.

### Task 2.6 Live-MySQL proof

`cloudcodex/tests/integration/sessions.test.js`, against the real module:

- two `generateSessionToken` calls for one user make two rows; deleting one by its digest leaves the
  other's `validateAndAutoLogin` returning the user;
- no `sessions.id` equals either raw token;
- `SELECT SHA2(?, 256) AS d` equals `hashSessionToken(?)` for three tokens;
- an `INSERT INTO sessions (id, user_id, expires_at)` that omits `auth_provider` rejects with
  `ER_NO_DEFAULT_FOR_FIELD`, and `auth_provider = 'oidc'` rejects on the CHECK (until PR 5);
- **the apply path, not just adoption**: in the test's own throwaway schema, reverse the change
  (`DROP CHECK`, `DROP COLUMN auth_provider`, delete the file's `schema_migrations` row), insert a
  row whose id is a raw token, run `runMigrations` normally, then assert the column exists and
  `validateAndAutoLogin(rawToken)` returns the user; run the file's `UPDATE` again and assert
  `affectedRows` is 0.

### Task 2.7 Pin the cookie's host-only shape

`tests/routes/oauth.test.js`: drive the Google callback to its success branch with the existing
`google-auth-library` mocking pattern in that file and assert every `Set-Cookie` header matches
`/sessionToken=/` and does not match `/;\s*Domain=/i`.

### Task 2.8 Docs and verification

- [ ] `docs/maps/request-lifecycle.md` "Session tokens" and "Logout actually terminates the
      session now"; `docs/maps/data-model.md` section 4; `docs/maps/open-questions.md` C2 marked
      resolved with the PR number; `CHANGELOG.md` `[Unreleased]`: a Security entry (digests at rest,
      one session per device) and a Migration entry with the stop, migrate, start order.
- [ ] `npm run lint`, `npm test`, `npm run test:coverage`, `npm run test:integration`,
      `npm run build`. Coverage for `mysql_connect.js` stays at or above its 85/85/80/90 floor.

---

## PR 3: W6-CDX-4, the identity-resolution seam

### Task 3.1 `resolveIdentity`, Google policy, tests first

`cloudcodex/services/identity.js` exports:

```javascript
/**
 * Decide which local user a verified external identity is.
 *
 * Returns { ok: true, userId, created } or { ok: false, reason } where reason is
 * one of: email_not_verified, domain_not_allowed, no_account,
 * identity_conflict, email_conflict. Never throws for a refusal; a thrown
 * error is a database failure and reaches errorHandler.
 *
 * @param {{ provider: 'google'|'oidc', issuer?: string, subject: string,
 *           email: string, emailVerified: boolean, name?: string,
 *           picture?: string|null, hostedDomain?: string }} claims
 * @param {{ requiredHostedDomain?: string, linkByVerifiedEmail: boolean,
 *           autoCreate: boolean }} policy
 */
export async function resolveIdentity(claims, policy) { /* ... */ }

export async function deriveUniqueUsername(email) { /* moved verbatim from oauth.js:111-135 */ }
```

For `provider: 'google'` the body is today's `oauth.js:218-281`, **the same SQL in the same
order**: the `email_verified` refusal, the hosted-domain refusal, the
`oauth_accounts ... provider = 'google' AND provider_user_id = ?` lookup, the `users WHERE email = ?`
lookup and link, then create-and-link only when `autoCreate`, else `no_account`. The Google route
builds `policy = { requiredHostedDomain: GOOGLE_OAUTH_DOMAIN || undefined, linkByVerifiedEmail: true,
autoCreate: Boolean(GOOGLE_OAUTH_DOMAIN) }` and maps `{ ok: false, reason }` to the redirect it
issues today (`/?oauth_error=<reason>`).

`tests/services/identity.test.js` covers every branch with the `c2_query` mock, including that a
refusal issues no write.

### Task 3.2 Move the route onto it, with zero assertion edits

- [ ] `routes/oauth.js` imports `resolveIdentity` and `deriveUniqueUsername` from
      `services/identity.js`; the moved code is deleted from the route.
- [ ] `npm test`. **Expected:** `tests/routes/oauth.test.js` and `tests/routes/auth.test.js` pass
      **with no edits**; `git diff --stat tests/routes` shows nothing.

### Task 3.3 `AUTH_PROVIDERS`

`services/identity.js` exports `parseAuthProviders()`, which reads `process.env.AUTH_PROVIDERS`:

- unset: today's set, `local` plus `google` when Google is configured;
- set: a comma list of `local`, `google`; an unknown name, a listed provider that is not
  configured, or (until PR 8) a list without `local`, throws with a sentence naming the variable.

`server.js` calls it in the boot block beside the admin check and exits 1 with that sentence.
Tests for each case; `.env.example` documents the variable as "leave unset". Contract entry:
`{ name: 'AUTH_PROVIDERS', kind: 'optional', perInstance: false }` (a hosted box sets `oidc` in its
env template, not per link).

### Task 3.4 Verify

- [ ] Lint, `npm test`, coverage (add a `services/identity.js` threshold at achieved minus a small
      buffer), build. Map: `docs/maps/request-lifecycle.md` section 3 names the seam.

---

## PR 4: W6-CDX-3, the `__Host-` cookie and Origin-required cookie writes

### Task 4.1 One definition of the cookie, server side (tests first)

`cloudcodex/services/session-cookie.js`:

```javascript
export const SESSION_COOKIE = '__Host-sessionToken';
export const LEGACY_SESSION_COOKIE = 'sessionToken';

/** The name a Secure cookie must carry; the legacy name only when not Secure. */
export function sessionCookieName({ secure }) {
  return secure ? SESSION_COOKIE : LEGACY_SESSION_COOKIE;
}

/**
 * Legacy fallback is on unless LEGACY_SESSION_COOKIE=0 (hosted instances). Read
 * by literal name so the configuration contract's scan sees it.
 */
export function legacyCookieAllowed() {
  return process.env.LEGACY_SESSION_COOKIE !== '0';
}

/**
 * The session token in a Cookie header. The prefixed cookie always wins: a
 * sibling host can toss `sessionToken=...; Domain=<parent>; Path=/api`, and the
 * browser sends the longer path FIRST, but it cannot set a __Host- cookie with
 * a Domain at all. The legacy name is read only when no prefixed cookie exists
 * and the fallback is allowed.
 */
export function readSessionCookie(cookieHeader, { allowLegacy }) {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(';').map((c) => c.trim());
  const valueOf = (name) => {
    const hit = pairs.find((c) => c.startsWith(`${name}=`));
    return hit ? hit.slice(name.length + 1) || null : null;
  };
  return valueOf(SESSION_COOKIE) ?? (allowLegacy ? valueOf(LEGACY_SESSION_COOKIE) : null);
}
```

`middleware/auth.js`'s `extractSessionToken` keeps the `Authorization` branch first and replaces
its cookie branch with `readSessionCookie(req.headers.cookie, { allowLegacy: legacyCookieAllowed() })`.
Tests: prefixed beats legacy in either order; legacy alone authenticates only with the flag on; an
empty value is null.

### Task 4.2 The server's one write

`routes/oauth.js`: `const secure = process.env.NODE_ENV === 'production';` then
`res.cookie(sessionCookieName({ secure }), sessionToken, { maxAge, httpOnly: false, secure,
sameSite: 'strict', path: '/' })`. A `__Host-` cookie requires `Secure`, `Path=/` and no `Domain`,
which this satisfies. The test from PR 2's Task 2.7 is extended: in production the header starts
`__Host-sessionToken=` and has no `Domain`.

### Task 4.3 The client's writes, read and clear

`src/util.jsx` gains `writeSessionCookie(token)`, `clearSessionCookie()` and a
`getSessionTokenFromCookie()` that prefers the prefixed name:

```javascript
const SESSION_COOKIE = '__Host-sessionToken';
const LEGACY_SESSION_COOKIE = 'sessionToken';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

// __Host- requires Secure, and a browser drops a Secure cookie written from
// plain http other than localhost, so the name follows the page's scheme.
const secureContext = () => window.location.protocol === 'https:';

export function writeSessionCookie(token) {
  const name = secureContext() ? SESSION_COOKIE : LEGACY_SESSION_COOKIE;
  const secure = secureContext() ? '; secure' : '';
  document.cookie = `${name}=${token}; path=/; max-age=${SESSION_MAX_AGE}${secure}; samesite=strict`;
}

export function clearSessionCookie() {
  for (const name of [SESSION_COOKIE, LEGACY_SESSION_COOKIE]) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;${name === SESSION_COOKIE ? ' secure;' : ''}`;
  }
}
```

`getSessionTokenFromCookie` reads the prefixed cookie first; finding only a legacy one on https, it
rewrites it with `writeSessionCookie` and expires the legacy name (upgrade on use).
`Login.jsx:123`, `:140`, `:190` call `writeSessionCookie(res.token)`; `AccountPanel.jsx:15` calls
`clearSessionCookie()`. Frontend tests in `tests/src/util.test.jsx` for each, with
`window.location.protocol` stubbed both ways.

### Task 4.4 Origin-required cookie writes

- [ ] First, the audit: `grep -rn "fetch(" src | grep -v apiFetch` and read each hit. **Expected:**
      every unsafe-method call already sends `Authorization` (through `apiFetch` or by hand). Any
      that does not is fixed in this PR to send it, and listed in the PR body.
- [ ] Move the CORS delegate's allow logic (`app.js:53-109`) into an exported
      `isAllowedOrigin(req, origin)` in `middleware/origin.js`, used by the delegate unchanged, so
      the two rules cannot drift. The existing CORS tests in `tests/app.test.js` pass unedited.
- [ ] Then, after CORS in `app.js`:

```javascript
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A cookie is sent by the browser on its own; a bearer header is not. So only a
 * request that is authenticated by cookie ALONE can be forged cross-site, and
 * only those need a passing Origin. SameSite=Strict adds nothing between
 * sibling hosts under one registrable domain, which is how the suite is hosted.
 */
export function requireOriginForCookieWrites(req, res, next) {
  if (!UNSAFE_METHODS.has(req.method)) return next();
  if (req.headers.authorization) return next();
  if (!readSessionCookie(req.headers.cookie, { allowLegacy: true })) return next();
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(req, origin)) return next();
  return res.status(403).json({ success: false, message: 'Cross-origin request refused' });
}
```

mounted as `app.use('/api', requireOriginForCookieWrites)` before the routers. Tests: a cookie-only
POST with no Origin is 403; with the app's own Origin it passes; a bearer-only POST with no Origin
passes; a GET is untouched.

### Task 4.5 Pin the WebSocket Origin rule

`tests/services/collab.test.js` and `tests/services/user-channel.test.js`: an upgrade with no
`Origin` and an upgrade whose Origin host differs from `Host` (a sibling) both get
`HTTP/1.1 403 Forbidden` and a destroyed socket. These pin today's behaviour
(`collab.js:217-238`, `user-channel.js:90-109`).

### Task 4.6 Verify, including by hand

- [ ] `.env.example` documents `LEGACY_SESSION_COOKIE`, with the contract entry
      `{ name: 'LEGACY_SESSION_COOKIE', kind: 'default', default: '1', perInstance: false }` (a
      hosted box sets `0` in its env template); `docs/maps/request-lifecycle.md` and
      `docs/security.md` describe the cookie and the Origin rule.
- [ ] Lint, test, coverage, integration, build.
- [ ] By hand, in a browser over https (or `localhost`), at desktop and mobile widths: log in, open
      a document in two tabs and edit (collab), receive a notification, log out. Capture with
      `iris shoot` and read the images. Record what was checked in the PR body.

---

## PR 5: W6-CDX-5, the OIDC relying party, `user_identities`, and session provenance

### Task 5.1 Node 22, its own commit

- [ ] `cloudcodex/Dockerfile` lines 11 and 22: `node:22-slim`. `ci.yml` and `release.yml`:
      `node-version: 22`. `package.json`: `"engines": { "node": ">=22" }`. `CLAUDE.md:20` and every
      "Node 20" under `docs/` (`git grep -n "Node 20"`).
- [ ] `npm ci && npm test && npm run build` on Node 22. **Expected:** the Task 1.1 counts plus this
      track's additions, all green. Commit alone: `Node 22: the runtime, CI and the docs`.

### Task 5.2 Dependencies

- [ ] `npm install openid-client@^6.8.8 jose@^6.2.12`. **Expected:** both in `dependencies`, the
      lockfile updated, no other top-level change.

### Task 5.3 Schema, tested on real MySQL first

`migrations/<today>-user-identities.sql`:

```sql
CREATE TABLE user_identities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  -- utf8mb4_bin: an OIDC sub is case-sensitive, and the default collation
  -- would treat "Ab" and "ab" as the same person.
  issuer VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  email_at_link VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_user_identities_issuer_subject (issuer, subject),
  -- One identity per issuer per user: the same-issuer conflict rule as a fact.
  UNIQUE KEY uq_user_identities_user_issuer (user_id, issuer)
) ENGINE=InnoDB;

ALTER TABLE sessions
  ADD COLUMN identity_id INT NULL AFTER auth_provider,
  ADD COLUMN provider_sid VARCHAR(255) NULL AFTER identity_id,
  ADD INDEX idx_sessions_provider_sid (provider_sid),
  ADD CONSTRAINT fk_sessions_identity
    FOREIGN KEY (identity_id) REFERENCES user_identities(id) ON DELETE CASCADE;

ALTER TABLE sessions DROP CHECK chk_sessions_auth_provider;

ALTER TABLE sessions
  ADD CONSTRAINT chk_sessions_auth_provider CHECK (auth_provider IN ('local', 'google', 'oidc'));
```

`init.sql`: `user_identities` goes after `users` and **before** `sessions` (the CREATEs run with
foreign-key checks on, `init.sql:38`), joins the `DROP TABLE` list at the top, and `sessions`
gains the two columns, the index, the FK and the widened CHECK.

**Why no pairing CHECK:** MySQL refuses a CHECK over a column that carries a foreign-key
referential action (`identity_id` has `ON DELETE CASCADE`). `generateSessionToken` therefore takes
`{ provider: 'oidc', identityId, providerSid }` and throws before issuing SQL if `provider` is
`oidc` without an `identityId`, or has one without being `oidc`.

`tests/integration/identities.test.js`, written first: a subject differing only in case is a
different identity; a second identity at the same issuer for one user is refused by
`uq_user_identities_user_issuer`; deleting a user cascades to identities and their sessions;
`auth_provider = 'oidc'` is accepted; attempting the pairing CHECK in a scratch schema fails with
MySQL's `ER_CHECK_CONSTRAINT_CLAUSE_USING_FK_REFER_ACTION_COLUMN` (record the code it actually
returns; this is the proof that the rule has to live in code); and adoption of an `init.sql`
schema succeeds.

### Task 5.4 `services/oidc.js`, the port

A plain-JS port of Cloud Command's relying party. Its public surface:

```javascript
/**
 * Reads and validates OIDC_* and APP_URL, each as process.env.NAME by literal
 * name (the configuration contract's scan sees only those); returns null when
 * OIDC is not configured.
 */
export function getOidcConfig() {}

/** { url, flowCookie } for a fresh state, nonce and PKCE pair, carrying a validated returnTo. */
export async function beginLogin(config, { returnTo }) {}

/**
 * Completes the code exchange. Returns { issuer, subject, email, emailVerified,
 * name, sid, returnTo }, reading identity claims from USERINFO, or throws
 * OidcLoginError(code) with one of: flow_expired, exchange_failed,
 * no_id_token, userinfo_failed.
 */
export async function completeLogin(config, currentUrl, flowCookieValue) {}

export function signFlowCookie(payload, secret) {}
export function verifyFlowCookie(value, secret) {}
export function resetOidcCache() {} // tests only
```

Load-bearing details, each with a test:

- **Discovery once per process**, with the client metadata
  `{ client_secret, [client.clockTolerance]: 60 }`, and `execute: [client.allowInsecureRequests]`
  **only** when the configured issuer is `http:` on a loopback host (`localhost`, `127.0.0.1`,
  `::1` or a `*.localhost` name). Any other `http:` issuer fails config validation at boot.
- **The redirect URI is `new URL('/api/auth/oidc/callback', APP_URL)`**, never built from a request.
  OIDC enabled with `APP_URL` unset fails boot, and so does `OIDC_ISSUER_URL` set without
  `OIDC_CLIENT_ID` or `OIDC_CLIENT_SECRET`, naming the missing variable.
- **The flow cookie** is HMAC-SHA256 over a base64url JSON payload `{ state, nonce, codeVerifier,
  returnTo, exp }` keyed by the client secret, compared with `timingSafeEqual`, 10-minute TTL. Its
  name is `__Secure-oidcFlow` when `NODE_ENV=production` (a `__Host-` name needs `Path=/`, and this
  cookie's path is `/api/auth/oidc`), `oidcFlow` otherwise; `HttpOnly`, and **`SameSite=Lax`**,
  because the callback is a cross-site top-level navigation from the issuer and a `Strict` cookie
  would not be sent on it.
- **Scope `openid email profile`**, then `authorizationCodeGrant` with `expectedState`,
  `expectedNonce`, `pkceCodeVerifier` and `idTokenExpected: true`; `sub` and `sid` from the ID
  token; `email`, `email_verified` and `name` from `fetchUserInfo`, falling back to the ID token's
  claims only when no access token came back. An unverified or missing email throws
  `email_not_verified` before any database read.

### Task 5.5 `returnTo`, one validator and one corpus

`services/return-to.js` exports `safeReturnTo(value)`, returning the value or `'/'`:

```javascript
const MAX = 2048;
export function safeReturnTo(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX) return '/';
  let decoded = value;
  // Reject the encoded forms too: decode repeatedly, bounded, and test each layer.
  for (let i = 0; i < 3; i += 1) {
    if (!/^\/(?![/\\])/.test(decoded)) return '/';
    if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return '/';
    if (/^\/[^/]*:/.test(decoded)) return '/';
    let next;
    try { next = decodeURIComponent(decoded); } catch { return '/'; }
    if (next === decoded) return value;
    decoded = next;
  }
  return '/';
}
```

`tests/fixtures/return-to-corpus.json` is **the file Cloud Command commits for W6-CMD-24, copied
byte for byte**, with its source commit in a `_source` field; the test asserts every hostile entry
maps to `/` and every benign one to itself. If W6-CMD-24 has not landed, write the corpus here
(`//evil.example`, `/\evil.example`, `https://evil.example`, `/%2F%2Fevil.example`,
`/%5Cevil.example`, `javascript:alert(1)`, `/\u0000x`, a 2049-character path, and benign
`/archives/1/doc/2?x=1#h`) and hand it to Cloud Command.

### Task 5.6 The ladder for `oidc`

`resolveIdentity` gains the `oidc` branch, in this order:

1. `SELECT id, user_id FROM user_identities WHERE issuer = ? AND subject = ?`. A hit: update
   `last_login_at`; if the verified email differs from `users.email`, update it unless another row
   holds that address (`SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?`), which
   refuses `email_conflict` and changes nothing. Return the user.
2. With `linkByVerifiedEmail`: `SELECT id FROM users WHERE LOWER(email) = LOWER(?)`. A hit that
   already has an identity at this issuer (`SELECT 1 FROM user_identities WHERE user_id = ? AND
   issuer = ?`) refuses `identity_conflict`; otherwise insert the identity and return the user.
3. (PR 8 adds the invitation step here.)
4. Refuse `no_account`.

Unit tests for every step with the `c2_query` mock, and the live-MySQL identity test extended to
drive the ladder end to end, including the unique-key race (two concurrent links of one user at one
issuer: exactly one wins, the other refuses `identity_conflict`).

### Task 5.7 The routes

`routes/oidc.js`, mounted in `app.js` only when `getOidcConfig()` is non-null:

- `GET /api/auth/oidc/start?returnTo=`: `beginLogin` with `safeReturnTo(req.query.returnTo)`, set
  the flow cookie, `302` to the issuer.
- `GET /api/auth/oidc/callback`: `completeLogin`, clear the flow cookie, `resolveIdentity` with the
  `oidc` policy (`linkByVerifiedEmail` from `OIDC_LINK_BY_VERIFIED_EMAIL`, default on;
  `autoCreate: false`), then `generateSessionToken(user, ip, ua, { provider: 'oidc', identityId,
  providerSid: sid })` with `expires_at` from `OIDC_SESSION_TTL_HOURS` (default 24; the function
  takes a `ttlHours` option that local and Google never pass), set the session cookie exactly as the
  Google callback does, and `302` to the sealed `returnTo`. Every refusal redirects to
  `/?oauth_error=<code>`, the pattern `Std_Layout.jsx:306-311` already reads.
- `app.js`: `app.use('/api/auth/oidc/callback', authLimiter)` beside the Google line
  (`app.js:147`).

OIDC sessions skip local 2FA: the callback never consults `two_factor_method`. `GET
/api/2fa/status` adds `managed_by: 'oidc' | null` from the caller's session's `auth_provider`.
`GET /api/oauth/providers` adds `oidc: { enabled, name }`, with `name` from `OIDC_PROVIDER_NAME`
(default `SSO`). `Login.jsx` renders "Sign in with {name}" linking to `/api/auth/oidc/start`,
beside the Google button.

`parseAuthProviders` (PR 3) now accepts `oidc`, still requiring `local` until PR 8.

### Task 5.8 The reader check by subject

`routes/workspaces.js` reader check: an optional `subject` query parameter (at most 255
characters). When present, the user is resolved first through
`JOIN user_identities ui ON ui.user_id = u.id WHERE ui.issuer = ? AND ui.subject = ?` with the
configured issuer, then by email as today. Unknown subject and unknown email answer the same
`{ canRead: false }`. The existing 14 reader-check tests pass unedited; new ones cover the subject
path and that the answer is identical when the subject matches nobody.

### Task 5.9 The fake issuer, and a real one

- [ ] `tests/routes/oidc-callback.real-issuer.test.js` (backend project): an in-process HTTP issuer
      built with `jose` serving discovery, JWKS, token and userinfo, **with identity claims only at
      userinfo**. Drive `/start` to `/callback` with Supertest, following the redirect by hand, and
      assert a session is minted for the right user and the `returnTo` is honoured. Cases: a tampered
      flow cookie, a wrong `state`, a wrong `nonce`, an unverified email, a `sub` conflict.
- [ ] A real sign-in against the local Cloud City ID stack (W6-CCID-1 and W6-CCID-2), recorded in
      `docs/research/oidc-cloud-city-id-<date>/` with the commands, the decoded ID token (no
      secrets), and a screenshot read by a person.

### Task 5.10 Docs and verification

- [ ] `.env.example`: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
      `OIDC_PROVIDER_NAME`, `OIDC_LINK_BY_VERIFIED_EMAIL`, `OIDC_SESSION_TTL_HOURS`, each commented.
- [ ] `cloudcodex/env-contract.js` gains the six (see Global constraints for when the file does
      not exist yet). `perInstance: true` marks what Cloud Command's operator link tool (W6-CMD-31)
      prints into each instance's snippet, and its test asserts over every such entry:

      | Variable | `kind` | `requiredWith` | `perInstance` |
      |---|---|---|---|
      | `OIDC_ISSUER_URL` | `optional` | | `true` (the issuer the instance's application is registered at) |
      | `OIDC_CLIENT_ID` | `optional` | `OIDC_ISSUER_URL` | `true` |
      | `OIDC_CLIENT_SECRET` | `optional` | `OIDC_ISSUER_URL` | `true` |
      | `OIDC_PROVIDER_NAME` | `default`, `SSO` | | `false` (suite mode labels the button from `SUITE_NAME`) |
      | `OIDC_LINK_BY_VERIFIED_EMAIL` | `default`, `1` | | `false` |
      | `OIDC_SESSION_TTL_HOURS` | `default`, `24` | | `false` |

      **Expected:** `npx vitest run tests/env-contract.test.js` green, and red with any one entry
      removed.
- [ ] `docs/security.md`: what the issuer is trusted for (a verified email and a stable `sub`) and
      for nothing else. Maps: request-lifecycle section 3, data-model section 4, access-control
      section 7 (the subject path). CLAUDE.md "Auth & accounts" and critical decision 4, per the
      spec. CHANGELOG `[Unreleased]`.
- [ ] Lint, test, coverage (thresholds for `services/oidc.js`, `services/identity.js`,
      `services/return-to.js`, `routes/oidc.js`), integration, build. **Every pre-existing test
      passes unmodified.**

---

## PR 6: W6-CDX-6, sign-out that propagates

### Task 6.1 RP-initiated logout

`POST /api/logout`: after deleting the row, if the deleted row's `auth_provider` was `oidc`,
answer `{ success: true, endSessionUrl }` where

```javascript
client.buildEndSessionUrl(configuration, {
  post_logout_redirect_uri: new URL('/?signedOut=1', APP_URL).href,
  state: randomState(),
});
```

(which adds `client_id` itself). No ID token is stored or sent. `AccountPanel.jsx`'s
`performLogout` keeps ending locally first (it already clears the cookie before navigating), then
navigates to `endSessionUrl` when present, else `/`. Tests: a local session gets no URL; an OIDC
session gets exactly `client_id`, `post_logout_redirect_uri` and `state`; a failed request still
ends locally (frontend test).

### Task 6.2 The back-channel receiver

`routes/oidc.js`, mounted only with OIDC:

```javascript
router.post(
  '/auth/oidc/backchannel-logout',
  backchannelLimiter,              // its own IP-keyed limiter; never authLimiter
  express.urlencoded({ extended: false, limit: '16kb' }),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const claims = await verifyLogoutToken(req.body?.logout_token);   // null on any failure
    if (!claims) return res.status(400).json({ success: false, message: 'Invalid logout token' });
    const deleted = await revokeForLogoutToken(claims);                // digests of deleted rows
    closeCollabSocketsForSessions(deleted);
    closeUserChannelSocketsForSessions(deleted);
    return res.status(200).end();
  })
);
```

`verifyLogoutToken` uses `jose.jwtVerify` against `jose.createRemoteJWKSet(new URL(jwks_uri))` from
the cached discovery document, with `issuer`, `audience: clientId`, `clockTolerance: 60`, and then
requires: `iat` within the last 5 minutes; `events` has the member
`http://schemas.openid.net/event/backchannel-logout`; **no** `nonce`; `sid` or `sub`; and a `jti`
not seen before, recorded in a bounded in-process `Map` (10,000 entries, entries older than 10
minutes evicted), which is correct for the single process CLAUDE.md decision 1 requires.
`revokeForLogoutToken` deletes `WHERE auth_provider = 'oidc' AND provider_sid = ?` when `sid` is
present, else every OIDC session of the `(iss, sub)` identity, and returns the deleted ids.

`backchannelLimiter`: 300 requests per minute per IP, because every logout token arrives from the
issuer's one address. Tests: one per validation rule, each deleting nothing; deletion by `sid` and
by `sub`; a `requireAuth` route (`GET /api/permissions`) then answers 401 for the revoked session.

### Task 6.3 Sockets know their session

- `validateAndAutoLogin` returns the user with a non-enumerable `sessionId` (the digest) so every
  existing caller keeps working; the global mock in `tests/setup.js` is unchanged because it returns
  whatever a test tells it to.
- `services/collab.js` and `services/user-channel.js` store `ws.sessionId` at authentication and
  export `closeSocketsForSessions(digests)`, which closes (code 4004, "Signed out") every socket
  whose `sessionId` is in the set, and only those.
- `POST /api/logout` calls both for the one session it deleted.

Tests: two sockets for one user from two sessions; revoking one closes only its socket.

### Task 6.4 Verify, against a real issuer

- [ ] Maps: request-lifecycle (logout, the receiver, its limiter), documents-and-collab (socket
      teardown). CHANGELOG.
- [ ] Lint, test, coverage, integration, build.
- [ ] Against the local Cloud City ID stack with Cloud Command also signed in: signing out of Cloud
      Command makes Codex answer 401 and closes both of that browser's sockets. Record it.

---

## PR 7: W6-CDX-7, machine JWTs through `verifyMachineCredential`

### Task 7.1 The branch, tests first

In `services/machine-auth.js`, before the shared-secret comparison:

```javascript
const JWS_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

if (JWS_SHAPE.test(token) && jwtConfig()) {
  return verifyMachineJwt(token);   // never falls through to the static token
}
```

`jwtConfig()` returns `{ issuer, audience, subjects: Set }` only when `OIDC_ISSUER_URL`,
`MACHINE_OIDC_AUDIENCE` and `MACHINE_OIDC_SUBJECTS` (comma list) are all set, each read as
`process.env.NAME`. `verifyMachineJwt` runs `jose.jwtVerify` against the cached JWKS with
`issuer`, `audience` and `clockTolerance: 60`, requires `subjects.has(payload.sub)`, then resolves
the principal exactly as today: the `SERVICE_TOKEN_USER` row, refused if missing or admin, returned
with `is_admin: false`. A 64-character session token has no dots, so it never enters the branch.

Tests: a valid token yields the principal; right `aud` and wrong `sub` is null; another instance's
`aud` is null; expired is null; a session token never reaches `jose`; an admin principal is
refused; with the three variables unset the static path is byte-identical. The existing
`requireMachine` and `machineOrAuth` tests pass unedited.

### Task 7.2 Docs

- [ ] The file header (`machine-auth.js:1-30`) describes both paths. `docs/maps/access-control.md`
      section 7; `.env.example`; CLAUDE.md "Machine callers". CHANGELOG. Lint, test, coverage.
- [ ] `cloudcodex/env-contract.js` gains
      `{ name: 'MACHINE_OIDC_AUDIENCE', kind: 'optional', perInstance: true }` (the instance's own
      Zitadel project id) and
      `{ name: 'MACHINE_OIDC_SUBJECTS', kind: 'optional', perInstance: true }` (its allowlisted
      service users), both printed by the operator link tool (W6-CMD-31). Neither is
      `requiredWith` anything: with one missing, the JWT branch stays off and a JWT is refused,
      which is the safe degradation. **Expected:** the contract test green, red with either entry
      removed.

---

## PR 8: W6-CDX-8, hosted mode

### Task 8.1 `AUTH_PROVIDERS=oidc`

`parseAuthProviders` accepts a list without `local`. With `local` absent, `app.js` does not mount
the local routes: `routes/auth.js` exports the local-only handlers (`/login`, `/create-account`,
`/forgot-password`, `/reset-password`, `/check-username/:username`, `/update-account`'s password
branch, and every `/2fa/*`) behind one `if (providers.has('local'))` in the router, and the matching
`authLimiter` lines in `app.js` follow the same guard. Tests: with `AUTH_PROVIDERS=oidc` each of
those answers 404; with it unset every existing test passes unedited.

### Task 8.2 A provider-aware admin

`ensureAdminUser`: with `local` disabled, `SELECT id, is_admin FROM users WHERE LOWER(email) =
LOWER(?)` on `ADMIN_EMAIL` only, create without `password_hash` if absent, set `is_admin`, and
never write a password. `server.js:17-21` requires `ADMIN_USERNAME` and `ADMIN_PASSWORD` only while
`local` is enabled; `ADMIN_EMAIL` stays required. The one existing boot assertion that moves is
named in the PR body. The hosting plan's W6-CDX-32 has already landed (it is a precondition of this
PR) and refuses to promote an existing non-admin; keep that refusal on both branches, local and
OIDC-only, and its tests unedited.

`ADMIN_USERNAME` may now be unset, and two readers assume it is not: the `INSERT INTO users`
(`users.name` is `NOT NULL UNIQUE`) and `bootstrapInstance`, which names the starter workspace
`` `${adminName}'s Workspace` `` from the variable (`routes/admin.js:115` and `:123` at
`91493a6`). The created admin's `name` is `ADMIN_USERNAME` when set, else
`deriveUniqueUsername(ADMIN_EMAIL)`; `bootstrapInstance` reads the name from the admin's row
instead of the variable. Test: with `AUTH_PROVIDERS=oidc` and no `ADMIN_USERNAME`, boot seeds a
workspace named for the derived username, with its `General` squad, which is where PR 9 places
every synced member (D-S). On the test box `ADMIN_EMAIL` is the Cloud City operator address, which
belongs to no partner (D-R); that is configuration in the box's env template, never a literal
here.

### Task 8.3 Invitations bind on verified email

`resolveIdentity`'s step 3 for `oidc`: `SELECT * FROM user_invitations WHERE LOWER(email) =
LOWER(?) AND accepted = FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`. A hit runs,
in one `withTransaction`, the same sequence `POST /api/create-account` runs (`routes/auth.js:139-165`):
insert the user with `deriveUniqueUsername(email)` and no password, `createDefaultPermissions`,
the conditional `UPDATE user_invitations SET accepted = TRUE WHERE id = ? AND accepted = FALSE`
with its `affectedRows` checked, `addSquadMember` when the invitation carries a squad, and the
`user_identities` insert. Tests with the mock queue, and a live-MySQL test that an invited email
lands in its squad.

### Task 8.4 Deactivation

`migrations/<today>-user-deactivation.sql`: `ALTER TABLE users ADD COLUMN deactivated_at TIMESTAMP
NULL DEFAULT NULL;` and the `init.sql` edit. `validateAndAutoLogin` adds `AND u.deactivated_at IS
NULL` (joined on the user row it already reads); `resolveIdentity` refuses `account_deactivated` for
a deactivated user at every step; local login refuses too. Tests for each path.

### Task 8.5 The deep-link bounce for OIDC-only instances

`Std_Layout.jsx`'s signed-out branch (`:272-276`): instead of `standardRedirect('/')`, when
`/api/oauth/providers` reports OIDC as the only provider, and `sessionStorage` holds no
`c2-oidc-bounce` marker for this tab, set the marker and
`window.location.assign('/api/auth/oidc/start?returnTo=' + encodeURIComponent(path + search))`.
With the marker already set, or an `oauth_error` in the query, render the landing instead (the loop
guard). The marker is cleared on a successful sign-in. The logic lives in a tested hook,
`src/hooks/useSignedOutTarget.js`, because pages are out of test scope. The UI track's W6-CDX-26
builds suite mode and the mixed-provider case on this hook.

### Task 8.6 Verify

- [ ] A fresh hosted instance boots with `AUTH_PROVIDERS=oidc`, no `ADMIN_PASSWORD` and no
      `ADMIN_USERNAME`, seeds its starter workspace and `General` squad, and the `ADMIN_EMAIL` user
      signs in through the local Cloud City ID stack as admin. An invited email
      lands in its squad; an uninvited one gets `no_account`; a deactivated one is refused; a
      signed-out deep link lands on the document. Record it.
- [ ] Maps, `.env.example`, `docs/deployment.md` ("Hosted mode"), CHANGELOG. Lint, test, coverage,
      integration, build.

---

## PR 9: W6-CDX-9, machine membership endpoints for the sync

On the test-deploy path (Kyle's decision D-M). Cloud Command's W6-CMD-7 calls these routes when a
member is added, re-roled or removed; the workspace owner arrives as `admin`, everyone else as
`member`. Squad placement is Kyle's decision D-S: every synced person, the owner included, lands in
the instance's seeded `General` squad with read and write, through the invitation's existing
`squad_id` and `can_write`. The `ADMIN_EMAIL` boot admin is never a synced person: on the test box
it is Cloud City's operator address, which belongs to no partner (D-R).

### Task 9.1 The flag the invitation needs, tested on real MySQL first

`migrations/<today>-invitation-grants-admin.sql` and the matching `init.sql` edit to
`user_invitations`:

```sql
ALTER TABLE user_invitations ADD COLUMN grants_admin BOOLEAN NOT NULL DEFAULT FALSE;
```

`tests/integration/invitation-grants-admin.test.js`: the column exists with default `FALSE` after
the runner applies the file, `--adopt-fresh-install` still adopts an `init.sql` schema, and a
second run is a no-op. **Expected:** red before the migration file exists, green after.

W6-CDX-8's invitation binding (Task 8.3) gains one clause: when the bound invitation has
`grants_admin`, the `INSERT INTO users` in the same transaction sets `is_admin = TRUE`. Test: an
invited owner's first OIDC sign-in creates an admin; an invited member's does not.

### Task 9.2 The routes, tests first

`routes/machine-members.js`:

```javascript
/**
 * Membership sync from a paired product: admit, re-role and remove by email
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import crypto from 'node:crypto';
import express from 'express';
import { withTransaction } from '../mysql_connect.js';
import { requireMachine } from '../middleware/auth.js';
import { asyncHandler, errorHandler, isValidEmail } from './helpers/shared.js';
import { closeSocketsForSessions as closeCollab } from '../services/collab.js';
import { closeSocketsForSessions as closeInbox } from '../services/user-channel.js';

const router = express.Router();
const ROLES = new Set(['admin', 'member']);
const OK = { success: true };

function readEmail(raw) {
  const email = typeof raw === 'string' ? raw.trim() : '';
  return email && email.length <= 255 && isValidEmail(email) ? email : null;
}

// The boot sync owns the ADMIN_EMAIL row and would undo any change at the next
// restart. A hosted operator sets ADMIN_EMAIL to an address no synced member
// holds, so a sync that reaches this is misconfigured.
const isBootAdmin = (email) =>
  Boolean(process.env.ADMIN_EMAIL) && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();

// Where an admitted member lands: the General squad bootstrapInstance seeds in
// the boot admin's starter workspace. null when an admin has renamed or deleted
// it; the invitation then names no squad and the instance admin places them.
async function generalSquadId(query) {
  const rows = await query(
    `SELECT s.id FROM squads s
       JOIN workspaces w ON w.id = s.workspace_id
       JOIN users u ON u.id = w.owner_id
      WHERE s.name = 'General' AND LOWER(u.email) = LOWER(?)
      ORDER BY s.id LIMIT 1`,
    [process.env.ADMIN_EMAIL]
  );
  return rows.length > 0 ? rows[0].id : null;
}

router.put('/machine/members', requireMachine, asyncHandler(async (req, res) => {
  const email = readEmail(req.body?.email);
  const role = req.body?.role;
  if (!email || !ROLES.has(role)) {
    return res.status(400).json({ success: false, message: 'An email and a role of admin or member are required' });
  }
  if (isBootAdmin(email)) {
    return res.status(409).json({ success: false, message: 'This account is managed by the server configuration' });
  }
  const admin = role === 'admin';
  await withTransaction(async (query) => {
    const users = await query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1 FOR UPDATE', [email]);
    if (users.length > 0) {
      // Squads are left alone: after admission, placement is the instance admin's.
      await query('UPDATE users SET is_admin = ?, deactivated_at = NULL WHERE id = ?', [admin, users[0].id]);
      return;
    }
    const open = await query(
      `SELECT id, squad_id FROM user_invitations
        WHERE LOWER(email) = LOWER(?) AND accepted = FALSE
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [email]
    );
    // An invitation that already names a squad (an admin's, made by hand) keeps it.
    const keepsSquad = open.length > 0 && open[0].squad_id !== null;
    const squadId = keepsSquad ? null : await generalSquadId(query);
    if (open.length > 0) {
      await query(
        `UPDATE user_invitations
            SET grants_admin = ?, expires_at = NOW() + INTERVAL 1 YEAR, invited_by = ?,
                squad_id = COALESCE(squad_id, ?), can_write = can_write OR ?
          WHERE id = ?`,
        [admin, req.user.id, squadId, squadId !== null, open[0].id]
      );
    } else {
      // can_read defaults to TRUE and role to 'member' (init.sql user_invitations).
      await query(
        `INSERT INTO user_invitations
           (email, token, invited_by, expires_at, grants_admin, squad_id, can_write)
         VALUES (?, ?, ?, NOW() + INTERVAL 1 YEAR, ?, ?, ?)`,
        [email, crypto.randomBytes(32).toString('hex'), req.user.id, admin, squadId,
         squadId !== null]
      );
    }
  });
  res.json(OK);
}));

router.delete('/machine/members/:email', requireMachine, asyncHandler(async (req, res) => {
  const email = readEmail(req.params.email);
  if (!email) return res.status(400).json({ success: false, message: 'A valid email is required' });
  if (isBootAdmin(email)) {
    return res.status(409).json({ success: false, message: 'This account is managed by the server configuration' });
  }
  const digests = await withTransaction(async (query) => {
    await query(
      'UPDATE user_invitations SET expires_at = NOW() WHERE LOWER(email) = LOWER(?) AND accepted = FALSE',
      [email]
    );
    const users = await query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1 FOR UPDATE', [email]);
    if (users.length === 0) return [];
    await query('UPDATE users SET deactivated_at = NOW(), is_admin = FALSE WHERE id = ?', [users[0].id]);
    const rows = await query('SELECT id FROM sessions WHERE user_id = ?', [users[0].id]);
    await query('DELETE FROM sessions WHERE user_id = ?', [users[0].id]);
    return rows.map((row) => row.id);
  });
  closeCollab(digests);
  closeInbox(digests);
  res.json(OK);
}));

router.use(errorHandler);

export default router;
```

The token is minted exactly as `POST /api/admin/invitations` mints one (`routes/admin.js:439`,
32 random bytes as hex, which `user_invitations.token CHAR(64) NOT NULL UNIQUE` expects,
`init.sql:141`). The invitation names `General` in `squad_id` with `can_write` set; `role`
(`member`) and the other flags take their column defaults (`init.sql:143-150`), so W6-CDX-8's
binding (Task 8.3) calls `addSquadMember` and the person lands in `General` with read and write
(D-S). `generalSquadId` finds the squad the way `bootstrapInstance` made it (`routes/admin.js:128`,
the squad named `General` in a workspace the boot admin owns), because nothing else marks it;
re-derive these anchors by name at execution.

**Its own limiter, never `authLimiter`.** `authLimiter` (`app.js:128-135`, 20 requests per 15
minutes) is one bucket shared by every path it is mounted on, the login routes and the C2-5 reader
check (`app.js:157`) included. Linking or adopting a workspace (a restored one included, when it
is linked) in Cloud Command syncs every current member at once, owner first (W6-CMD-31,
W6-CMD-7), so on that bucket a workspace of more than twenty members would be refused partway and
would spend the login budget of every request from Cloud Command's address. `app.js` defines,
beside `authLimiter`:

```javascript
// Machine membership sync (routes/machine-members.js). Its own bucket, sized
// like the back-channel receiver's for one caller's bursts: linking or adopting
// a workspace (a restored one included, when it is linked) syncs every member
// at once. A 429 here is retryable, and the caller retries it.
const machineMembersLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'Too many membership requests, please try again later' },
});
app.use('/api/machine/members', machineMembersLimiter);
```

and mounts the router under `/api`. `app.use` matches by prefix, so the one line covers
`DELETE /api/machine/members/:email` too. Cloud Command's W6-CMD-7 treats a 429 as retryable, never
as a permanent failure.

Tests, `tests/routes/machine-members.test.js`, with the mock queue in the order above:

- `PUT` for an unknown address inserts an invitation with `grants_admin` matching the role, the
  `General` squad and `can_write` true; with `General` gone (the squad lookup returns no row) it
  inserts one with a `NULL` squad and `can_write` false; for an open invitation with no squad it
  refreshes that row and names `General`; one that already names a squad keeps it; for a user it
  sets `is_admin` and clears `deactivated_at` and issues no squad query; a re-role from `admin` to
  `member` writes `is_admin = FALSE`.
- An ownership transfer, the new owner's `PUT` as `admin` then the old owner's as `member`, writes
  exactly those two `is_admin` values and nothing for the `ADMIN_EMAIL` row.
- `DELETE` expires invitations, deactivates, deletes the sessions and passes exactly those digests
  to both `closeSocketsForSessions`; an unknown address answers the same `{ success: true }`.
- The `ADMIN_EMAIL` address gets 409 from both routes and issues no write.
- A bad email or role is 400. A signed-in session gets the same 401 an anonymous caller gets:
  queue a principal row it never uses, the C2-5 false-green guard.
- `tests/app.test.js`, with the limiters not skipped for that case: none of 21 machine `PUT`s in a
  row answers 429 (`authLimiter` would refuse the 21st), and a login attempt afterwards is not
  refused either, so the two buckets are separate.

**Expected:** each test red before the route exists, green after.

### Task 9.3 Proof on real MySQL, then docs

- [ ] `tests/integration/machine-members.test.js`, on a schema `bootstrapInstance` has seeded: admit
      an owner and a member, sign both in through the fake issuer, and assert the owner is an admin
      and the member is not, that both are `General` members with `can_read` and `can_write`, and
      that the member can read the seeded welcome document; transfer ownership (the member to
      `admin`, then the owner to `member`) and assert exactly the new owner and the boot admin
      have `is_admin`; rename `General`, admit a third address, and assert their invitation names
      no squad; `DELETE` the old owner, now a member, and assert their next request is 401, their
      sign-in is refused, and the documents they wrote keep their `created_by`.
- [ ] `docs/api/` (both routes, the 409 and the 429), the access-control map (the machine surface
      now writes, and this is the one path that can grant `is_admin`), `docs/security.md`'s
      rate-limit list (the machine membership limiter), CLAUDE.md "Machine callers", CHANGELOG.
      Lint, test, coverage, integration.

---

## Retirement

The last PR of this track to merge (normally PR 9) also deletes
`docs/specs/2026-09-24-suite-identity.md` and this plan, marks the identity row in
`docs/specs/roadmap.md` shipped with its PR numbers, and removes the spec's rows from
`docs/specs/README.md` and `docs/README.md`. The maps are the record.

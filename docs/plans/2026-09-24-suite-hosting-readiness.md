# Plan: suite hosting readiness track

Implements [`../specs/2026-09-24-suite-hosting-readiness.md`](../specs/2026-09-24-suite-hosting-readiness.md).

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to
> implement this plan task by task, one fresh subagent per task, with review between tasks. This is
> the standing convention for a written plan in this repo (`docs/plans/README.md`), not a choice to
> re-present. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the published Cloud Codex image can be run under a supervisor, behind a TLS proxy, beside
other instances on one MySQL server, and restored from a backup, and the test box pins a release
that has all of it.

**Architecture:** `node` is PID 1's child directly, a bounded shutdown flushes collaborative state,
`/healthz` and `/readyz` report without leaking, and a `GET_LOCK` held for the process's life makes
a second writer refuse. A configuration contract test pins every environment variable the server
reads. The per-instance grant recipe is proved on real MySQL. Document images go through an
authorized handler. Backup and restore are scripts with a drill.

**Tech stack:** Node 22, Express 5, MySQL 8.4, Docker, Bash, Vitest 4 and the live-MySQL project.

**Precondition:** W6-CDX-10 has merged (PR 1 of
[`2026-09-24-suite-identity.md`](2026-09-24-suite-identity.md)).

**Order:** one PR per session. PRs 1, 2 and 4 are independent of each other.

| PR | Session | Needs first | Branch |
|---|---|---|---|
| 1 | W6-CDX-31, signals, health, readiness, the lock | W6-CDX-10 | `w6/cdx-31-lifecycle` |
| 2 | W6-CDX-32, production configuration and the contract | W6-CDX-10 | `w6/cdx-32-config` |
| 3 | W6-CDX-33, grants and the isolation proof | PR 2 | `w6/cdx-33-grants` |
| 4 | W6-CDX-34, document images for readers only | W6-CDX-10 | `w6/cdx-34-doc-images` |
| 5 | W6-CDX-35, backup and restore | PR 1 | `w6/cdx-35-backup` |
| 6 | W6-CDX-36, the Wave 6 release | PRs 1 to 5, and the other tracks' deploy-path PRs | `release/v0.11.0` (or the next minor) |

## Before every PR

- [ ] `git fetch origin && git switch -c <branch> origin/main`; re-derive anchors by name.
- [ ] `cd cloudcodex && npm ci && npm test && npm run test:integration`; record the counts.
- [ ] Before `gh pr create`: an adversarial review (the `momus` reviewer); then CI to green.

## Global constraints

The identity plan's global constraints apply. In addition:

- **A self-hoster's `docker compose up` keeps working at every step.** Each PR is checked with the
  release compose file on a clean clone before it merges.
- **Health answers carry no version, no counts and no table names.** They are reachable by anyone
  who can reach the port.
- **The single process stays the architecture** (CLAUDE.md decision 1). The lock enforces it; it
  does not relax it.

---

## PR 1: W6-CDX-31, a container that stops cleanly and says when it is ready

### Task 1.1 Node as the process

`cloudcodex/Dockerfile:45`: `CMD ["node", "server.js"]`. `NODE_ENV=production` already comes from the
runtime stage's `ENV` (`Dockerfile:27`), which is why the `start` script's own `NODE_ENV=` prefix is
not needed in the image.

- [ ] `docker build -t c2:lifecycle ./cloudcodex && docker run --rm c2:lifecycle cat /proc/1/cmdline | tr '\0' ' '`
      **Expected:** `node server.js`.

### Task 1.2 Flush and close, as testable units

- `services/collab.js` exports `flushPendingSaves()`: for every entry in `docs` (`collab.js:36`) with
  a pending `saveTimer`, clear it and run the same `UPDATE logs SET ydoc_state = ?` that
  `scheduleSave` (`collab.js:110-122`) would have, awaiting each and continuing past one that
  throws; and `closeAll(code, reason)`.
- `services/user-channel.js` exports `closeAll(code, reason)`.
- `mysql_connect.js` exports `endPool()`; the global mock in `tests/setup.js` gains
  `endPool: vi.fn(async () => {})`, done first and alone so no other test moves.

### Task 1.3 `shutdown(deps)`

`services/shutdown.js`:

```javascript
/**
 * Stop in an order that loses nothing: refuse new work, flush what is pending,
 * close the sockets, release the database. Bounded, because a supervisor sends
 * SIGKILL after its grace period whether or not this finished.
 */
export function createShutdown({ server, readiness, flushPendingSaves, closeSockets, releaseLock,
                                 endPool, exit, log, timeoutMs = 10_000 }) {
  let started = false;
  return async function shutdown(signal) {
    if (started) return;
    started = true;
    readiness.shuttingDown = true;              // /readyz answers 503 from here on
    const timer = setTimeout(() => { log(`shutdown timed out after ${timeoutMs} ms`); exit(1); }, timeoutMs);
    timer.unref?.();
    server.close();                             // stop accepting connections
    await flushPendingSaves();                  // never throws past one bad entry
    closeSockets(1001, 'Server shutting down');
    await releaseLock();
    await endPool();
    clearTimeout(timer);
    log(`stopped cleanly on ${signal}`);
    exit(0);
  };
}
```

`server.js`: `process.once('SIGTERM', shutdown)` and `process.once('SIGINT', shutdown)`.

`tests/services/shutdown.test.js` with fake timers: the order of calls; `flushPendingSaves` rejecting
still reaches `endPool` and `exit(0)`; a `flushPendingSaves` that never resolves exits 1 at exactly
`timeoutMs`; a second signal is ignored.

### Task 1.4 Health and readiness

`routes/health.js`, mounted in `app.js` **before** the `/api` stack, so neither CORS nor Helmet nor a
limiter is in front of a probe:

```javascript
router.get('/healthz', (_req, res) => res.json({ ok: true }));

router.get('/readyz', asyncHandler(async (_req, res) => {
  const reason = await notReadyReason();       // null, or one of the four words below
  res.status(reason ? 503 : 200).json(reason ? { ready: false, reason } : { ready: true });
}));
```

`notReadyReason()` checks, in order: `shutting_down` (the readiness flag); `lock` (the instance lock
is not held, unless disabled); `database` (`SELECT 1` fails or takes longer than 2 seconds);
`migrations` (a file in `migrations/` has no `schema_migrations` row, reusing
`listMigrationFiles` and `readApplied` from `scripts/migrate.js`, cached for 10 seconds).

Tests: `/healthz` issues zero queries (the `c2_query` mock is never called); each reason; neither body
contains a version, a filename or a count.

`cloudcodex/Dockerfile`: `HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3
CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`.
`docker-compose-prod.yml` and `docker-compose-release.yml`: `stop_grace_period: 20s` on the app.

### Task 1.5 The single-writer lock

`services/instance-lock.js`:

```javascript
const NAME_SQL = `CONCAT('cloudcodex-instance:', DATABASE())`;   // distinct from the runner's lock

export async function acquireInstanceLock({ connect, log }) {
  if (process.env.C2_INSTANCE_LOCK === '0') {
    log('instance lock disabled by C2_INSTANCE_LOCK=0; a second process on this schema will diverge');
    return { held: false, disabled: true, release: async () => {} };
  }
  const conn = await connect();                                   // its own connection, never the pool
  const [[row]] = await conn.query(`SELECT GET_LOCK(${NAME_SQL}, 0) AS got, IS_USED_LOCK(${NAME_SQL}) AS holder`);
  if (row.got !== 1) {
    await conn.end();
    throw new Error(
      `Another Cloud Codex process (MySQL connection ${row.holder}) already serves this database.\n` +
      'Two processes would hold two different copies of every open document. Stop the other one,\n' +
      'or set C2_INSTANCE_LOCK=0 if you know exactly why you need both.'
    );
  }
  const ping = setInterval(() => conn.query('SELECT 1').catch(() => { lock.held = false; }), 60_000);
  ping.unref();
  const lock = { held: true, disabled: false, release: async () => { clearInterval(ping); await conn.end(); } };
  return lock;
}
```

`server.js` acquires it in the boot block, before `ViteExpress.listen`, and exits 1 with the error's
message on refusal. `.env.example` documents `C2_INSTANCE_LOCK`.

### Task 1.6 Live-MySQL proof

`tests/integration/lifecycle.test.js`, forking small Node scripts (`child_process.fork`) that import
the real `instance-lock.js` against the test schema:

- a second process exits non-zero and its stderr names the holder's connection id;
- after `SIGKILL` of the first, a third acquires the lock within 2 seconds;
- two different schemas on the one server each hold their own lock at the same time;
- **the edit survives a stop**: start `server.js` as a child (`PORT=0`, the test schema, a seeded
  admin), open `/collab` for a document, send one Yjs update, send `SIGTERM` inside the 3-second
  debounce, wait for exit 0, then read `logs.ydoc_state` and assert it contains the update.

### Task 1.7 Image check and docs

- [ ] `docker build`, `docker run` with the release compose file: `docker inspect --format '{{.State.Health.Status}}'`
      reads `healthy` within 30 seconds; `docker stop` returns within the 20-second grace period and
      the log says "stopped cleanly on SIGTERM".
- [ ] `docs/deployment.md` "Health checks" rewritten (the `/api/oauth/providers` advice goes: it
      reads no database); `docs/maps/request-lifecycle.md` section 1 (boot: the lock) and a
      shutdown section; `docs/maps/build-test-and-ops.md` (the image). CHANGELOG.

---

## PR 2: W6-CDX-32, production configuration that cannot silently point at localhost

### Task 2.1 The contract, written first

`cloudcodex/env-contract.js` exports an array, one entry per variable:

```javascript
export const ENV_CONTRACT = [
  { name: 'APP_URL', kind: 'required-in-production', perInstance: true,
    why: 'invitation, reset and notification links, and the CORS allow rule' },
  { name: 'DB_POOL_SIZE', kind: 'default', default: '10', perInstance: false, why: 'mysql2 connectionLimit' },
  { name: 'SERVICE_TOKEN', kind: 'optional', perInstance: true, why: 'the machine credential' },
  // ...every variable the server reads
];
```

`tests/env-contract.test.js` scans every `.js` file under `cloudcodex/` except `tests/`, `vendor/`,
`node_modules/` and `dist/` for `process.env.NAME` and `process.env['NAME']`, and asserts: the set of
names read equals the set in `ENV_CONTRACT`; every name appears in the repository's `.env.example`;
every `kind` is one of `required`, `required-in-production`, `default`, `optional`; and no file reads
`process.env[` with a computed key. **The per-instance entries are the list Cloud Command's operator
link tool (W6-CMD-31) prints**, so a variable a later track adds without an entry fails here.

- [ ] Run it before any other change. **Expected:** it fails, listing every variable that has no
      entry yet; add them all, then it passes.

### Task 2.2 `APP_URL`, `TRUST_PROXY`, `DB_POOL_SIZE`

- `server.js` boot block: with `NODE_ENV=production` and `APP_URL` unset or not an `http(s)` URL,
  print `✖ APP_URL is required in production: set it to the address people use to reach this
  instance.` and exit 1. Development keeps the `shared.js:146` default.
- `app.js:42`: `app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY))`, where an unset
  value is `1` (today), digits are a hop count, `true`/`false` are booleans, and anything else is
  passed through for Express to validate (`loopback`, a CIDR list).
- `mysql_connect.js:24`: `connectionLimit: poolSize(process.env.DB_POOL_SIZE)`, an integer from 1 to
  100, default 10; anything else exits at import with a sentence naming the variable.

Tests for each, including that `trust proxy` and the pool see the configured values.

### Task 2.3 Pin MySQL

- [ ] `docker pull mysql:8.4 && docker run --rm mysql:8.4 mysqld --version`; record the patch
      version.
- [ ] Set `image: mysql:8.4.<patch>` in `docker-compose.yaml:8`, `docker-compose-prod.yml:3` and
      `docker-compose-release.yml:12`, and the same tag for the CI service W6-CDX-10 added.
- [ ] `tests/compose-pins.test.js`: no compose file and no workflow names a MySQL image without a
      patch version.

### Task 2.4 The admin sync never promotes

`routes/admin.js` `ensureAdminUser`: a matching row that is **not** already an admin is refused:

```javascript
if (existing && !existing.is_admin) {
  console.error(
    `[${new Date().toISOString()}] admin sync: ${username} / ${email} matches an existing ` +
    'non-admin account, refusing to promote it. Promote it in the admin console if that is intended.'
  );
  return null;
}
```

An existing admin is synced as today, and an absent one is created. `bootstrapInstance(null)` already
copes with no admin id (`routes/admin.js:102-103`). Tests: create, sync, and the new refusal. (If the
identity track's W6-CDX-8 has landed, keep its provider-aware branch and add this refusal to both.)

### Task 2.5 Docs

- [ ] `.env.example` comments for `APP_URL` (required in production), `TRUST_PROXY`,
      `DB_POOL_SIZE`. `docs/deployment.md` "Required environment for production" points at
      `env-contract.js`. CHANGELOG. Lint, test, coverage, integration, build.

---

## PR 3: W6-CDX-33, many instances, one MySQL server

### Task 3.1 The recipe

`docs/deployment.md`, a new section "Several instances on one MySQL server":

```sql
CREATE DATABASE c2_acme;
CREATE USER 'c2_acme_app'@'%' IDENTIFIED BY '<generated>';
GRANT SELECT, INSERT, UPDATE, DELETE ON c2_acme.* TO 'c2_acme_app'@'%';
CREATE USER 'c2_acme_mig'@'%' IDENTIFIED BY '<generated>';
GRANT ALL PRIVILEGES ON c2_acme.* TO 'c2_acme_mig'@'%';   -- no GRANT OPTION, nothing global
```

The app runs as `c2_acme_app`; `npm run migrate` runs as `c2_acme_mig` (a one-off container with the
migration user's credentials, as `docs/deployment.md`'s upgrade section already runs it). No user
gets `PROCESS`, `FILE`, `SUPER` or any `*.*` grant.

### Task 3.2 The isolation proof

`tests/integration/tenancy.test.js`: two schemas built from `init.sql` and adopted, two app users and
two migration users per the recipe. As `app_a`, each of these fails with `ER_TABLEACCESS_DENIED_ERROR`
(1142) or `ER_DBACCESS_DENIED_ERROR` (1044), and the test asserts the code:

1. `SELECT` from `schema_b.users`; 2. `INSERT` into it; 3. `UPDATE` it; 4. `DELETE` from it;
5. a `JOIN` of `schema_a.logs` with `schema_b.logs`; 6. a subquery on `schema_b`;
7. `CREATE VIEW` over `schema_b`; 8. `CREATE TABLE ... SELECT` from `schema_b`; 9. `USE schema_b`;
10. `SHOW TABLES FROM schema_b`; 11. `SHOW CREATE TABLE schema_b.users`;
12. `DESCRIBE schema_b.users`; 13. `SELECT` from `mysql.user`; 14. `GRANT SELECT ON schema_b.*`;
15. `SELECT ... INTO OUTFILE` (fails for want of `FILE`);
16. `CREATE TABLE schema_a.x (id INT)` (the app user has no DDL, even on its own schema);
17. `CALL` or `PREPARE` against `schema_b`.

And: `SHOW DATABASES` lists `schema_a` and `information_schema` only (record exactly what 8.4
returns); `information_schema.tables` rows for `schema_b` number zero; `LOAD_FILE('/etc/hostname')`
returns `NULL`. If Cloud Command's 2026-08-24 research names a shape this list lacks, add it.

### Task 3.3 The app runs on DML alone

`tests/integration/grants-sufficient.test.js`: `DB_USER=app_a` for this file, then through
Supertest: log in, create a workspace, squad, archive and document, save it, comment on it, and one
collab edit over a real socket. **Expected:** zero `ER_TABLEACCESS_DENIED_ERROR`, and the
single-writer lock (PR 1) is acquired, since `GET_LOCK` needs no privilege.

### Task 3.4 Prove the proof, and record it

- [ ] Mutation: `GRANT SELECT ON *.* TO app_a`; `tenancy.test.js` goes red; revert.
- [ ] `docs/maps/access-control.md` gains a tenancy section: the boundary between instances is the
      MySQL grant, the boundary inside an instance is the workspace (`isWorkspaceMember`), and what
      neither protects against (an operator with the root password, a shared `app_public` volume).
- [ ] Record the run in `docs/research/instance-isolation-<date>/` (commands, versions, output), the
      evidence the "one container and one schema per customer" decision rests on.

---

## PR 4: W6-CDX-34, document images only for people who can read the document

### Task 4.1 The table

`migrations/<today>-doc-images.sql` and `init.sql`:

```sql
CREATE TABLE doc_images (
  hash CHAR(16) NOT NULL,                 -- the file's name without .webp (routes/helpers/images.js:40-43)
  log_id INT NOT NULL,
  uploaded_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hash, log_id),
  INDEX idx_doc_images_log (log_id),
  FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
```

### Task 4.2 Record ownership where images enter

- `POST /api/doc-images/upload` (`routes/doc-images.js:44`) requires a `logId` field and
  `checkLogWriteAccess` on it, then inserts `(hash, logId, req.user.id)` for each file.
  `src/pages/Editor.jsx`'s upload (`Editor.jsx:79-88`) appends `formData.append('logId', logId)`,
  a one-line change to a page that is otherwise out of test scope.
- `recordDocImages(logId, html)` in `routes/helpers/images.js` inserts `INSERT IGNORE` rows for every
  `/doc-images/<hash>.webp` in the stored HTML. It is called after each `html_content` write that went
  through `extractImagesFromHtml`: `routes/documents.js:96`, `:197`, `:436`, `routes/upload.js:126`,
  `services/collab.js:449`, `:561`.

### Task 4.3 The handler

`app.js`: the `express.static` mount for `/doc-images` (`app.js:176-180`) is replaced by
`routes/doc-images-serve.js`, unless `DOC_IMAGES_PUBLIC=1`, which keeps today's mount:

```javascript
router.get('/doc-images/:file', asyncHandler(async (req, res) => {
  const match = /^([0-9a-f]{16})\.webp$/.exec(req.params.file);
  const token = extractSessionToken(req);
  const user = match && token ? await validateAndAutoLogin(token) : null;
  if (!user) return res.status(404).end();
  const [row] = await c2_query(
    `SELECT 1 FROM doc_images di
       INNER JOIN logs l ON l.id = di.log_id
       INNER JOIN archives p ON p.id = l.archive_id
      WHERE di.hash = ?
        AND (di.uploaded_by = ? OR (${readAccessWhere('p')}))
      LIMIT 1`,
    [match[1], user.id, ...readAccessParams(user)]
  );
  if (!row) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=86400');
  res.type('image/webp').sendFile(path.join(DOC_IMAGES_DIR, `${match[1]}.webp`));
}));
```

An anonymous caller, a non-reader and a missing file all get the same empty 404. Images load through
`<img>` with the cookie, which `SameSite=Strict` still sends for a same-origin image.

### Task 4.4 The backfill

`scripts/backfill-doc-images.js` (`npm run backfill:doc-images`): for every `logs` row whose
`html_content` contains `/doc-images/`, call `recordDocImages`. Idempotent (`INSERT IGNORE`),
batched by 500 ids, and it prints how many rows it recorded. The upgrade notes say: run it once
after migrating, and until it has run, set `DOC_IMAGES_PUBLIC=1` or existing images are hidden from
their readers.

### Task 4.5 Tests and docs

- Unit: the handler's 404 cases are byte-identical; a reader and the uploader get `image/webp` with
  `private` caching; `DOC_IMAGES_PUBLIC=1` mounts the static handler.
- `tests/integration/doc-images.test.js`: a seeded document with an image in its HTML, the backfill
  run, then a reader gets the bytes and a stranger gets 404. Export (`/document/:logId/export`) still
  inlines the image.
- `docs/security.md`, `docs/maps/request-lifecycle.md` (the mount), `.env.example`
  (`DOC_IMAGES_PUBLIC`), the upgrade notes, CHANGELOG.

---

## PR 5: W6-CDX-35, backup and restore as one command, with a drill

### Task 5.1 The scripts

`scripts/backup.sh`, in a new `scripts/` directory at the repository root (the Docker side of the
repository, beside `start.sh`; `cloudcodex/scripts/` is the Node side). `set -euo pipefail`,
shellcheck-clean:

```bash
#!/usr/bin/env bash
# Back up one Cloud Codex instance: the database and the uploads volume, in one archive.
set -euo pipefail
out="${1:?usage: scripts/backup.sh <output.tar.gz>}"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
docker compose -f "${COMPOSE_FILE:-docker-compose-release.yml}" exec -T database \
  sh -c 'exec mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE"' \
  > "$work/database.sql"
docker compose -f "${COMPOSE_FILE:-docker-compose-release.yml}" run --rm --no-deps -T \
  -v "$work:/backup" app tar czf /backup/app_public.tar.gz -C /app/public .
printf '{"created_at":"%s","image":"%s"}\n' "$(date -u +%FT%TZ)" "${CLOUDCODEX_VERSION:-unknown}" > "$work/manifest.json"
tar czf "$out" -C "$work" database.sql app_public.tar.gz manifest.json
echo "Backup written to $out"
```

`scripts/restore.sh <archive>` reverses it into a stopped stack: load `database.sql` (which carries
`schema_migrations`, so the runner's ledger comes back with the data), untar into `app_public`, and
start. `Makefile`: `make backup OUT=...` and `make restore IN=...`.

### Task 5.2 The drill

`tests/integration/backup-restore.test.js` exercises the SQL half without Docker: seed a document
with a pasted image and a comment, `mysqldump` the schema (the CI MySQL service's client), drop it,
restore into a scratch schema, boot the app on it and assert `/readyz` is 200, the document's HTML is
byte-identical, and its image is served to its reader. The Docker half is run by hand on a clean
clone and recorded in the PR body.

### Task 5.3 Docs

`docs/deployment.md` "Backups" (`:140-175`) points at the scripts, with the honest notes: consistent
for InnoDB only; an in-memory CRDT window is lost unless the backup follows a graceful stop; key
material (`GITHUB_CLIENT_SECRET`, `SERVICE_TOKEN`, the OIDC client secret) is not in the archive and
is backed up separately. CHANGELOG.

---

## PR 6: W6-CDX-36, the Wave 6 Codex release the test box pins

### Task 6.1 The precondition, checked

- [ ] Every PR in this plan has merged, and so have the deploy-path PRs of the identity plan (PRs 1
      to 8), the events plan (PRs 1 to 3) and the UI plan (PRs 1 to 7).
- [ ] `git log --oneline v0.10.0..origin/main` (or the latest tag) lists them.

### Task 6.2 Prepare the release

- [ ] `CHANGELOG.md`: `[Unreleased]` becomes `## [0.11.0] - <date>` (the next minor after the latest
      tag; check `git ls-remote --tags origin`), a new empty `[Unreleased]`, and the compare links at
      the bottom.
- [ ] `cloudcodex/package.json` and both `version` fields at the top of `cloudcodex/package-lock.json`;
      `docker-compose-release.yml`'s `${CLOUDCODEX_VERSION:-...}` default; the default quoted in
      `docs/deployment.md`. `release.yml`'s guard checks the first and third.
- [ ] Delete this spec and plan; mark the hosting row in `docs/specs/roadmap.md` shipped; remove the
      spec's rows from `docs/specs/README.md` and `docs/README.md`.
- [ ] Merge the PR.

### Task 6.3 Tag, with Kyle's authorization

- [ ] **Kyle authorizes the tag, because the release is public.** Then
      `git tag -a v0.11.0 -m "Cloud Codex 0.11.0" <merge commit> && git push origin v0.11.0`.
- [ ] Watch `release.yml` to green: `gh run watch`. Record the published digest:
      `docker buildx imagetools inspect ghcr.io/cloud-city-computing/cloud-codex:0.11.0`.

### Task 6.4 Prove the published image

- [ ] From a clean clone, logged out of ghcr.io: `docker compose -f docker-compose-release.yml up -d`,
      then `/readyz` answers 200 within 30 seconds.
- [ ] With the test box's environment (suite mode, OIDC, the webhook subscription, `AUTH_PROVIDERS=oidc`):
      it boots and reports healthy. Measure idle RSS after 10 minutes with `docker stats --no-stream`.
- [ ] Hand the digest and the RSS reading to Cloud Command's W6-CMD-38.

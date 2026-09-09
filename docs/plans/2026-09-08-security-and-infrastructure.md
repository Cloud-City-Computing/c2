# Plan: security and infrastructure track

Implements [`../specs/2026-09-08-security-and-infrastructure.md`](../specs/2026-09-08-security-and-infrastructure.md).

Executed with `superpowers:subagent-driven-development`: one fresh subagent per
task, reviewed between tasks. Five pull requests, one per item, merged in the
order below. Every fix lands failing-test-first: the test that proves the defect
is written and **seen to fail** before the fix is written.

Baseline at the time of writing: `npm test` is green at 67 files / 1300 tests on
`fc23103`. A local `node_modules` missing `@testing-library` will report 33
failed test *files* with 902 passing tests; that is a stale install, not a red
suite. Run `npm ci` from `cloudcodex/` first.

Note on running the suite: `npm test | tail` reports `tail`'s exit code, not
Vitest's. Read the summary line, do not trust the exit code through a pipe.

---

## PR 1: C2-0, close the merge gate

### Task 1.1 Add the build step and give the check a stable name

`.github/workflows/ci.yml`. The workflow currently runs lint, test and coverage
but never builds. Rename the workflow (its current name contains an em dash and
no longer describes what it does) and name the job, because the job name is what
becomes the required status check context.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Lint, test and build
    runs-on: ubuntu-latest
```

Add, after the coverage step and before the artifact upload:

```yaml
      - name: Build production frontend
        run: npm run build
```

**Expected result:** `npm run build` runs in CI. Verify locally first with
`cd cloudcodex && npm run build`, which must exit 0 and write `dist/` (which is
gitignored). The build emits a "Circular chunk" warning about the vendor chunks
and still exits 0, so it will not fail the gate.

Two docs go stale in this same PR and must move with it, per shippability
checklist item 7:

- `docs/maps/build-test-and-ops.md` describes the CI pipeline as
  `npm ci` then `npm run lint` then `npm test` then `npm run test:coverage`,
  with no build step. It is the map for CI and it names the file this PR edits.
- `docs/specs/roadmap.md`'s "## Sequencing" diagram and the paragraph after it
  still enumerate A/B/C/D/E and omit track S, even though this PR's own edit to
  `docs/specs/README.md` points at the roadmap for the order to do them in.

### Task 1.2 Hand Kyle the exact protection command

This half is repository configuration and cannot land in a pull request. The PR
body carries the command; Kyle runs it after the PR merges, once the check name
has been observed on a real run.

A **full `PUT` on `/protection`**, not a `PATCH` on the
`required_status_checks` sub-resource. That sub-resource does not exist yet
(`GET` on it returns 404 `Required status checks not enabled`, measured), so a
`PATCH` cannot enable it. `PUT` replaces the whole object, which means every
field below must reproduce what the branch already carries or the change would
silently drop `main`'s only current protection, the one-approval rule. These
values were read back from the live API, not assumed.

```
gh api -X PUT repos/Cloud-City-Computing/c2/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Lint, test and build"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON
```

`"strict": true` is a deliberate choice with a visible cost: each of the four
remaining PRs will need an "Update branch" and a fresh CI run once the one
before it merges. Keep it. This track lands four PRs that touch the same files,
and a PR proved green against a stale `main` is the case a merge gate exists to
catch.

**Verify** with:

```
gh api repos/Cloud-City-Computing/c2/branches/main/protection/required_status_checks
```

which must return the context rather than 404. Confirm the context string
against `gh pr checks <n>` on the open PR **before running the `PUT`**: a
mismatched context name creates a required check that never reports and blocks
every merge.

**Nothing else in this track merges until this returns a non-null result.**

---

## PR 2: C2-1, the four cross-tenant escalations

### Task 2.1 The workspace-membership predicate (failing tests first)

There is no `workspace_members` table. Membership of workspace `W` is therefore:
the caller is an admin, **or** owns `W` (`workspaces.owner_id`), **or** is a
member of some squad whose `workspace_id` is `W` (`squad_members` joined to
`squads`).

Add to `cloudcodex/routes/helpers/ownership.js`, next to `isArchiveOwner`, and
export both:

```javascript
export async function isWorkspaceMember(user, workspaceId) {
  if (user.is_admin) return true;

  const [row] = await c2_query(
    `SELECT 1 FROM workspaces o
     WHERE o.id = ?
       AND (
         o.owner_id = ?
         OR EXISTS (
           SELECT 1 FROM squad_members sm
           JOIN squads t ON t.id = sm.squad_id
           WHERE t.workspace_id = o.id AND sm.user_id = ?
         )
       )
     LIMIT 1`,
    [Number(workspaceId), user.id, user.id]
  );
  return Boolean(row);
}

export async function isSquadWorkspaceMember(user, squadId) {
  if (user.is_admin) return true;

  const [row] = await c2_query(
    `SELECT t.workspace_id FROM squads t WHERE t.id = ? LIMIT 1`,
    [Number(squadId)]
  );
  if (!row) return false;
  if (row.workspace_id === null) return false;
  return isWorkspaceMember(user, row.workspace_id);
}
```

Tests go in `cloudcodex/tests/helpers/ownership.test.js` alongside the existing
fragment tests. Cover: admin bypass, owner match, squad-member match, non-member
rejection, unknown workspace, and a squad with `workspace_id NULL` (the column
is nullable, `init.sql` `CREATE TABLE squads`).

**Do not touch `readAccessWhere`/`writeAccessWhere` or their params.** Those are
the 7-param positional fragments; this is a separate helper and adds no clause
to them.

### Task 2.2 (a) Squad creation, and the two inverted tests

Write the inversions **first** and watch them fail.

**Both tests land on `404`**, byte for byte the existing not-found body. What
differs is the reasoning and the coverage each one has to preserve.

`cloudcodex/tests/routes/squads.test.js:102-126` currently asserts `201` for a
caller holding only `create_squad` against a workspace owned by user `42`. It
becomes a `404`, and it keeps its original assertions about `addSquadOwnerMember`
by moving them into a new test where the caller **is** a workspace member.

`cloudcodex/tests/routes/squads.test.js:128-145` is the orphaned workspace
(`owner_id: null`). With no owner there is nobody to compare against, and
`isWorkspaceMember` returns false for a non-member, so this is also a `404`, and
it needs its own companion test rather than a copy: the old one was the only
coverage of the `!isOwner && workspace.owner_id` falsy branch. Rename it to say
what it now asserts. The decided rule,
which goes in the map: **an orphaned workspace is not a public workspace.** A
workspace whose owner account was deleted is adopted by an admin, not colonised
by whoever asks first.

Then the fix in `cloudcodex/routes/squads.js`, after the workspace-exists check
at `squads.js:76-83` and before the permission check at `squads.js:86`:

```javascript
    // The workspace is the tenant boundary. Holding create_squad means "may
    // create a squad", not "may create a squad anywhere": without this check
    // any account can enrol itself as owner inside a workspace it has no
    // relationship to.
    if (!(await isWorkspaceMember(req.user, Number(workspaceId)))) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
```

`404` rather than `403` on purpose, and it must match the existing not-found
message exactly: a distinguishable `403` turns this route into a workspace
enumeration oracle.

**Mock ordering:** this adds one `c2_query` call between the workspace lookup
and the permissions lookup, and `isWorkspaceMember` issues one query. Every
`mockResolvedValueOnce` chain in the `POST /workspaces/:id/squads` describe block
shifts by one. Fix the chains, do not "fix" the handler.

### Task 2.3 (b) The requirePermission short-circuit

The fix is **not** to delete the global short-circuit, which would break every
caller that legitimately relies on it with no squad context. The fix is that a
**body-supplied** squad context is validated whether or not the global bit is
set.

**Read this before writing code: only `req.body.squad_id` is validated early.**
An earlier draft of this task moved the whole squad-id resolution block
(`permissions.js:69-78`) above the global check. That is wrong, for two reasons
that a green suite would not have told you:

1. Lines 72-77 of that block issue `SELECT squad_id FROM archives WHERE id = ?`
   derived from `req.params.archiveId`. Today that query never runs on the
   global-bit path. Moving it would make it run on every
   `POST /api/archives/:archiveId/logs` and `/logs/upload` call, shifting the
   `c2_query` mock queue in `tests/routes/archives.test.js` and
   `tests/routes/upload.test.js`. The failure is not a clean assertion error: the
   handler's own `const [archive] = await c2_query(...)` then destructures
   `{ insertId: 10 }`, which is not iterable, so it surfaces as a `TypeError`.
2. It would be a real behaviour regression. A caller holding the global
   `create_log` bit **plus an explicit `write_access` JSON grant** matches
   `writeAccessWhere` clause 2 (`ownership.js:55`) and can create logs today
   without workspace membership. Validating the archive-derived squad early
   would 403 them before `writeAccessWhere` is ever consulted. That is not
   hypothetical: Task 2.4 keeps grant *removal* permanently open precisely
   because cross-tenant grants already exist in real data.

Both `create_log` routes already re-check with `writeAccessWhere` immediately
after the middleware (`archives.js:443-453`, `upload.js:107-119`), so the
archive-derived path was never exploitable and needs no early check.
`POST /api/archives` is the one route where the middleware is the only gate, and
it takes its squad from the body.

So in `cloudcodex/middleware/permissions.js`, resolve **only the body value**
above the global check at `permissions.js:63`, and leave the archive-derived
resolution exactly where it is:

```javascript
    // A body-supplied squad context is validated regardless of the global bit:
    // the global permission means "may create", never "may create anywhere".
    //
    // Deliberately NOT the archiveId-derived squad. Both create_log routes
    // re-check with writeAccessWhere straight after this middleware, so that
    // path is already covered, and checking it here would refuse a caller who
    // holds an explicit write_access grant without workspace membership.
    const bodySquadId = req.body?.squad_id && isValidId(req.body.squad_id)
      ? Number(req.body.squad_id)
      : null;

    if (bodySquadId && !(await isSquadWorkspaceMember(req.user, bodySquadId))) {
      return res.status(403).json({
        success: false,
        message: `You do not have the '${permission}' permission`,
      });
    }

    if (req.permissions[permission]) return next();
```

The existing resolution block and squad-level fallback (`permissions.js:69-102`)
then run unchanged for the no-global-bit case. Reuse `bodySquadId` there rather
than recomputing it, but do not otherwise reorder that block.

The 403 body deliberately reuses the generic permission message rather than
naming the squad, so the route does not become a squad enumeration oracle.

Tests in `cloudcodex/tests/routes/archives.test.js`:

- Failing-first: `POST /api/archives` with a **foreign** `squad_id` from a caller
  holding global `create_archive` expects `403`, and asserts no
  `INSERT INTO archives` was reached.
- Companion: a `squad_id` in the caller's own workspace still returns `201`.
- `archives.test.js:93-108` posts no `squad_id` and **stays exactly as it is**:
  it exercises the no-squad-context path, which this change does not touch. Do
  not modify it.
- Add a regression test proving the point above: a caller with the global
  `create_log` bit creating a log via `POST /api/archives/:archiveId/logs` must
  still issue **no** extra middleware query and still reach `writeAccessWhere`.
  If `tests/routes/upload.test.js` or the `create_log` blocks in
  `archives.test.js` need a single mock added, this task has gone wrong; stop
  and re-read the two reasons above.

### Task 2.4 (c) The archive ACL grantee

In `cloudcodex/routes/archives.js`, after the `isArchiveOwner` check at
`archives.js:250` and before any write, resolve the archive's workspace and
require the grantee to be inside it.

Only on `action === 'add'`: a **remove** must always be allowed, or a grant made
before this fix becomes unrevokable, and cross-tenant grants already exist in
real data.

Note that the squad branch **cannot** reuse `isSquadWorkspaceMember`, which asks
whether a *user* is inside a squad's workspace. The question here is whether the
granted *squad* is in the archive's workspace, which is a direct comparison:

```javascript
  if (action === 'add' && (hasUser || hasSquad)) {
    const [owning] = await c2_query(
      `SELECT t.workspace_id FROM archives p
       JOIN squads t ON t.id = p.squad_id
       WHERE p.id = ? LIMIT 1`,
      [Number(id)]
    );

    // An archive with no squad has no workspace, so there is no boundary to
    // compare against and the grant is left to the owner's judgement.
    if (owning?.workspace_id) {
      let ok;
      if (hasUser) {
        ok = await isWorkspaceMember({ id: Number(userId), is_admin: false }, owning.workspace_id);
      } else {
        const [grantee] = await c2_query(
          `SELECT 1 FROM squads WHERE id = ? AND workspace_id = ? LIMIT 1`,
          [Number(squadId), owning.workspace_id]
        );
        ok = Boolean(grantee);
      }
      if (!ok) {
        return res.status(403).json({
          success: false,
          message: 'Cannot grant access to a user or squad outside this workspace',
        });
      }
    }
  }
```

Note the `is_admin: false` on the synthetic grantee object: `isWorkspaceMember`
short-circuits on `is_admin`, and we are asking about the **grantee's** tenancy,
not their privilege. Passing a real admin's row here would return true for the
wrong reason.

Tests: foreign user rejected, foreign squad rejected, same-workspace user
accepted, same-workspace squad accepted, foreign grantee **removal** still
accepted, squad-less archive still accepted.

### Task 2.5 (d) The users/search tenant predicate

Rewrite `cloudcodex/routes/auth.js:447-460`. Admins keep the global view; every
other caller sees only users who share a workspace with them.

```javascript
router.get('/users/search', requireAuth, asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.json({ success: true, users: [] });
  }

  const pattern = `%${q}%`;

  // The workspace is the tenant boundary, so it bounds who is discoverable.
  // Without this every account on the install, and its email address, is
  // enumerable by every other account across every workspace.
  if (req.user.is_admin) {
    const users = await c2_query(
      `SELECT id, name, email, avatar_url FROM users
       WHERE name LIKE ? OR email LIKE ?
       ORDER BY name ASC LIMIT 10`,
      [pattern, pattern]
    );
    return res.json({ success: true, users });
  }

  const users = await c2_query(
    `SELECT DISTINCT u.id, u.name, u.email, u.avatar_url
     FROM users u
     WHERE (u.name LIKE ? OR u.email LIKE ?)
       AND (
         u.id = ?
         OR EXISTS (
           SELECT 1
           FROM squad_members sm_them
           JOIN squads t_them ON t_them.id = sm_them.squad_id
           WHERE sm_them.user_id = u.id
             AND t_them.workspace_id IN (
               SELECT o.id FROM workspaces o WHERE o.owner_id = ?
               UNION
               SELECT t_me.workspace_id FROM squad_members sm_me
                 JOIN squads t_me ON t_me.id = sm_me.squad_id
                 WHERE sm_me.user_id = ? AND t_me.workspace_id IS NOT NULL
             )
         )
       )
     ORDER BY u.name ASC LIMIT 10`,
    [pattern, pattern, req.user.id, req.user.id, req.user.id]
  );

  res.json({ success: true, users });
}));
```

`u.id = ?` keeps the caller finding themselves, which the mention picker relies
on and which leaks nothing.

Tests in `cloudcodex/tests/routes/auth.test.js`: the failing-first test asserts
the non-admin query text contains a `workspace_id` bound and that the parameter
list carries the caller id. Add an admin test asserting the unscoped query is
still used.

**Known consequence, state it in the PR body:** a user who belongs to no squad
and owns no workspace can now find only themselves. That is correct behaviour,
and it is a visible change to the mention picker for such accounts.

### Task 2.6 Enumeration queries for rows that already exist

Closing the four holes stops new cross-tenant rows. It does not remove rows
already created through (a), (b) or (c), and each stays effective afterwards
because each is an ordinary row the fragments resolve correctly: an owner
`squad_members` row still satisfies `readAccessWhere` clause 5
(`ownership.js:31`), a planted archive still matches `created_by` clause 3
(`ownership.js:29`), and a cross-tenant grant still matches clause 2
(`ownership.js:29`, `ownership.js:55`).

Add a section to `docs/security.md` with three **read-only** queries an operator
can run against their own install:

1. Squads whose creator is outside the squad's workspace. **Write this predicate
   out explicitly rather than deriving it from `isWorkspaceMember`, or the query
   is a false green.** The (a) attack makes its own perpetrator a workspace
   member: `squads.js:105` calls `addSquadOwnerMember`, writing a
   `squad_members` row for the attacker against the squad they just planted, so
   a naive "creator is not a member of this workspace" test finds that row,
   through the very squad under examination, and filters the evidence out. Two
   planted squads in one workspace also cover for each other, so excluding the
   current row is not enough either. The predicate is: the creator is not
   `workspaces.owner_id` **and** has no `squad_members` row in that workspace
   once every squad in it created by that same user is excluded.
2. Archives whose creator is outside the owning squad's workspace.
3. `read_access` / `write_access` / `read_access_squads` / `write_access_squads`
   entries naming a user or squad outside the archive's workspace.

**Ship no cleanup migration and no delete.** No query can separate an attack row
from an install that used these routes exactly as they behaved, and deleting
squads, archives or grants automatically would destroy legitimate data. The
disposition is the operator's; the queries are the deliverable. Say this in the
PR body so it is not mistaken for an oversight.

### Task 2.7 Update the maps

`docs/maps/access-control.md` gains the tenant-boundary section: the new helper,
the four enforcement points, the orphaned-workspace rule, the note that the
7-param fragments were not touched, and the reason the archive-derived squad is
deliberately not validated in the middleware. Task 2.2 already added a paragraph
to section 3a; extend it rather than rewriting it. `docs/maps/open-questions.md` loses any entry
these fix and gains the `create_squad`/`create_archive` semantics note.

---

## PR 3: C2-2, token purpose and the logout no-op

### Task 3.1 The purpose column (migration and init.sql together)

`migrations/2026-09-08-token-purpose.sql`. **The date prefix is load-bearing,
not cosmetic.** C2-3's `--baseline` adopts the files it finds as already
applied, and this file is the first migration that is genuinely *not* applied on
existing installs. A legacy-style `add_*.sql` name would be indistinguishable
from the 13 that are, so an operator upgrading straight from a pre-C2-2 release
would baseline it away and then run new code against a table with no `purpose`
column: error 1054 on every mint, login 500s for every 2FA user, and
forgot-password back to 500-for-real / 200-for-fake, which is the exact
enumeration oracle this track keeps closing. C2-3 also hardcodes the 13-name
legacy manifest as a second guard (Task 4.2).

```sql
-- Typed purpose for password_reset_tokens.
--
-- Four flows mint into this table and four read out of it, and no reader
-- constrained which flow minted the row it found, so a token handed to the
-- caller by the 2FA login challenge was accepted by /api/reset-password.
--
-- Legacy rows cannot be classified after the fact, and every token in this
-- table is short-lived (10 minutes to 1 hour). They are deleted rather than
-- given a default, so the migration fails closed: in-flight resets and 2FA
-- challenges are invalidated and must be restarted.
ALTER TABLE password_reset_tokens
  ADD COLUMN purpose VARCHAR(32) NULL AFTER token;

DELETE FROM password_reset_tokens WHERE purpose IS NULL;

ALTER TABLE password_reset_tokens
  MODIFY COLUMN purpose VARCHAR(32) NOT NULL,
  ADD CONSTRAINT chk_password_reset_tokens_purpose
    CHECK (purpose IN ('password_reset','two_factor_login','totp_setup','two_factor_disable'));
```

**`VARCHAR` plus `CHECK`, deliberately not `ENUM`.** An earlier draft of this
plan specified `ENUM`, on the reasoning that `NOT NULL` with no `DEFAULT` makes
an omitted purpose fail loudly. **ENUM does not do that**, measured on
`mysql:8.4.8` with the shipped image's default `STRICT_TRANS_TABLES`: an insert
omitting a `NOT NULL` ENUM with no `DEFAULT` **succeeds** and stores the first
listed value. Here that value would be `password_reset`, so a flow that forgot
to name its purpose would silently mint a password reset token, which is the
exact defect this column exists to close. It would also mean old code against
the new schema mistypes every 2FA challenge token as a reset token instead of
erroring, reinstating the vulnerability rather than 500ing.

`VARCHAR(32) NOT NULL` with a `CHECK` measures 1364 on omission and 3819 on a
bad value, which is the behaviour that was wanted. Keep the constraint in the
migration and in `init.sql` **both**: a test that reads only `init.sql` stays
green when a value is dropped from the migration's `CHECK`, which is correct on
fresh installs and error 3819 in production only.

`init.sql`, inside `CREATE TABLE password_reset_tokens` (currently
`init.sql:100-109`), after the `token` column:

```sql
  purpose ENUM('password_reset','two_factor_login','totp_setup','two_factor_disable') NOT NULL,
```

No `DEFAULT`, deliberately: a fifth flow that forgets to name its purpose fails
at insert instead of silently minting a password reset token.

**This makes the migration order load-bearing, and it must be documented in the
migration header and in `docs/deployment.md`.** No compose file overrides
`sql_mode`, so MySQL 8's default `STRICT_TRANS_TABLES` applies, and the schema is
incompatible with the app in both directions:

- Old code, new schema: all four minters omit `purpose`, so every insert raises
  error 1364. During that window every 2FA user gets a 500 on `POST /api/login`
  and cannot self-serve out, because `POST /api/forgot-password` 500s on its own
  insert. Worse, forgot-password would then 500 for an address that exists and
  return 200 for one that does not, which is exactly the enumeration oracle the
  constant-time code at `auth.js:649-657` exists to prevent.
- New code, old schema: the same four inserts name a column that does not exist,
  error 1054.

`docs/deployment.md:192-201` currently documents migrate-then-restart, which is
the broken order. **Required order: stop every writer, apply, start the new
image.**

"Every writer", not "the app container", because `docker-compose.yaml` defines a
single service, `database` (lines 7-22). There is **no app container in dev**;
the app runs on the host under `npm run dev`. An instruction to stop the app
container is not executable there, and a developer following it literally leaves
the writer running and keeps the race below open.

The single-process architecture already makes a restart a brief total outage, so
a planned one costs nothing extra.

**Fix the apply command in this PR too, at `docs/deployment.md:208-212.`** It
currently reads `mysql> source /var/lib/mysql/migrations/<file>.sql;`, a path no
compose file mounts, so it cannot execute. PR 4 replaces it with
`npm run migrate`, but PR 4 merges *after* this one, and shipping the track's
most order-sensitive migration above a documented command that cannot run is how
an operator improvises the one step where improvising costs a half-applied
`MODIFY`. Give it a command that works today:

```
docker compose stop app     # prod; in dev, stop `npm run dev` instead
docker compose exec -T database mysql -u root -p"$MYSQL_ROOT_PASSWORD" c2 \
  < migrations/2026-09-08-token-purpose.sql
docker compose up -d app
```

Second, partial failure. Any row inserted between the `DELETE` and the `MODIFY`
makes the `MODIFY` fail with error 1138, and MySQL implicitly commits DDL, so the
table is left with a nullable `VARCHAR(32)` and no bookkeeping row to record it
(C2-3 merges after C2-2, so there is no `schema_migrations` table yet). Stopping
the app first also closes this, since nothing can insert while it is down. Say so
in the migration header.

### Task 3.2 The constant, the four minters, the four readers

Add to `cloudcodex/routes/helpers/shared.js` next to `DEFAULT_PERMISSIONS`:

```javascript
/**
 * What a `password_reset_tokens` row is for. Four flows share that table; a
 * reader that does not constrain the purpose will accept a token minted by a
 * different flow.
 */
export const TOKEN_PURPOSE = {
  PASSWORD_RESET: 'password_reset',
  TWO_FACTOR_LOGIN: 'two_factor_login',
  TOTP_SETUP: 'totp_setup',
  TWO_FACTOR_DISABLE: 'two_factor_disable',
};
```

Minters, each gaining the column and the bound value:

| Site | Purpose |
|---|---|
| `routes/auth.js:321-324` (login 2FA challenge) | `TWO_FACTOR_LOGIN` |
| `routes/auth.js:623-627` (forgot-password) | `PASSWORD_RESET` |
| `routes/auth.js:823-826` (TOTP enrolment) | `TOTP_SETUP` |
| `routes/auth.js:957-961` (2FA disable request) | `TWO_FACTOR_DISABLE` |

Readers, each gaining `AND purpose = ?`:

| Site | Purpose |
|---|---|
| `routes/auth.js:677-680` (reset-password) | `PASSWORD_RESET` |
| `routes/auth.js:712-715` (2fa/verify) | `TWO_FACTOR_LOGIN` |
| `routes/auth.js:883-886` (2fa/totp/confirm) | `TOTP_SETUP` |
| `routes/auth.js:996-999` (2fa/disable/confirm) | `TWO_FACTOR_DISABLE` |

The `UPDATE ... SET used = TRUE WHERE user_id = ? AND used = FALSE` at
`auth.js:617-620` (forgot-password invalidating prior tokens) must **also** gain
`AND purpose = 'password_reset'`, or requesting a password reset silently kills
an in-flight 2FA login. That is a real regression this change would otherwise
introduce.

Check `routes/admin.js:331` in the same pass: it deletes unused rows for a user
and is purpose-agnostic on purpose. Leave it, and note why in the map.

**Failing-first test**, in `cloudcodex/tests/routes/auth.test.js`:
"reset refuses a token minted by the 2FA challenge path". Drive it through the
mock by asserting the `SELECT` issued by `/api/reset-password` binds
`'password_reset'`, and that a mock returning no row (the purpose-filtered miss)
produces `400 Invalid or expired reset link`.

### Task 3.3 The logout no-op

`cloudcodex/middleware/auth.js`: extract the token-reading logic that
`requireAuth` performs inline at `auth.js:17-25` into an exported function, and
have `requireAuth` call it, so there is exactly one definition of "which token is
this request carrying".

```javascript
/**
 * The session token this request carries, from the Authorization header or the
 * sessionToken cookie. Returns null when the request carries neither.
 */
export function extractSessionToken(req) {
  const header = req.headers['authorization'];
  if (header) {
    const bearer = header.replace('Bearer ', '');
    if (bearer) return bearer;
  }

  const cookieHeader = req.headers['cookie'];
  if (cookieHeader) {
    const match = cookieHeader.split('; ').find(c => c.startsWith('sessionToken='));
    if (match) return match.split('=')[1];
  }

  return null;
}
```

`cloudcodex/routes/auth.js:370-381`:

```javascript
router.post('/logout', asyncHandler(async (req, res) => {
  // The client sends its session token as a bearer header, never in the body
  // (src/util.jsx apiFetch). Reading only req.body.token made every logout a
  // 400 that the caller swallowed, leaving the server-side session alive.
  const token = extractSessionToken(req) || req.body?.token || null;

  if (!token) {
    return res.status(400).json({ success: false, message: 'Token is required' });
  }

  await c2_query(`DELETE FROM sessions WHERE id = ?`, [token]);

  res.json({ success: true });
}));
```

The body fallback stays for any caller that still posts a token.

**Failing-first test:** `POST /api/logout` with `Authorization: Bearer valid-token`
and an empty body asserts a `DELETE FROM sessions` was issued with that token.
Add a `tests/middleware/auth.test.js` case per branch of
`extractSessionToken`, and keep the existing body-token test passing.

### Task 3.4 Update the maps and docs

`docs/maps/request-lifecycle.md` (logout now terminates the server-side
session), `docs/maps/data-model.md` (the `purpose` column and the fail-closed
migration), `docs/maps/access-control.md` if it describes the token pool.
`docs/security.md` gains the purpose-typing rule.

Keep the severity language exactly as the spec states it: password rewrite plus
session wipe, so lockout and an integrity defect. **Not** account takeover.

---

## PR 4: C2-3, the migration runner

### Task 4.1 The runner

`cloudcodex/scripts/migrate.js`, plain ESM, no new dependency. The pool in
`mysql_connect.js:18-26` does **not** set `multipleStatements`, so the runner
opens its own connection with it enabled rather than changing the shared pool,
which every route uses.

Structure, following the Cloud Command pattern (read for shape only, nothing
imported, that repository untouched):

1. `ensureBookkeeping()` creates
   `schema_migrations (filename VARCHAR(255) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_ms INT NOT NULL, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
   outside any transaction, so a fresh database and a half-migrated one take the
   identical path.
2. Read every `.sql` in `migrations/`, sorted lexicographically.
3. **Drift guard over the whole set before applying anything.** An applied file
   whose sha256 no longer matches is a hard stop with a message saying applied
   migrations are immutable and to fix forward.
4. Apply each pending file, recording filename, checksum and elapsed ms.

**The MySQL adaptation, stated in the file's own comment:** MySQL implicitly
commits DDL, so a failed migration cannot be rolled back the way it can on
Postgres. The runner opens a transaction per file for the statements that honour
it, and on failure reports which file failed and that the database may be
partially migrated, rather than promising a rollback it cannot deliver. Do not
copy the Postgres comment claiming otherwise.

### Task 4.2 Baseline adoption

The 13 existing files are already applied on every existing install, and their
DDL is also in `init.sql`, so a first run must not try to apply them. Three
cases, decided:

- `users` missing: **refuse.** "Run `init.sql` first." The 13 existing files are
  deltas against `init.sql`, not a schema of their own:
  `drop_squad_permissions.sql` presumes a table only `init.sql` creates, and
  lexicographic order puts it ahead of most `add_*.sql` files, so applying all 13
  to an empty database fails on the first `ALTER`. **The runner never bootstraps
  a schema.**
- `users` present, `schema_migrations` missing: an existing install.
  **Refuse**, and print the exact command to adopt the current files as an
  applied baseline (`npm run migrate -- --baseline`). Failing closed matters
  here: there is no applied-migrations table today, so the runner cannot tell a
  fully-migrated database from a partly-migrated one, and guessing would either
  re-run DDL or silently skip a migration the install never got.
- `schema_migrations` present: normal pending-apply with the drift guard.

`--baseline` **records only the 13 known legacy filenames**, hardcoded as a
manifest constant in the runner, and applies none. It must NOT adopt "whatever
is in the directory".

That distinction is the whole safety property. The baseline set is a historical
fact about what shipped before bookkeeping existed, not a property of the
current checkout. If `--baseline` swept the directory, an operator upgrading
from a pre-C2-2 release would mark C2-2's migration applied without running it,
and the runner would report success while the app 1054s on every token mint.
Any file not in the manifest is **pending**, regardless of `--baseline`.

**No existing migration file is renamed.** All 13 are adopted as an applied
baseline, and relative order among already-applied files never matters. New
migrations from here take a date prefix (`2026-09-08-<topic>.sql`); digits sort
ahead of letters, harmless for the same reason, and dated files sort correctly
among themselves.

### Task 4.3 Wire it up and fix the documented command

`cloudcodex/package.json`: `"migrate": "node scripts/migrate.js"`.

`docs/deployment.md:208-212` currently documents
`source /var/lib/mysql/migrations/<file>.sql`, a path **no compose file mounts**
(`docker-compose.yaml:21-22`, `docker-compose-prod.yml:16-17`,
`docker-compose.linux.yml:7-8` mount only the data directory and `init.sql`).
Replace it with `npm run migrate` from `cloudcodex/`, and document the baseline
step for existing installs. Fix `docs/deployment.md:181-183`, which says there
is no runner.

### Task 4.4 Tests

`cloudcodex/tests/scripts/migrate.test.js`, against a mocked query executor:
pending files applied in order, a no-op second run, drift on an edited applied
file is a hard stop **before** any apply, the three baseline cases, and a failed
file stopping the run rather than continuing.

Refactor the runner so its core takes an injected executor and directory, which
is what makes all of that testable without a live MySQL.

### Task 4.5 Coverage thresholds

`vitest.config.js` carries **28** per-glob thresholds and CI enforces them.
(`CLAUDE.md` and `docs/maps/build-test-and-ops.md` both say 26; that is a
pre-existing miscount, and this PR corrects it in the map it touches.)

More important: `coverage.include` does **not** list `scripts/**`, so a new
`cloudcodex/scripts/migrate.js` would be invisible to coverage rather than
under-covered. Add `'scripts/**/*.js'` to `include` **and** give `'scripts/**'`
its own thresholds entry, set just under what you actually achieve.

### Task 4.6 Update the maps

`docs/maps/build-test-and-ops.md` (the runner, the npm script, the baseline
step) and `docs/maps/data-model.md` (`schema_migrations`, and that the
dual-tracking rule with `init.sql` still stands).

---

## PR 5: C2-4, the scoped service token

Merged last, on top of a corrected access-control layer. When it merges, say so
explicitly: it unblocks Cloud Command's S5.1b, the document picker, the last
item on that product's v1 critical path.

### Task 5.1 The seam

`cloudcodex/services/machine-auth.js`, one exported function, which is the whole
point of the item:

```javascript
/**
 * Validate a machine credential and return the principal it acts as.
 *
 * The single seam for machine authentication. A later OIDC client-credentials
 * grant replaces the body of this function; no call site changes.
 *
 * Returns null when machine auth is not configured, the token does not match,
 * or the configured principal does not resolve.
 */
export async function verifyMachineCredential(token) { ... }
```

Configuration, both required for the feature to be on, so an install that sets
nothing gains no new authentication path:

- `SERVICE_TOKEN`: the shared secret. Compared with
  `crypto.timingSafeEqual` over equal-length buffers, never `===`.
- `SERVICE_TOKEN_USER`: the email of an existing, **non-admin** user whose
  access the token acts with.

Binding the token to a real user is what keeps the blast radius small without
writing any new access-control SQL: the entire existing layer applies unchanged.

The principal is built with `is_admin: false` **forced**, not copied from the
row, and `verifyMachineCredential` refuses outright if the configured user is an
admin, logging a `console.error` and returning null. `is_admin` is the first
bound parameter of every fragment in `ownership.js`, so this is the one thing
that must not be got wrong, and it is guarded twice.

Both refusals require a minimum `SERVICE_TOKEN` length (32 characters), because
a short shared secret behind a rate limiter is still a short shared secret.

### Task 5.2 The middleware and the two routes

A middleware that tries the machine credential and otherwise falls through to
`requireAuth` unchanged:

```javascript
export function machineOrAuth(req, res, next) {
  const token = extractSessionToken(req);
  if (!token) return requireAuth(req, res, next);

  verifyMachineCredential(token)
    .then(principal => {
      if (!principal) return requireAuth(req, res, next);
      req.user = principal;
      next();
    })
    .catch(next);
}
```

Apply to exactly two routes in `cloudcodex/routes/search.js`:
`GET /api/search` (`search.js:100`) and `GET /api/browse` (`search.js:217`).

**Nothing else.** `GET /api/search/filters` (`search.js:282`) and
`GET /api/presence` (`search.js:329`) keep bare `requireAuth`, and one of them
is the negative test.

### Task 5.3 Tests and config

`cloudcodex/tests/services/machine-auth.test.js`: off when unconfigured, wrong
token rejected, an admin-configured principal refused, a valid token producing a
principal whose `is_admin` is `false`, and a short `SERVICE_TOKEN` refused.

`cloudcodex/tests/routes/search.test.js`: the token is accepted on `/api/search`
and `/api/browse`, and **rejected with 401 on `/api/search/filters`**, which is
the test that proves the scope is a scope.

`.env.example` gains both variables with comments, per the shippability
checklist.

### Task 5.4 Update the maps and docs

`docs/maps/access-control.md` (machine principals, the seam, the never-admin
rule), `docs/maps/request-lifecycle.md` (the new middleware in the stack),
`docs/security.md`, and the relevant `docs/api/*.md` for the two routes.

---

## Retirement

The last PR in the track deletes this plan and
[`../specs/2026-09-08-security-and-infrastructure.md`](../specs/2026-09-08-security-and-infrastructure.md),
per the `docs/plans/` and `docs/specs/` conventions. The maps become the record.

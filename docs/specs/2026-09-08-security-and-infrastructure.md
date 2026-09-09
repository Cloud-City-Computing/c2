# Security and infrastructure track

Agreed 2026-09-08. All `file:line` claims below were re-verified against
`fc23103`.

## Why this spec exists

Five items were found by a suite review on 2026-08-24 and re-verified on
2026-09-03. Until now they were recorded only outside this repository, in a
sibling product's session log. That is the defect this document fixes first:
c2 carried no written record of live security defects in its own tree.

[`roadmap.md`](roadmap.md) decomposes the project into five tracks (A through E)
all aimed at adoption. None of them is security. This spec adds that track.

The justification is not a consumer request. Cloud City proposes to operate this
software for money, and C2-1 through C2-3 are live defects in a multi-tenant
product. They are owed on that basis alone. Only C2-4 exists because another
product is waiting on it.

## Ordering constraint

The order below is hard.

1. **C2-0 merges before anything else in this track.** It is the gate.
2. **C2-1 is the highest severity**, so it goes first among the code changes.
3. **C2-2 must not merge into an ungated `main`.** It rewrites the credential
   reset path, which is the single most security-sensitive surface here.
4. C2-3 and C2-4 follow. C2-4 is last because it is the only item that is not a
   defect fix, and it should be built on top of an access-control layer that has
   already been corrected.

One pull request per item. Every fix lands failing-test-first.

---

## C2-0. Close the merge gate

### Current behaviour

`main` requires one approving review:

```
required_pull_request_reviews.required_approving_review_count = 1
```

but the protection object has **no `required_status_checks` key at all**. A pull
request with a red CI run is mergeable today, as long as somebody approves it.

Separately, `.github/workflows/ci.yml` runs `npm ci`, `npm run lint`, `npm test`
and `npm run test:coverage`. It never runs `npm run build`. A change that breaks
the production Vite build (a bad import, a dependency missing from
`vite.config.js`'s `manualChunks`) passes CI and reaches `main`.

### In scope

- Add a `npm run build` step to `.github/workflows/ci.yml`.
- Kyle sets the required status checks on `main` by hand, in the GitHub UI or
  via `gh api`. This half cannot be done from a pull request: branch protection
  is repository configuration, not repository content.

### Done means

- CI runs lint, test, coverage and build.
- `gh api repos/Cloud-City-Computing/c2/branches/main/protection/required_status_checks`
  returns the check context. Today it returns **404 `Required status checks not
  enabled`**, measured, not `null`: the key is absent from the protection object
  altogether. That is why the fix is a full `PUT` on `/protection`, reproducing
  every field the object already carries, and **not** a `PATCH` on that
  sub-resource, which cannot enable what does not exist.

### Explicitly deferred

`enforce_admins` and `required_linear_history` stay off. This track is about
making a red run block a merge, not about restricting how the repository owner
works on a solo project.

`strict: true` (a branch must be up to date with `main` before it merges) is
**decided in rather than deferred**, and it is a real behaviour change worth
naming rather than smuggling. Each of the four remaining PRs will need an
"Update branch" and a fresh CI run once the one before it lands. That friction
is the point: this track ships four PRs that touch the same files, and a PR
proved green against a stale `main` is exactly what a merge gate is for.

---

## C2-1. Four cross-tenant escalations

The workspace is the tenant boundary in this product. All four items below are
places where that boundary is not enforced.

### (a) Any account can enrol itself as squad owner in another workspace

`createDefaultPermissions` grants every new user `create_squad TRUE`
(`cloudcodex/routes/helpers/shared.js:175`). It runs on the invite signup path
(`cloudcodex/routes/auth.js:146`), the SSO path
(`cloudcodex/routes/oauth.js:273`) and the admin-created-user path
(`cloudcodex/routes/admin.js:66`). So every account on the install holds the
global bit.

`POST /api/workspaces/:workspaceId/squads`
(`cloudcodex/routes/squads.js:62-128`) then checks only that the workspace row
exists (`squads.js:76-83`) and that the caller holds `create_squad`
(`squads.js:86-95`). It never asks whether the caller belongs to that workspace.
On success it enrols the caller as a squad **owner**
(`squads.js:105`, `addSquadOwnerMember`).

Squad ownership is a live term in `readAccessWhere`/`writeAccessWhere`, so this
is not a cosmetic row: the attacker gains a foothold with owner rights inside a
workspace they have no relationship to.

### (b) `requirePermission` short-circuits before squad-context resolution

`cloudcodex/middleware/permissions.js:63-65` returns `next()` as soon as the
caller's **global** permission bit is set. The squad-context branch that would
validate the caller against the squad (`permissions.js:80-102`) is only reached
when the global bit is **false**.

The consequence is at `POST /api/archives`
(`cloudcodex/routes/archives.js:117-144`), which is gated by
`requirePermission('create_archive')` and accepts `squad_id` from the body. The
handler validates that `squad_id` is a well-formed id (`archives.js:125-127`)
and then inserts with it (`archives.js:129-133`). Nothing checks that the caller
may place an archive into that squad. Since `create_archive` is also `TRUE` for
every account, any user can plant an archive inside any squad in any workspace.
The planted archive is `created_by` the attacker, so the attacker is an
`isArchiveOwner` (`cloudcodex/routes/helpers/ownership.js:83`) inside the
victim's squad, and `logActivity` is called with the victim's `squadId`
(`archives.js:135-142`), which writes into the victim tenant's activity feed and
notifies its watchers.

**Scope note, so the fix is not over-claimed.** The other two
`requirePermission` sites are *not* exploitable this way.
`POST /api/archives/:archiveId/logs` (`archives.js:427`) and
`POST /api/archives/:archiveId/logs/upload` (`cloudcodex/routes/upload.js:95`)
both perform their own `writeAccessWhere` check afterwards
(`archives.js:443-453`, `upload.js:107-119`), which catches the foreign archive.
`POST /api/archives` is the one route where the middleware is the only gate.

### (c) The archive ACL-grant route never compares the grantee's workspace

`POST /api/archives/:id/access` (`cloudcodex/routes/archives.js:220-296`)
authorises the **caller** with `isArchiveOwner` (`archives.js:250`) and then
writes the supplied `userId` or `squadId` straight into the archive's ACL JSON
(`archives.js:259-296`). The grantee is validated as a well-formed id
(`archives.js:243-248`) and nothing else. Neither the granted user nor the
granted squad is checked for membership of the archive's workspace, so an
archive owner can hand read or write on their tenant's content to an arbitrary
account, or to an entire squad, in a different tenant.

### (d) `GET /api/users/search` has no tenant predicate

`cloudcodex/routes/auth.js:447-460` matches `name LIKE ? OR email LIKE ?` across
the whole `users` table for any authenticated caller, and returns `id`, `name`,
`email` and `avatar_url` (`auth.js:454-457`). Every user on the install is
enumerable, with their email address, by every other user, across every
workspace. Two characters is the minimum query length (`auth.js:449`), and
`searchLimiter` (`cloudcodex/app.js:158`) caps this at 60 requests per 15
minutes, which slows enumeration without bounding it.

### The test trap

One of the four is currently encoded as a **passing test, twice**:

- `cloudcodex/tests/routes/squads.test.js:102-126` asserts `201` when the caller
  holds only `create_squad` and the workspace is owned by user `42`.
- `cloudcodex/tests/routes/squads.test.js:128-145` asserts the same for an
  **orphaned** workspace (`owner_id: null`, the owner account deleted).

Both must be inverted, not deleted, and they start from **different premises**:
the first is a foreign workspace, while the second has no owner to compare
against and needs its own decided answer rather than a copy of the first.

Both land on **`404`, byte for byte the existing not-found body.** A
distinguishable `403` would answer "this workspace exists but is not yours" for
every id a caller cared to probe, turning the route into a workspace enumeration
oracle. What differs between the two is the reasoning and the coverage each has
to preserve, not the status code.

`cloudcodex/tests/routes/archives.test.js:93-108` is **not** coverage of (b). It
posts no `squad_id`, so it never enters the vulnerable path and passes either
way. Items (b), (c) and (d) have no test coverage at all today.

### In scope

- A single reusable workspace-membership predicate, placed with its peers in
  `cloudcodex/routes/helpers/ownership.js`. Four ad-hoc checks would be a
  regression against the rule that access logic lives in one file.
- Enforce it at all four sites.
- Decide and document the orphaned-workspace answer.

### Done means

Each of (a) through (d) has a test that fails on `fc23103` and passes after, and
the two `squads.test.js` tests assert the corrected behaviour.

### The fix is prospective, and that has to be said out loud

Closing all four holes stops new cross-tenant rows. It does **not** remove rows
already created through (a), (b) or (c), and every one of them stays effective
afterwards, because they are ordinary rows that the access fragments resolve
correctly:

- (a) a squad created in a foreign workspace leaves the attacker a
  `squad_members` row with `role = 'owner'`, which still satisfies
  `readAccessWhere` clause 5 (`ownership.js:31`).
- (b) an archive planted in a foreign squad leaves the attacker as `created_by`,
  clause 3 (`ownership.js:29`), and still an `isArchiveOwner`
  (`ownership.js:83`).
- (c) a cross-tenant ACL grant still matches clause 2 (`ownership.js:29`,
  `ownership.js:55`).

So this track **ships three read-only enumeration queries** in `docs/security.md`
so an operator can find such rows on their own install, and deliberately does
**not** ship a cleanup migration. Deleting squads, archives or grants
automatically would destroy legitimate data on any install that used these routes
as designed, and no query can tell the two apart. The disposition is the
operator's.

### Explicitly deferred

Revoking `create_squad`/`create_archive` from existing accounts. The defect is
that the bits are treated as "may create anywhere" rather than "may create". Fix
the meaning; do not silently change every install's data.

Automatic remediation of pre-existing cross-tenant rows, for the reason above.
The enumeration queries are the deliverable; the deletion is not.

---

## C2-2. Token purpose confusion, and the logout no-op

### Current behaviour

`password_reset_tokens` (`init.sql:100-109`) is a single opaque token pool with
no notion of what a token is for. Four separate flows mint into it and four
separate readers select out of it, and **no reader constrains which flow minted
the row it found**:

| Flow | Mints | Reads |
|---|---|---|
| Password reset | `auth.js:623-627` | `auth.js:677-680` |
| 2FA login challenge | `auth.js:321-324` | `auth.js:712-715` |
| TOTP enrolment | `auth.js:823-826` | `auth.js:883-886` |
| 2FA disable confirmation | `auth.js:957-961` | `auth.js:996-999` |

The sharpest pairing is the first two. `POST /api/login` mints a
`password_reset_tokens` row for the 2FA challenge (`auth.js:321-324`) and
**returns it to the caller in the response body** (`auth.js:357`). `POST
/api/reset-password` then reads that same table by token with no purpose filter
(`auth.js:677-680`), so a token handed out by the login endpoint is accepted as
a password reset token.

### Severity, stated accurately

**This is not account takeover.** An earlier draft of this item said it was, and
that is wrong.

`POST /api/reset-password` rewrites `password_hash` (`auth.js:688`), marks the
token used (`auth.js:689`) and deletes every session for the user
(`auth.js:692`). It does **not** clear `two_factor_method`, and it does **not**
issue a session. The attacker must already hold the victim's password to reach
the 2FA challenge and obtain the token at all.

So the real impact is a **persistent password rewrite plus a full session wipe
of the victim**: a lockout and an integrity defect, not entry. It is worth
fixing because a credential-store write reachable from the wrong flow is a
defect regardless of what today's follow-on code happens to do, and because the
next change to that file should not have to re-derive this reasoning. No plan,
commit message, PR body or map entry produced by this track may restate it as
takeover.

Two of the other three readers are lower still, because they additionally
require `tokenRecord.user_id === req.user.id` behind `requireAuth`
(`auth.js:888`, `auth.js:1001`), so a cross-user swap does not survive them.

**The third is not, and an earlier draft of this spec said it was.**
`POST /api/2fa/verify` (`auth.js:752`) carries no `requireAuth` and never
references `req.user` at all, so it has no identity binding to fall back on. Its
real guard is the second factor itself: after reading the token it still has to
match a TOTP code against the user's secret, or an unused row in
`two_factor_codes`. That is a genuine guard, but it is a different one, and the
distinction matters because it is the reason this reader most needs the purpose
column rather than least.

All four are in scope because the fix is one column, and leaving any reader
unconstrained preserves the trap for whoever adds the fifth flow.

### The logout no-op

`performLogout` in `cloudcodex/src/components/AccountPanel.jsx:12` posts an
empty body: `apiFetch('POST', '/api/logout', {})`. `apiFetch`
(`cloudcodex/src/util.jsx:28-52`) sends the session token as an
`Authorization: Bearer` header (`util.jsx:31`), never in the body.

`POST /api/logout` (`cloudcodex/routes/auth.js:369-379`) reads `req.body.token`
and returns `400` when it is absent (`auth.js:372-374`). The `catch` in
`performLogout` (`AccountPanel.jsx:13-14`) swallows the error, the client clears
its own cookie and redirects, and **zero session rows are deleted**. Every
logout leaves a live server-side session behind, valid until it expires.

### The deploy ordering is part of the fix, not an afterthought

`purpose` is `NOT NULL` with **no** `DEFAULT`, deliberately, so a fifth flow that
forgets to name its purpose fails at insert instead of silently minting a
password reset token. That makes the schema incompatible with the app in both
directions, and no compose file overrides `sql_mode`, so MySQL 8's default
`STRICT_TRANS_TABLES` applies:

- **Old code, new schema:** all four minters omit `purpose`, so every insert
  raises error 1364. Concretely, during that window every user with 2FA enabled
  gets a 500 on `POST /api/login`, and cannot self-serve out of it because
  `POST /api/forgot-password` 500s on its insert too. Worse, forgot-password
  would then 500 for an address that exists and return 200 for one that does
  not, which is exactly the enumeration oracle the constant-time code at
  `auth.js:649-657` exists to prevent.
- **New code, old schema:** the same four inserts name a column that does not
  exist, error 1054.

`docs/deployment.md:192-201` currently documents the migrate-then-restart order,
which is the broken one. **This migration requires stopping every writer,
applying, then starting the new image.** Every writer, not "the app container":
`docker-compose.yaml` defines only a `database` service, so in dev the writer is
`npm run dev` on the host and there is no app container to stop.

The single-process architecture already means a restart is a brief total outage,
so a planned one costs nothing extra. That order is stated in the migration
header and in `docs/deployment.md`, and it is a hard requirement of C2-2, not a
recommendation.

**There is no rollback.** The migration is not reversible and C2-3 defers
down-migrations, so reverting `CLOUDCODEX_VERSION` after applying lands the
operator in old-code-against-new-schema, which is the 1364 case above. Getting
back means dropping the column by hand. The migration header says so.

The migration is named `2026-09-08-token-purpose.sql`, with the date prefix, and
that is load-bearing rather than cosmetic: it is the first migration that is
genuinely not applied on existing installs, and C2-3's `--baseline` must never
be able to sweep it up as though it were one of the 13 legacy files.

### In scope

- A typed `purpose` column on `password_reset_tokens`, set by all four minters
  and constrained by all four readers, plus the deploy ordering above.
- Migration plus the matching `init.sql` edit, per the repository rule that the
  two stay in sync.
- Fix logout to identify the session the way `requireAuth` does
  (`cloudcodex/middleware/auth.js:17-25`), so a logout actually deletes a row.

### Done means

The failing-first test is **"reset refuses a token minted by the 2FA challenge
path"**. Plus: a logout test asserting a `DELETE FROM sessions` for the bearer
token, and a purpose test for each of the other three readers.

### Explicitly deferred

Splitting the four flows into separate tables. One typed column fixes the
confusion; four tables is a schema change with no additional safety.

---

## C2-3. A migration runner

### Current behaviour

`migrations/` holds 13 `.sql` files. There is no runner, no applied-migrations
table and no checksum guard. Schema changes are dual-tracked by hand into
`init.sql`, which itself only runs on a fresh MySQL volume, because Docker skips
`docker-entrypoint-initdb.d` on an initialised data directory.

`docs/deployment.md:181-183` is honest that this is manual. But the command it
documents at `docs/deployment.md:208-212`:

```
mysql> source /var/lib/mysql/migrations/<file>.sql;
```

sources a path that **no compose file mounts**. All three compose files mount
only the data directory and `init.sql`
(`docker-compose.yaml:21-22`, `docker-compose-prod.yml:16-17`,
`docker-compose.linux.yml:7-8`). The documented upgrade path cannot work as
written.

### In scope

A small, dependency-free runner following the pattern proven in Cloud Command's
`scripts/db/migrate.ts`: plain `.sql` files applied in lexicographic order, a
`schema_migrations` bookkeeping table, a sha256 drift guard that runs over the
whole set **before** anything is applied, and one transaction per file. That
repository is read for the pattern only. No code is imported from it and nothing
in it is edited.

Two adaptations are forced by MySQL and by this repo's history, and are called
out here so they are not mistaken for sloppy copying:

- MySQL implicitly commits DDL, so "one transaction per file" cannot mean what
  it means on Postgres. The runner records per-file success and refuses to
  continue past a failure, and reports that the database **may be partially
  migrated**, rather than promising a rollback it cannot deliver.
- **The 13 existing files are deltas against `init.sql`, not a schema of their
  own.** `drop_squad_permissions.sql` presumes a table only `init.sql` creates,
  and lexicographic order puts it ahead of most `add_*.sql` files anyway, so
  applying all 13 to an empty database fails on the first `ALTER`. The runner
  therefore never bootstraps a schema: it refuses when the `users` table is
  absent and says to run `init.sql` first.

**No existing migration file is renamed.** All 13 are adopted as an applied
baseline, and relative order among already-applied files never matters. New
migrations from here take a date prefix (`2026-09-08-<topic>.sql`); digits sort
ahead of letters, which is harmless for the same reason, and dated files sort
correctly among themselves.

### Done means

`npm run migrate` applies pending files, is a no-op on a current database, hard
stops on an edited applied file, and `docs/deployment.md` documents a command
that works against the shipped compose files.

### Explicitly deferred

Down-migrations and a rollback command. Fix-forward matches how this schema has
been changed for its whole history.

---

## C2-4. One scoped service token

This is the only item here that another product is waiting on. When it merges it
unblocks Cloud Command's S5.1b, the document picker, which is the last item on
that product's v1 critical path.

### In scope

A config-gated machine credential that can read `GET /api/browse` and
`GET /api/search`, and nothing else.

### Hard constraints

- **The credential is never `is_admin`.** `is_admin` is the first bound
  parameter of every access fragment in
  `cloudcodex/routes/helpers/ownership.js`, so setting it hands the bearer the
  entire install. This is the single thing that must not be got wrong.
- All validation goes behind **one** `verifyMachineCredential()` function, so a
  later OIDC client-credentials grant replaces the implementation and not the
  call sites.
- Off unless configured. An install that sets nothing gains no new
  authentication path.

### Done means

Two routes accept the credential, a third representative route rejects it, and a
test asserts the principal it produces is not `is_admin`.

### Explicitly deferred

OIDC itself, token rotation and per-token scopes beyond the fixed read pair.
The seam is what is being cut now; the v2 implementation goes behind it.

---

## Retirement

Per the `docs/specs/` convention, when this track ships: update the affected
maps, then delete this spec and its plan. `access-control.md`,
`request-lifecycle.md`, `data-model.md`, `build-test-and-ops.md` and
`open-questions.md` all take edits from this work.

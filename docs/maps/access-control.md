# Access Control Map

**Read this before touching any permission code.** Cloud Codex does not have one
access-control system. It has one *primary* system plus four smaller ones that
guard different verbs, and they do not agree with each other in every case.

---

## 1. The primary system: SQL fragments in `ownership.js`

`routes/helpers/ownership.js` exports four functions that compose into a query.
The pattern everywhere is:

```js
`... WHERE p.id = ? AND ${readAccessWhere('p')} LIMIT 1`,
[id, ...readAccessParams(user)]
```

`readAccessWhere(alias)` (`ownership.js:26-40`) emits a parenthesised OR of
**seven** clauses. Written out, access is granted when **any** of these holds:

| # | Clause | Reads |
|---|---|---|
| 1 | `? = TRUE` | `user.is_admin`, passed as a bound param |
| 2 | `JSON_CONTAINS(p.read_access, ?)` | the archive's per-user grant array |
| 3 | `p.created_by = ?` | archive creator |
| 4 | squad joined to workspace, `workspaces.owner_id = ?` | workspace owner, matched on the `users` FK |
| 5 | `squad_members.role = 'owner' OR can_read = TRUE` | squad membership |
| 6 | `JSON_CONTAINS(p.read_access_squads, CAST(sm.squad_id AS JSON))` | per-squad grant array |
| 7 | `p.read_access_workspace = TRUE` and the user is in *any* squad of the same workspace | workspace-wide flag |

`writeAccessWhere` (`ownership.js:52-66`) is structurally identical against
`write_access`, `can_write`, `write_access_squads`, `write_access_workspace`.
Clauses 1, 3 and 4 are shared verbatim, so **the archive creator and the
workspace owner always have write access**, and there is no way to demote them
short of changing `created_by`.

**Clause 1 is an unconditional admin bypass.** Any query that interpolates
`readAccessWhere`/`writeAccessWhere` without narrowing the `WHERE` further
matches *every* archive platform-wide for an admin, including ones an admin
should not casually stumble into.

### `system` archives, and the `excludeSystemArchives()` rule

A `system` archive is one the app creates for its own bookkeeping: today, the
hidden per-PR archives hosting GitHub PR-session documents. Since 2026-08-09
**ordinary users hold real grants on these**, because that is how PR-as-document
works at all (B1 in [open-questions.md](open-questions.md)). That makes the
distinction load-bearing rather than an admin-only curiosity:

> **Archive-as-a-place versus archive-as-an-ACL.** Any query that treats an
> archive as *somewhere a user browses, lists, manages or deletes within* must
> add `AND ${excludeSystemArchives('p')}` alongside the fragment. Any query
> resolving *whether this user may touch this document* must not.

`excludeSystemArchives(alias)` in `ownership.js` is that predicate. It takes no
parameter, so it does not disturb the seven-param contract below, and it spells
the test `NOT COALESCE(alias.\`system\`, FALSE)` because the column is
nullable and `NULL = FALSE` is NULL, which would hide the row from everyone.

Applied in:

| File | Surfaces |
|---|---|
| `routes/archives.js` | listing, log listing, rename, ACL read and write, log create/update/delete, repos |
| `routes/search.js` | search, browse, filters |
| `routes/upload.js` | `POST /archives/:archiveId/logs/upload` |
| `routes/github.js` | `POST /github/import-to-codex` |

**Those last two are the trap.** There are three ways to create a log inside an
archive, and they live in three different routers; excluding only the obvious
one in `archives.js` left the other two writing into a hidden archive that
nothing could then list or clean up. Any new archive-scoped route belongs in
this table.

Deliberately **not** applied in `checkLogReadAccess`/`checkLogWriteAccess`,
`/api/presence`, `/api/document`, `routes/favorites.js` or `routes/activity.js`:
those are document-level or per-user opt-in, and are exactly what the PR
feature rides on.

Getting this wrong is not cosmetic. Reviewed on 2026-08-09: because the grant
carries write, an unscoped `DELETE /api/archives/:id/logs/:logId` let anyone who
had opened a PR session delete that PR's shared document and, by cascade, every
mirrored review comment on it. `GET /api/archives/:id/access` likewise let them
enumerate the name and email of everyone else who had opened it.
`routes/first-run.js` had the rule right before there was a rule.

### The param contract

```js
readAccessParams(user)  // ownership.js:42-44
writeAccessParams(user) // ownership.js:68-70
// both: [Boolean(user.is_admin), JSON.stringify(user.id), user.id, user.id, user.id, user.id, user.id]
```

**Always exactly 7 params, in that order.** The fragment is string-interpolated
into the SQL, the params are bound positionally, and there is no runtime check
that the two agree. Adding a clause to `readAccessWhere` without adding the
matching param to `readAccessParams` shifts every subsequent `?` in the whole
query and silently produces wrong results rather than an error. If you change
one, change all four, and update `tests/helpers/ownership.test.js`.

Two details of the params worth internalising:

- **Param 2 is `JSON.stringify(user.id)`**, i.e. the string `"7"` for user 7,
  because `JSON_CONTAINS` needs a JSON document, not an integer. Elsewhere in
  the codebase the same arrays get appended as `CAST(? AS JSON)` with a
  `String(user.id)` argument (`routes/github.js:1715-1726`, the PR-session
  grant). Both produce the JSON number `7`, so they interoperate, but the two
  spellings are easy to confuse.
- **Every param is now the user's id** except param 2's JSON spelling. Param 4
  used to be `user.email`, because `workspaces.owner` was a `TEXT` column
  holding an email address rather than a foreign key, so changing a user's
  email silently destroyed their workspace ownership and a later account
  registering that address inherited it. `workspaces.owner_id` is an INT
  referencing `users(id) ON DELETE SET NULL` as of
  `migrations/add_workspace_owner_id.sql`. The param count is unchanged at 7.

### Callers

Never write permission SQL by hand. The wrappers already exist in
`routes/helpers/shared.js`:

| Function | Line | Returns |
|---|---|---|
| `checkLogReadAccess(logId, user)` | `shared.js:56-67` | the log row, or `undefined` |
| `checkLogWriteAccess(logId, user)` | `shared.js:73-84` | the log row, or `undefined` |
| `checkArchiveReadAccess(archiveId, user)` | `shared.js:154-163` | the archive row, or `undefined` |
| `checkArchiveWriteAccess(archiveId, user)` | `shared.js:139-148` | the archive row, or `undefined` |

Routes that need the fragment inline (search, browse, export, GitHub link
loading) interpolate it directly; see `routes/documents.js:553`,
`routes/search.js`, `routes/github.js:1023`.

## 2. The critical subtlety: everything resolves against the ARCHIVE

`checkLogReadAccess` (`shared.js:56-67`) joins `logs` to `archives` and applies
`readAccessWhere('p')` where **`p` is the `archives` table**. The log's own
columns are never consulted.

`logs.read_access` and `logs.write_access` exist in the schema
(`init.sql:244-245`). Grepping the whole backend for reads of them turns up
nothing. Since 2026-08-09 the only thing that writes them is the PR-session
log insert (`routes/github.js:1698`), which sets both to an empty
`JSON_ARRAY()`.

**They are write-only columns**, and the decision on 2026-08-09 was to keep
them that way. Any future feature that "grants access on a document" by writing
`logs.read_access` will appear to work, persist correctly, and grant nothing.
The PR-session feature used to do exactly that and was admin-only for it; it
now grants on a per-PR archive instead. See
[github-integration.md](github-integration.md) and B1 in
[open-questions.md](open-questions.md).

The practical rule: **the archive is the ACL boundary.** Per-document
permissions do not exist.

## 3. The four secondary systems

### 3a. Global feature permissions: `requirePermission(flag)`

`middleware/permissions.js:40-111`. Guards *creation* verbs, not access to
existing rows. Three flags: `create_squad`, `create_archive`, `create_log`.

Resolution order:

1. `req.user.is_admin`, allow (`permissions.js:47`).
2. Load `req.permissions` from the `permissions` table if not already loaded,
   falling back to `DEFAULT_PERMISSIONS` (`permissions.js:50-60`).
3. Global flag set, allow (`permissions.js:63-65`).
4. Otherwise derive a squad from `req.body.squad_id`, or from
   `req.params.archiveId` via the archive's `squad_id` (`permissions.js:69-78`).
5. Workspace owner of that squad, allow (`permissions.js:82-87`).
6. `squad_members.can_create_archive` / `can_create_log`, allow
   (`permissions.js:90-101`).
7. Else 403.

`DEFAULT_PERMISSIONS` (`shared.js:48`) is
`{ create_squad: false, create_archive: false, create_log: true }`, applied to
any user with no `permissions` row. New users created through the normal paths
get a row with **all three true** via `createDefaultPermissions`
(`shared.js:168-173`), so the default only applies to rows that predate it or
were made outside those paths.

Note step 6 maps only two of the three flags (`permissions.js:90-93`). There is
no squad-level fallback for `create_squad`, which is correct: squads are created
in a workspace, not in a squad.

Currently applied on exactly two routes: `routes/archives.js:115`
(`create_archive`) and `routes/archives.js:424` (`create_log`), plus the upload
route `routes/upload.js:92` (`create_log`).

### 3b. Publish: `canPublish`

`shared.js:98-125`. Ordered bypasses: no squad context at all, allow; admin,
allow; workspace owner, allow; `squad_members.can_publish` or
`role = 'owner'`, allow; archive creator, allow; else deny.

Called from the REST publish route and from the collab WebSocket publish message
(`services/collab.js:547`), so both paths share one policy.

### 3c. Archive ownership: `isArchiveOwner`

`ownership.js:76-91`. A *narrower* check than write access, used for
destructive and administrative verbs. Admin, archive creator, workspace owner
(by email), or squad member with `role = 'owner'`. Note it does **not** honour
`can_write` or the JSON grant arrays: someone with full write access on an
archive still cannot delete it or change its ACLs.

Callers: delete archive (`archives.js:195`), manage access
(`archives.js:247`), link and unlink archive repos (`archives.js:595`,
`archives.js:644`).

### 3d. Squad management: `userCanManageSquad`

`routes/squads.js:283-299`. Workspace owner, squad creator, or member with
`can_manage_members`. Also used by the GitHub team-sync routes
(`github.js:2173`, `github.js:2253`).

## 4. How membership itself is granted

The checks above all assume a `squad_members` row already exists; this
section is about how one gets created. Three paths, one of them new:

1. **Squad/workspace creation.** `addSquadOwnerMember` inserts the creator as
   `role = 'owner'` with every flag `TRUE`.
2. **Accepting a `squad_invitations` row.** A pending invitation the recipient
   must explicitly accept (`routes/squads.js`), which inserts the
   `squad_members` row with whatever role and flags that invitation carried.
3. **An invitation-carried squad on `user_invitations`, accepted through
   signup.** `POST /api/admin/invitations` can attach a `squadId`, `role` and
   permission flags to the invitation. When the invited person creates their
   account (`POST /api/create-account`), `addSquadMember`
   (`routes/helpers/shared.js`) inserts the `squad_members` row inside the
   same transaction as the account itself. **This is the only one of the
   three that does not require the recipient to accept a separate
   `squad_invitations` row**: membership is a side effect of accepting the
   account invitation, not a second, independent grant the user has to act on
   afterward. See [data-model.md](data-model.md) for the `user_invitations`
   columns that carry it.

All three insert into the same table with the same shape, so every check
elsewhere in this map (clauses 5 and 6 of the SQL fragments, the per-flag
table below) applies identically regardless of which path created the row.

## 5. Per-member flags and where each is enforced

`squad_members` (`init.sql:155-171`) carries `role` plus seven booleans. Their
enforcement is uneven, which is worth knowing before you assume a flag does
something:

| Flag | Enforced by |
|---|---|
| `can_read` | clause 5 of `readAccessWhere` (`ownership.js:31`) |
| `can_write` | clause 5 of `writeAccessWhere` (`ownership.js:57`) |
| `can_create_log` | `requirePermission('create_log')` step 6 (`permissions.js:92`) |
| `can_create_archive` | `requirePermission('create_archive')` step 6 (`permissions.js:91`) |
| `can_manage_members` | `userCanManageSquad` (`squads.js:295`) |
| `can_publish` | `canPublish` (`shared.js:116-119`) |
| `can_delete_version` | version delete route only (`documents.js:503-515`) |

`role` is an enum of `member`/`admin`/`owner`, but only `owner` is load-bearing
in the SQL fragments (`ownership.js:31`, `ownership.js:57`). `admin` is treated
as an ordinary member by every access check; it only affects UI and the squad
management helper's `can_manage_members` grant path.

**`squad_permissions` no longer exists.** It was a settings table with no
enforcement path: read and written by `GET`/`PUT /api/squads/:id/permissions`
and by nothing else, while `requirePermission` consulted the global
`permissions` table and the `squad_members` columns. Toggling it persisted a
value that changed no behaviour. Removed 2026-08-09 along with both routes,
since `squad_members.can_create_*` already answers the same question and is
enforced. See [open-questions.md](open-questions.md) A3.

## 6. Admin

`users.is_admin` short-circuits every layer: clause 1 of both SQL fragments,
step 1 of `requirePermission`, the first bypass in `canPublish` and
`isArchiveOwner`, and `requireAdmin` (`middleware/auth.js:53-58`) for the
`/api/admin/*` surface.

The admin user is reconciled from `.env` on every boot by `ensureAdminUser()`
(`server.js`, a top-level `await` before the port opens; defined in
`routes/admin.js`), which
is why `ADMIN_USERNAME`/`ADMIN_PASSWORD`/`ADMIN_EMAIL` are boot-fatal if unset
(`server.js:17-21`).

## 7. Checklist for adding a protected route

1. `requireAuth` first, always. There are no internal endpoints; the only
   surfaces are public HTTP and the two WebSockets.
2. Creation verb, add `requirePermission('<flag>')`.
3. Reading or writing an existing document or archive, call one of the four
   `check*Access` helpers, or interpolate the fragment with the matching
   `*Params` spread. Never hand-roll the SQL.
4. Destructive or ACL-changing, use `isArchiveOwner`, not write access.
5. Wrap in `asyncHandler`, end the router with `router.use(errorHandler)`.
6. Add the negative test. Every route test file in `tests/routes/` already has
   an access-denied case to copy; `tests/helpers/ownership.test.js` covers the
   fragments themselves, and its glob carries an 88% line threshold
   (`vitest.config.js:87`).

---

## Related

- [data-model.md](data-model.md) for the ACL column families and their defaults.
- [github-integration.md](github-integration.md) for the PR-session path that
  writes the write-only log ACL columns.
- [open-questions.md](open-questions.md) for the items above that read as
  defects rather than design.

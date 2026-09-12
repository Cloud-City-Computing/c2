# Access Control Map

**Read this before touching any permission code.** Cloud Codex does not have one
access-control system. It has one *primary* system plus five smaller ones that
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
(`init.sql:265-266`). Grepping the whole backend for reads of them turns up
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

## 3. The five secondary systems

### 3a. Global feature permissions: `requirePermission(flag)`

`middleware/permissions.js:40-111`. Guards *creation* verbs, not access to
existing rows. Three flags: `create_squad`, `create_archive`, `create_log`.

Resolution order:

1. `req.user.is_admin`, allow (`permissions.js:48`).
2. Load `req.permissions` from the `permissions` table if not already loaded,
   falling back to `DEFAULT_PERMISSIONS` (`permissions.js:51-61`).
3. **Tenant check.** If `req.body.squad_id` is present and well formed, the
   caller must be inside that squad's workspace, or 403
   (`isSquadWorkspaceMember`, `permissions.js:73-84`). This sits *above* the
   global flag deliberately; see 3e.
4. Global flag set, allow (`permissions.js:87-89`).
5. Otherwise derive a squad from `req.body.squad_id`, or from
   `req.params.archiveId` via the archive's `squad_id` (`permissions.js:93-102`).
6. Workspace owner of that squad, allow (`permissions.js:105-111`).
7. `squad_members.can_create_archive` / `can_create_log`, allow
   (`permissions.js:113-125`).
8. Else 403.

`DEFAULT_PERMISSIONS` (`shared.js:48`) is
`{ create_squad: false, create_archive: false, create_log: true }`, applied to
any user with no `permissions` row. New users created through the normal paths
get a row with **all three true** via `createDefaultPermissions`
(`shared.js:168-173`), so the default only applies to rows that predate it or
were made outside those paths.

Note step 7 maps only two of the three flags (`permissions.js:114-117`). There
is no squad-level fallback for `create_squad`, which is correct: squads are
created in a workspace, not in a squad.

Currently applied on exactly two routes: `routes/archives.js:117`
(`create_archive`) and `routes/archives.js:470` (`create_log`), plus the upload
route `routes/upload.js:95` (`create_log`).

Step 3 is what makes the global flag mean "may create" rather than "may create
anywhere". `POST /api/archives` takes its `squad_id` from the body and this
middleware is its only gate, so before step 3 existed any account could plant an
archive inside any squad in any workspace. The 403 reuses the generic permission
message rather than naming the squad, so the route does not become a squad
enumeration oracle.

`create_squad` is not enforced through this middleware at all. `POST
/api/workspaces/:workspaceId/squads` (`routes/squads.js`) checks the flag
inline, and only **after** `isWorkspaceMember` (`ownership.js`): the workspace is
the tenant boundary, so holding the flag means "may create a squad", not "may
create a squad anywhere". `createDefaultPermissions` (`shared.js`) hands every
new account `create_squad`, so without that ordering any account could enrol
itself as a squad *owner* inside a workspace it has no relationship to, and squad
ownership is a live term in `readAccessWhere`/`writeAccessWhere`. A caller who is
neither the workspace owner nor a member of some squad in the workspace gets the
same `404` and the same body as a workspace that does not exist, deliberately: a
distinguishable `403` would make the route a workspace enumeration oracle. An
orphaned workspace (`owner_id` NULL because the owner account was deleted) is not
a public workspace either; with no owner to match, membership is the only way in,
and such a workspace is adopted by an admin rather than claimed by whoever asks
first. That rule and the middleware's step 3 are two halves of the same boundary;
3e below is where the whole of it is written down.

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

### 3d. Squad management: `canManageSquad`, and its GitHub-only twin

`canManageSquad(squadId, user)` in `routes/squads.js`. Admin, workspace owner,
squad creator, or member with `can_manage_members`. Returns
`{ squad, allowed }`, and every squad-member route in that file gates on it.

**A second helper answers the same question differently.**
`userCanManageSquad(user, squadId)` in `routes/github.js` serves the two
team-sync routes only. It admits admin, workspace owner, a member whose `role`
is `owner`, or a member whose `role` is `admin` **and** who holds
`can_manage_members`. So it does not admit the squad creator, and it reads
`can_manage_members` only alongside an `admin` role, where `canManageSquad`
reads the flag on its own. Same name shape, different rule: check which file
you are in before assuming either answer.

### 3e. The tenant boundary: `isWorkspaceMember` / `isSquadWorkspaceMember`

`ownership.js:103-140`, added 2026-09-08. **The workspace is Cloud Codex's
tenant boundary**, and until these two helpers existed nothing in the codebase
could ask "is this user inside workspace W?". Four routes therefore read a
caller-supplied workspace or squad id as authorisation on its own, because
`createDefaultPermissions` (`shared.js`) hands every new account all three
global flags and each of those routes treated the flag as sufficient.

There is no `workspace_members` table. Membership of workspace W resolves as:
admin, OR `workspaces.owner_id = user`, OR a member of some squad whose
`workspace_id` is W. `isSquadWorkspaceMember(user, squadId)` looks the squad's
`workspace_id` up and delegates to `isWorkspaceMember`. Both short-circuit for
admins before touching the database, and both parameterise every id.

Enforced at exactly four points:

| Where | What it gates |
|---|---|
| `POST /api/workspaces/:workspaceId/squads` (`squads.js:101`) | `isWorkspaceMember` before the `create_squad` lookup, non-owner path only. Squad creation enrols the caller as a squad *owner*, which is a live term in clause 5 of both fragments. |
| `requirePermission(flag)` (`permissions.js:73-84`) | `isSquadWorkspaceMember` on `req.body.squad_id`, above the global-flag short circuit. Step 3 of 3a. |
| `POST /api/archives/:id/access` (`archives.js`) | the grantee, user or squad, against the archive's workspace, on `action: 'add'` only |
| `GET /api/users/search` (`routes/auth.js`) | a non-admin caller sees themselves, users who share a workspace with them, the owners of those workspaces, and unattached accounts only if they can invite, instead of every account and email on the install |

Two shapes of the same question, and they are not interchangeable. The user
branch of the archive ACL check asks *is this grantee inside the archive's
workspace*, and passes a synthetic user with `is_admin` forced false, because
`isWorkspaceMember` short-circuits on `is_admin` and the question there is the
grantee's tenancy, not their privilege. The squad branch does not use
`isSquadWorkspaceMember` at all: "is the granted squad inside this workspace" is
a direct `squads.workspace_id` comparison, not a membership test.

`POST /api/archives/:id/access` gates `add` and deliberately leaves `remove`
open to a cross-tenant grantee. Gating removal would make exactly the
pre-existing cross-tenant grants unrevokable, which is the opposite of the point.

**The UI has to source the revoke id from the grant list, not the picker.** The
Manage Archive Access modal (`ManageArchiveAccessModal` in `ArchiveBrowser.jsx`)
puts a Revoke control on each explicit grant returned by
`GET /api/archives/:id/access` and calls the same handler with that row's id.
The user search cannot serve this: `/api/users/search` is scoped to the caller's
workspace, so a cross-tenant grantee never comes back from it, and the picker
alone left the open `remove` path unreachable for precisely the grants it exists
to clear. Owner-squad members are listed alongside without a Revoke control:
they hold no `read_access` / `write_access` row, so a remove for them is a no-op.
The squad tab has the same shape, because `workspace_squads` in that response is
scoped the same way.

**A grant another clause shadows is worded as a grant, not as access.** Clause 2
is one of seven, and three of the others are visible in the same response:
`owner_squad_members` (clause 5), `granted_squad_user_ids` (clause 6, and it
folds the owning squad's members in too) and `read_workspace` / `write_workspace`
(clause 7). A user in `read_access` who is *also* an owning-squad member renders
as a granted row, not an inherited one, so before this the operator was told
`Successfully revoked write access for Alice` while clause 5 still resolved for
her. `inheritedAccessSource()` in `ArchiveBrowser.jsx` names the shadowing route
from those three fields; the row gains an `also inherited from ...` note, the
control reads **Remove Grant**, and the confirmation and toast talk about the
explicit grant being removed. The control stays, because the ACL entry is real
and clearing it is meaningful. The workspace-flag arm can over-warn (clause 7
also requires membership of some squad in the workspace, which the response does
not carry per user), which is the safe direction for a control that used to
claim the opposite of the truth.

**The ACL check enters on an orphaned squad rather than skipping it.** The guard
is `if (owning)`, not `if (owning?.workspace_id)`. An archive with no squad at
all yields no row from the `JOIN squads` and skips the check, as documented. A
squad row whose `workspace_id` is NULL goes *through* it and is refused, because
neither branch can match a NULL tenant: `isWorkspaceMember` binds `Number(null)`,
which is workspace 0, and `squads.workspace_id = NULL` evaluates to NULL rather
than true. Until 2026-09-08 the guard tested the column, so an orphaned squad
skipped the check entirely and its archive owner could grant to any user or
squad in any workspace: the one place the boundary failed open.

**`GET /api/users/search` cannot be scoped on shared membership alone.** An
account with no `squad_members` row anywhere shares no workspace with anyone,
and that is where every account starts, since Google SSO auto-provisioning
(`oauth.js`) and an admin invitation with no squad (`admin.js`) both write the
`users` row and nothing else. Membership-only scoping made such an account
invisible to every non-admin caller, which severs the squad invite flow: the
picker in `InviteMemberModal` is driven entirely by this endpoint, so the
account became unaddable by anyone but a platform admin, with an empty list as
the only symptom. Two further disjuncts close that: **owners of the caller's own
workspaces** (a workspace owner who joined no squad was invisible to their own
members), and **accounts with no squad membership at all, gated on the caller
being able to invite** (a `squad_members` row with `role` owner or admin or
`can_manage_members`, or owning a workspace). The gate is the point. Ungated,
the second disjunct would hand most of a young install's user table to every
caller, which is the enumeration the boundary exists to stop.

**The 7-param fragments were deliberately not touched.** These helpers add no
clause to `readAccessWhere`/`writeAccessWhere` and no param to
`readAccessParams`/`writeAccessParams`, so the contract in section 1 is
unchanged at seven. The boundary is a precondition on *creating* a row or naming
a grantee; the fragments answer the different question of who may reach a row
that already exists. Folding one into the other would have meant an eighth param
and a rewrite of every caller, for a check most of those callers do not need.

**Why the archive-derived squad is not part of the middleware check.** Step 5 of
3a derives a squad from `req.params.archiveId` for `create_log`. That derivation
stays exactly where it is, below the global flag, and is not hoisted into step 3:

- Both `create_log` routes re-check with `writeAccessWhere` immediately after
  the middleware (`archives.js:486-496`, `upload.js:107-119`), so the
  archive-derived path was never open the way the body path was.
- Checking it in the middleware would be a behaviour regression. A caller
  holding the global `create_log` flag plus an explicit `write_access` JSON
  grant matches clause 2 of the fragment and can create logs today without
  belonging to the workspace at all. An early archive-derived tenant check would
  403 them before the fragment is ever consulted.
- Hoisting the `SELECT squad_id FROM archives` above the global flag would also
  fire a query that does not run on that path today, shifting the `c2_query`
  mock queue in the archives and upload tests.

**Refusals that are decisions, not oversights:**

- An **orphaned workspace** (`owner_id` NULL after the owner account was
  deleted) is not a public workspace. Membership is then the only way in, and
  such a workspace is adopted by an admin rather than claimed by whoever asks
  first. The squad-creation route answers `404` with the byte-for-byte
  not-found body rather than a distinguishable `403`, so it is not a workspace
  enumeration oracle.
- An **orphaned squad** (`workspace_id` NULL) has no tenant to resolve, so
  `isSquadWorkspaceMember` answers false for everyone but an admin rather than
  reading "no workspace" as "any workspace".

**The orphaned-squad rule is a behaviour change with a cost, and it was priced
in.** Because step 3 runs above the global flag, a body-supplied squad is now
validated on the no-flag path too, so an orphaned squad no longer reaches the
`squad_members` fallback at step 7 either. A member holding `can_create_archive`
on an orphaned squad used to get `201` and now gets `403`. That was accepted
rather than special-cased: an orphaned squad has no tenant, so "is this user
inside its tenant?" is unanswerable, and failing closed is the right answer to
an unanswerable question. It is also consistent with the orphaned-workspace
rule above. All four `INSERT INTO squads` sites set `workspace_id`
(`squads.js:116`, `workspaces.js:80`, `admin.js:127`, `admin.js:218`), so only
legacy or hand-edited rows can be in this state.

**The fix is prospective.** It stops new cross-tenant rows and removes none of
the ones already there, each of which still resolves through the fragments as an
ordinary row: an owner `squad_members` row satisfies clause 5, a planted archive
matches `created_by` in clause 3, a cross-tenant grant matches clause 2.
`docs/security.md` carries three read-only enumeration queries for finding them
and ships no cleanup migration on purpose, because no query separates an attack
row from an install that used these routes exactly as they behaved. See B16 in
[open-questions.md](open-questions.md).

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

`squad_members` (`init.sql:176-192`) carries `role` plus seven booleans. Their
enforcement is uneven, which is worth knowing before you assume a flag does
something:

| Flag | Enforced by |
|---|---|
| `can_read` | clause 5 of `readAccessWhere` (`ownership.js:31`) |
| `can_write` | clause 5 of `writeAccessWhere` (`ownership.js:57`) |
| `can_create_log` | `requirePermission('create_log')` step 7 (`permissions.js:116`) |
| `can_create_archive` | `requirePermission('create_archive')` step 7 (`permissions.js:115`) |
| `can_manage_members` | `canManageSquad` (`squads.js`), and `userCanManageSquad` (`github.js`) on the team-sync routes only, where it counts only alongside an `admin` role |
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
`isArchiveOwner`, and `requireAdmin` (`middleware/auth.js`) for the
`/api/admin/*` surface.

The admin user is reconciled from `.env` on every boot by `ensureAdminUser()`
(`server.js`, a top-level `await` before the port opens; defined in
`routes/admin.js`), which
is why `ADMIN_USERNAME`/`ADMIN_PASSWORD`/`ADMIN_EMAIL` are boot-fatal if unset
(`server.js:17-21`).

## 7. Machine principals: the service token

A non-human caller authenticates through one seam, `services/machine-auth.js`,
which exports exactly one function:

```js
export async function verifyMachineCredential(token)
```

It returns a principal, or `null` when machine auth is unconfigured, when the
token does not match, or when the configured user does not resolve. A later
OIDC client-credentials grant replaces the body of that function and no call
site changes.

Two environment variables, **both required**, so an install that sets neither
gains no new authentication path:

| Variable | Meaning |
|---|---|
| `SERVICE_TOKEN` | the shared secret. Under 32 characters the feature stays off and logs why. |
| `SERVICE_TOKEN_USER` | the email of an existing, non-admin user whose access the token acts with. |

The credential has **no ACL of its own**. It acts as a real user, so every
fragment in section 1 applies unchanged and there is no machine-specific
access-control SQL to get wrong. Grant a machine what it should see the
ordinary way: squad membership, or an archive grant, on that user.

The comparison is `crypto.timingSafeEqual` over two SHA-256 digests, never
`===`, so a wrong-length token is rejected without throwing and without the
comparison leaking the configured length. The `users` lookup runs only after
the token matches, so a wrong token costs no query.

### The never-admin rule

`is_admin` is the **first bound parameter** of both fragments (`? = TRUE OR
...`), so a principal carrying it true matches every archive in the install.
That is guarded twice inside `verifyMachineCredential`:

1. a configured user whose row is admin is refused outright, with a
   `console.error`, and no principal is issued;
2. the principal is built with the literal `is_admin: false`, never the column.

Copying `row.is_admin` into the principal to "be faithful to the row" turns a
scoped read credential into a full-install read credential silently: no error,
no failing assertion outside `tests/services/machine-auth.test.js`.

### The scope is a scope

`machineOrAuth` (`middleware/auth.js`) tries the credential and otherwise falls
through to `requireAuth` unchanged. It is applied to exactly two routes:

| Route | Middleware |
|---|---|
| `GET /api/search` | `machineOrAuth` |
| `GET /api/browse` | `machineOrAuth` |
| `GET /api/workspaces/:workspaceId/reader-check` | **`requireMachine`** |
| `GET /api/search/filters` | `requireAuth` |
| `GET /api/presence` | `requireAuth` |
| everything else in the app | `requireAuth` |

### `requireMachine` is not `machineOrAuth`, and the difference is the point (C2-5)

`machineOrAuth` guards routes that answer **"what may YOU read?"** — the caller asks about
themselves, so falling through to a session is the natural other half.

`requireMachine` guards the one route that answers **"what may SOMEBODY ELSE read?"**. It refuses a
session outright, whatever the role, with the same 401 and body an anonymous caller gets.

That asymmetry exists because the reader check is an **oracle about third parties**. Behind a
session, any logged-in user could enumerate which colleagues belong to which workspaces, and —
because an unknown address answers exactly as an unauthorised one does — probe which email addresses
have accounts on this install at all. Behind the machine credential the exposure is bounded to a
compromised Cloud Command server, which is a system we operate.

**The endpoint answers `{ canRead }` and nothing else.** A missing user, an unauthorised user and a
workspace that does not exist all produce the identical `{ canRead: false }`: any difference in
status or body would turn it into an account-existence or id-space oracle.

**What it means by "can read a workspace"** is derived from rules this product already has, not
invented — an admin, the workspace owner (`workspaces.owner_id`), or a member of any squad in that
workspace, which is exactly what `ownership.js`'s `read_access_workspace` clause already means. It is
deliberately NOT "has read access to at least one archive here": a person who belongs to a workspace
but holds no archive grants yet should still be able to connect it, and every search that follows
still applies the per-archive grants unchanged. **This gates the MAPPING, not the reads.**

**Why it exists at all** is a suite problem rather than a Cloud Codex one: Cloud Command's
`c2_workspace_id` was caller-asserted, so any account that could create a Cloud Command workspace
could point it at any workspace here and read document titles out of it. Cloud Command can only ask;
the answer has to come from the system that owns the rules. Its consuming half is `S5.1b-f` in that
repo.

**The test that proves the machine-only property only proves it because it queues a principal row it
does not use** (`tests/routes/reader-check.test.js`). Without that row the credential lookup finds
nothing and the request is refused anyway, so the 401 would pass even if the route had been written
with `machineOrAuth` — the same false-green shape the `search.test.js` 401s were written to avoid.

Both machine-reachable routes are reads, and both consume the principal only
through `readAccessParams(req.user)` and `buildFilters(req.query, req.user)`.
Neither calls `logActivity` nor `createNotification`, so nothing is attributed
to the machine principal and no watcher is enrolled.

Widening the credential to a route that writes, logs activity, or notifies is a
decision to take on purpose, not a tidy-up: the principal carries a real user
id, so an `activity_log` row or a notification would name that user as the
actor with nothing to tell a reader a machine did it. The principal carries
`is_machine: true` for any caller that needs to distinguish them.

The refusal paths and the comparison are covered in
`tests/services/machine-auth.test.js`. The tests that prove the scope is a
scope are the 401s on `GET /api/search/filters` and `GET /api/presence` in
`tests/routes/search.test.js`, and they only prove it because each one queues
the principal row first: without that row a widened route would refuse the
credential for the wrong reason and the 401 would assert nothing. Mounting
`machineOrAuth` on either route turns both into `expected 200 to be 401`.

## 8. Checklist for adding a protected route

1. `requireAuth` first, always. There are no internal endpoints; the only
   surfaces are public HTTP and the two WebSockets. The single alternative is
   `machineOrAuth` (7), which wraps `requireAuth` rather than replacing it, and
   which is deliberately mounted on two read routes and nothing else.
2. Creation verb, add `requirePermission('<flag>')`. If the route takes a
   workspace or squad id from the caller rather than deriving it from a row the
   caller already reaches, gate it with `isWorkspaceMember` /
   `isSquadWorkspaceMember` as well: the flag means "may create", never "may
   create anywhere" (3e).
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
- [../security.md](../security.md) for the tenant-boundary summary and the three
  read-only queries that enumerate cross-tenant rows predating 3e.

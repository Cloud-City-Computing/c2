# Data Model Map

24 tables in one MySQL 8 schema, InnoDB throughout. `init.sql` is the canonical
definition; `migrations/` is the incremental path for databases that already
exist. Both must be kept in sync, and there is a live trap in how `init.sql` is
re-applied.

For the human-readable column-by-column reference see `docs/database.md`. This
map covers the parts that change how you write code.

---

## 1. The hierarchy

```
workspaces
    └── squads              (workspace_id, nullable)
            └── archives    (squad_id, nullable)   ◄── THE ACL BOUNDARY
                    └── logs        (archive_id)
                            ├── versions
                            ├── comments ── comment_replies
                            ├── favorites
                            ├── github_links   (1:1)
                            ├── github_embed_refs
                            └── github_pr_sessions
```

Every nullable parent key is load-bearing:

- `squads.workspace_id` nullable, and `archives.squad_id` is
  `ON DELETE SET NULL` (`init.sql:208`). Deleting a squad **orphans** its
  archives rather than cascading. An orphaned archive has no squad, so clauses
  4 through 7 of the access fragments all evaluate false and only the creator,
  an explicit grant, or an admin can reach it. See
  [access-control.md](access-control.md).
- `archives.squad_id NULL` is also how the GitHub PR-session system archive is
  built deliberately (`github.js:1648-1656`), one archive per PR.
- `logs.archive_id` is `ON DELETE CASCADE` (`init.sql:247`), so deleting an
  archive destroys its documents, versions, comments and favourites.

`workspaces.owner_id` is an INT referencing `users(id) ON DELETE SET NULL`.
Clause 4 of both access fragments joins on it (`ownership.js:30`). Deleting the
owning user leaves the workspace intact but ownerless, which is why the column
is nullable. Ownerless does **not** mean locked down: only clause 4 stops
matching. Squad membership (clause 5), per-squad grants (clause 6) and the
workspace-wide flag (clause 7) are untouched, so the squad still reaches
everything in it, and `routes/workspaces.js` still lists the workspace for any
squad member, squad creator, or holder of an archive `read_access` grant.

It was a `TEXT` column holding an **email address** until
`migrations/add_workspace_owner_id.sql`. Under that shape, changing a user's
email silently destroyed their workspace ownership, and deleting the user left a
dangling string that a later account registering the same address would inherit.
The FK is declared as a trailing `ALTER TABLE` in `init.sql` rather than inline,
because `workspaces` is created before `users` (the same reason
`user_invitations.squad_id` is declared that way).

## 2. The ACL columns

Only `archives` carries a working ACL. Six columns, in read/write pairs
(`init.sql:201-206`):

| Column | Type | Meaning |
|---|---|---|
| `read_access` / `write_access` | `JSON` array, default `JSON_ARRAY()` | user ids |
| `read_access_squads` / `write_access_squads` | `JSON` array | squad ids |
| `read_access_workspace` / `write_access_workspace` | `BOOLEAN`, default `FALSE` | workspace-wide flag |

`logs.read_access` and `logs.write_access` (`init.sql:244-245`) exist with the
same shape and are **read by nothing**. `versions.read_access`
(`init.sql:316`) is likewise never consulted. Treat all three as dead columns;
see [open-questions.md](open-questions.md).

## 3. `logs`: the document row

```sql
html_content     MEDIUMTEXT
markdown_content MEDIUMTEXT
ydoc_state       LONGBLOB
plain_content    MEDIUMTEXT GENERATED ALWAYS AS
                   (REGEXP_REPLACE(html_content, '<[^>]+>', '')) STORED
FULLTEXT INDEX ft_logs_search (title, plain_content)
```

`plain_content` is computed by MySQL on every `html_content` write and is the
only body text the FULLTEXT index sees (`init.sql:237`, `init.sql:246`).
Consequences:

- **Never write `plain_content`.** It is generated; an INSERT naming it errors.
- **Search sees `html_content` only.** A document whose live state lives in
  `ydoc_state` but whose HTML has not been re-saved is stale in search. See
  [documents-and-collab.md](documents-and-collab.md).
- The tag-strip is a regex, not a parser, so entities such as `&amp;` survive
  into the index verbatim.
- **All three content columns are `MEDIUMTEXT` (16 MiB)** since 2026-08-09, so
  the app's own 2 MiB ceiling (`documents.js:22`, `collab.js:44`) is now the
  real limit. Until then `html_content` and `plain_content` were `TEXT`
  (64 KiB) and the column was the true ceiling: measured, a 40 KiB save
  returned 200 and a 70 KiB save returned an opaque 500 with the edit lost,
  because the shipped image runs `STRICT_TRANS_TABLES`. `plain_content` had to
  widen with it (stripping tags from prose barely shrinks it), and so did
  `versions.html_content`, which publish copies the document into. See B2 in
  [open-questions.md](open-questions.md) and
  `migrations/widen_log_content.sql`.
- `logs.parent_id` self-references with `ON DELETE SET NULL` (`init.sql:248`),
  giving documents a tree shape rendered by `PageTree.jsx`.
- `logs.version` is an integer counter bumped on publish and restore; the
  `versions` table holds the snapshots.

## 4. Sessions and auth tables

`sessions.id CHAR(64)` is the primary key and *is* the token
(`init.sql:73`), generated by `createNewSessionToken` (`mysql_connect.js:95`).
There is a `UNIQUE`-by-construction guarantee via the PK and an `expires_at`
index, but **no unique constraint on `user_id`**, even though
`generateSessionToken` treats it as one-per-user by doing
`WHERE user_id = ? LIMIT 1` (`mysql_connect.js:111`). Two rows for one user would
be tolerated by the schema and half-ignored by the code.

`password_reset_tokens` is a **four-flow pool**, not a reset table. It also
stores the short-lived 2FA handoff token issued during login, the TOTP
enrolment `setupToken`, and the 2FA-disable `confirmToken`. A row in that table
is not necessarily a password reset.

Which flow minted a row is recorded in `purpose VARCHAR(32) NOT NULL`, with a
`CHECK` constraint restricting it to `password_reset`, `two_factor_login`,
`totp_setup`, `two_factor_disable`, added by
`migrations/2026-09-08-token-purpose.sql`. Before it,
nothing recorded the flow and **no reader constrained it**, so a token was
interchangeable across flows. The sharpest pairing: `POST /api/login` mints the
2FA challenge row and returns that token to the caller in the response body,
and `POST /api/reset-password` read the same table by token alone, so the login
endpoint's own token was accepted as a password reset token. Impact was a
persistent password rewrite plus a full session wipe of the victim, i.e.
lockout and an integrity defect; reset-password issues no session and does not
clear `two_factor_method`, and the caller must already hold the victim's
password to reach the challenge, so it was **not** account takeover.

Two of the other three readers were lower still, because `/2fa/totp/confirm`
and `/2fa/disable/confirm` sit behind `requireAuth` and additionally require
`tokenRecord.user_id === req.user.id`. **`/2fa/verify` is neither.** It is
unauthenticated, there is no `req.user` to compare against, and its guard
checks only `used` and `expires_at`. What actually stops a stray token there is
the separate code check that follows: a TOTP validation, or a matching unused
row in `two_factor_codes`. Anyone adding a branch to `/2fa/verify` that skips
that check is minting a full session for whatever `user_id` the token row
names, from an unauthenticated endpoint.

Four rules follow, and all four are load-bearing:

- The four minters in `routes/auth.js` bind a `TOKEN_PURPOSE` value from
  `routes/helpers/shared.js`; the four readers all carry `AND purpose = ?`.
- **No `DEFAULT`, and `VARCHAR` + `CHECK` rather than `ENUM`.** A fifth flow
  that forgets to name its purpose fails at insert (error 1364) instead of
  silently minting a password reset token, and a value outside the set fails
  too (error 3819). `ENUM` cannot deliver that: MySQL gives a `NOT NULL` `ENUM`
  with no `DEFAULT` an implicit default of the **first** listed value even
  under `STRICT_TRANS_TABLES`, so an omitted purpose would silently become
  `password_reset`, which is the exact defect the column exists to close.
  Measured on `mysql:8` (8.4.8), the shipped image.
- Forgot-password's `UPDATE ... SET used = TRUE WHERE user_id = ?` is scoped to
  `purpose = 'password_reset'` too. Unscoped, asking for a password reset
  silently killed the user's in-flight 2FA login, TOTP enrolment or
  2FA-disable confirmation.
- `routes/admin.js`'s `DELETE FROM password_reset_tokens WHERE user_id = ? AND
  used = FALSE` stays **purpose-agnostic on purpose**. It is the admin recovery
  path for a user locked out of 2FA, and it is meant to clear whatever the user
  is mid-flow on.

**The migration fails closed and its order is load-bearing.** Legacy rows
cannot be classified after the fact and every token here is short-lived (10
minutes to 1 hour), so the migration deletes them rather than inventing a
default; in-flight resets and challenges must be restarted. Because the column
is `NOT NULL` with no default and no compose file overrides `sql_mode` (so
MySQL 8's `STRICT_TRANS_TABLES` applies), the schema is incompatible with the
app in **both** directions: old code against the new schema is error 1364 on
all four minters, new code against the old schema is error 1054. Required
order is **stop every writer, apply, start the new image** ("every writer",
because `docker-compose.yaml` defines only a `database` service and in dev the
writer is `npm run dev` on the host). Stopping the writers also closes a
partial-failure race where a row inserted between the `DELETE` and the `MODIFY`
leaves the column a nullable `VARCHAR(32)`, since MySQL implicitly commits DDL.
There is no rollback: reverting the app lands you in old-code-against-new-schema
and getting back means dropping the column by hand. See the migration header
and `docs/deployment.md`.

`two_factor_codes` holds 6-digit email OTPs; TOTP secrets live on
`users.totp_secret` instead. `users.two_factor_method` is
`ENUM('none','email','totp')`.

`user_invitations` is what makes signup invite-only. The `users` table is only
ever written with a valid invite token, an admin action, or an OAuth flow
against a configured provider. Beyond `email`/`token`/`invited_by`, it also
carries `squad_id` (nullable), `role`, and the same seven `can_read` through
`can_publish` permission booleans as `squad_members`, mirroring
`squad_invitations`'s vocabulary rather than inventing a second one. An
invitation created with a squad attached (`POST /api/admin/invitations` with
`squadId`) makes `POST /api/create-account` insert a `squad_members` row for
the new account, inside the same transaction as the account and permissions
rows, using `addSquadMember` in `routes/helpers/shared.js`. **This is a
second way a `squad_members` row gets created**, alongside accepting a
`squad_invitations` row, and the only one that requires no separate accept
step: membership lands atomically with the account itself.

`user_invitations.squad_id`'s foreign key to `squads(id)` is a trailing
`ALTER TABLE` at the end of `init.sql`, **not** part of the inline
`CREATE TABLE user_invitations` block. `init.sql` declares
`user_invitations` before `squads`, so an inline FK there would reference a
table that does not exist yet and abort the whole file on a fresh volume; the
constraint is added right after `CREATE TABLE squads` instead.
`migrations/add_first_run.sql` does not have this ordering problem, since any
database old enough to need the migration already has a `squads` table, so
it adds the FK constraint inline in the same `ALTER TABLE` that adds the
other eight columns. Reviewers have misread the split placement as
inconsistency once already; it is a fresh-install ordering constraint, not
a mistake.

`users.onboarded_at` (`TIMESTAMP NULL`, default `NULL`) marks that a user has
completed the first-run welcome. It is `NULL` for every user that predates
it, so each sees the welcome once, including the admin, who previously never
saw an onboarding flow at all. `routes/first-run.js` is the only writer.

## 5. Squads and membership

`squad_members` (`init.sql:155-171`) is unique on `(squad_id, user_id)` and
carries `role ENUM('member','admin','owner')` plus seven permission booleans.
Which of those are actually enforced, and where, is tabulated in
[access-control.md](access-control.md). Short version: `admin` as a role is
inert. (A `squad_permissions` table also existed and was enforced by nothing;
it was removed on 2026-08-09.)

`squad_invitations` is unique on `(squad_id, invited_user_id, status)`
(`init.sql:192`). Because `status` is part of the key, a user can hold one
pending, one accepted, and one declined invitation to the same squad
simultaneously; re-inviting after a decline works without cleanup.

A `squad_members` row now has three writers, not two: `addSquadOwnerMember`
(workspace/squad creation), accepting a `squad_invitations` row, and, as of
the first-run work, `addSquadMember` called from `POST /api/create-account`
when the invitation that created the account carried a `squad_id`. See
Section 4 above for the `user_invitations` columns that drive it.

## 6. The five GitHub tables

| Table | Key | Written by | Read by |
|---|---|---|---|
| `oauth_accounts` | unique `(provider, provider_user_id)` | `routes/oauth.js` | `getGitHubToken` (`github.js:54`), team sync identity match |
| `archive_repos` | unique `(archive_id, repo_full_name)` | `routes/archives.js:589` | bulk import |
| `github_links` | **unique `(log_id)`** | link CRUD, import, every sync route | status/pull/push/resolve |
| `github_pr_sessions` | unique `(repo_owner, repo_name, pr_number)` | `github.js:1677` | PR session lookup |
| `github_embed_refs` | index on `(repo_owner, repo_name, embed_type)` | **nothing** | `/api/logs/by-github-ref` |

`github_links` being unique on `log_id` is the reason a document links to at
most one file. `github_embed_refs` has no writer anywhere in the codebase; see
[github-integration.md](github-integration.md).

`oauth_accounts.encrypted_token` holds an AES-256-GCM blob whose key derives
from `GITHUB_CLIENT_SECRET`; `token_status ENUM('active','revoked','unknown')`
is flipped to `revoked` when GitHub rejects the token.

## 7. Comments

`comments` carries **two** anchoring schemes:

- Internal: `selection_start` / `selection_end` / `selected_text`, character
  offsets into the document.
- External: `external_kind ENUM('pr_file_line','pr_general','issue_thread')`,
  `external_ref`, `external_id`, for comments attached to a GitHub PR or issue
  through the PR-session mechanism (`init.sql:331-333`).

`tag` includes `pr_review` alongside the five user-facing tags. `status` is
`open`/`resolved`/`dismissed`, with `resolved_by` FK `SET NULL`.
`comment_replies` cascade-deletes with the parent comment.

## 8. Activity, watches, notifications

`activity_log.id` is `BIGINT` (`init.sql:370`), the only table that expects
that volume, and it is pruned at 365 days by `server.js:73-89`. It has four
composite indexes covering the workspace, squad, resource, and user read paths.

**It has a foreign key on `user_id` only.** `workspace_id`, `squad_id`,
`resource_type` and `resource_id` are unconstrained, which is deliberate for a
polymorphic append-only log: deleting a document leaves its activity rows in
place, and the read query's access clause simply stops matching them.

`watches` is likewise polymorphic, unique on
`(user_id, resource_type, resource_id)`, with a FK on `user_id` only. Deleting a
document therefore **orphans** its watch rows. They are harmless because
`fanOutToWatchers` bails when the log row is gone (`activity.js:180-184`), but
they accumulate and nothing prunes them.

`notifications` has FKs on both `user_id` (cascade) and `actor_id`
(`SET NULL`), plus a covering index for the unread badge
(`idx_notifications_user_unread`).

## 9. `init.sql` versus `migrations/`

**The rule:** every schema change lands in *both*. A new column needs a file in
`migrations/` for existing databases and an edit to `init.sql` for fresh ones.
As of this writing the two are in sync; the p0 and p3 migration columns are all
present in `init.sql` (`init.sql:56-70`, `init.sql:129-131`,
`init.sql:304-319`).

### The runner and `schema_migrations`

`cloudcodex/scripts/migrate.js`, run as `npm run migrate` from `cloudcodex/`,
applies pending files in lexicographic order and records each in
`schema_migrations`:

| column | type | note |
|---|---|---|
| `filename` | `VARCHAR(255) PRIMARY KEY` | the file's name, the identity |
| `checksum` | `CHAR(64) NOT NULL` | sha256 of the file's bytes when applied |
| `applied_ms` | `INT NOT NULL` | wall time the apply took, `0` for a baseline row |
| `applied_at` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | |

That table is **runner-owned bookkeeping and is deliberately not in
`init.sql`**. It is created by `ensureBookkeeping()` outside any transaction.
Adding it to `init.sql` would break the runner: a fresh install would arrive
with the table present and empty, the runner would read "nothing applied", and
it would replay every shipped delta against the schema those deltas are already
folded into. That is the one exception to the dual-tracking rule above, which
still stands for every table the application itself reads.

Bookkeeping is what makes re-running safe: the files are individually
idempotent-ish (`CREATE TABLE IF NOT EXISTS`) but the `ALTER TABLE ... ADD
COLUMN` files are not, and re-running `p0_github_sync.sql` errors on a
duplicate column. The runner never re-runs a recorded file, and a recorded file
whose sha256 no longer matches is a hard stop over the whole set before
anything is applied, with the message that applied migrations are immutable.

Three states, decided in the runner:

1. No `users` table: **refuse.** Run `init.sql` first. The runner never
   bootstraps a schema, because the shipped files are deltas against `init.sql`
   and `drop_squad_permissions.sql` sorts ahead of most `add_*.sql` files.
2. `users` present, `schema_migrations` missing: **refuse**, and print both
   adoption commands. With no bookkeeping the runner cannot tell a
   fully-migrated database from a partly-migrated one, and either guess is
   destructive.
3. `schema_migrations` present: apply pending, with the drift guard.

Two adoption modes, and they are **not** interchangeable, because the two
situations have different correct sets:

- `--baseline` records the **closed** list in `LEGACY_BASELINE`, the thirteen
  files that shipped before the runner existed, and applies none. For an
  install that predates the runner and was migrated by hand. It is not a scan
  of `migrations/`: any file added after the runner landed stays pending and is
  applied by the next ordinary run. A sweep would mark a genuinely-unapplied
  file as applied and leave the app running against a schema that never got the
  change. **Never append to that list.**
- `--adopt-fresh-install` records **every** file on disk and applies none. For
  a database `init.sql` has just built. Correct there and only there, because
  the dual-tracking rule means `init.sql` already contains every migration, so
  applying any of them is a duplicate-column error.

Two guards on that second one, because it is the mode that can bury a migration
on purpose. It **refuses once `schema_migrations` holds a row**, which keeps it
off a tracked install. And for every file that postdates `LEGACY_BASELINE` it
**checks the live schema first**: `schemaClaims()` reads the `CREATE TABLE` and
`ALTER TABLE ... ADD COLUMN` out of the file (comments stripped, because the
headers quote the DDL that reverses them), and `assertSchemaAlreadyHas()` asks
`information_schema` whether each of those is already there, refusing unless it
is. Emptiness cannot be the guard: an install that predates the runner has zero
bookkeeping rows **by definition**, which is precisely the population reaching
for an adoption flag, and `bootstrapInstance()` seeds a workspace, squad,
archive and document on first admin boot, so "no content yet" is not a signal
either. The pre-runner thirteen are exempt from the check, because adopting
exactly those is what `--baseline` does anyway and because two of them (a `DROP`
and a `MODIFY`) add nothing an ADD-shaped check could look for. The mode prints
the exact list of files it is about to adopt before adopting them, and both
adoption modes write their rows in **one transaction**, so an interrupted run
leaves no partial bookkeeping to refuse over later.

One honest limit on both: an adopted row records the sha256 of the file **as it
is on disk at adoption time**, not of whatever that install actually ran years
ago. Drift that predates adoption is therefore invisible to the guard forever.
That is inherent to adopting a baseline rather than a defect, but it means the
guard's promise is "nothing has changed since adoption", not "this is what ran".

The apply phase is serialised by a MySQL advisory lock
(`GET_LOCK(CONCAT('cloudcodex_migrate:', DATABASE()), 10)`). Without it two
concurrent runs both compute the same pending set, MySQL serialises the DDL, and
the loser gets a duplicate-column error that the runner would report as "may be
partially migrated" when the database is in fact correct. The lock is
connection-scoped, which suits the CLI's single dedicated connection, but the
NAME is scoped to the MySQL **server**, not to a database, which is why it
carries `DATABASE()`: without that, two Cloud Codex schemas on one server
serialise against each other and the loser is told a run is in progress against
its own database. `0` (someone holds it) and `NULL` (the attempt errored) get
different messages.

**MySQL implicitly commits DDL**, so a transaction per file cannot make a
migration atomic the way it can on Postgres. The runner opens one anyway for
the DML that honours it, and on failure it stops at the failing file and
reports that the database **may be partially migrated** rather than promising a
rollback it cannot deliver. Take a dump first.

One failure is the opposite of partial: `ER_DUP_FIELDNAME`,
`ER_TABLE_EXISTS_ERROR` and `ER_DUP_KEYNAME` mean the object is already there,
and the run may have changed nothing. The usual cause is a fresh install
baselined with `--baseline` instead of `--adopt-fresh-install`, which leaves the
newer files pending and then dies on their first `ALTER`, minutes after install,
with no dump to restore. The runner names the code, says which flag that
database wanted, and prints the `INSERT INTO schema_migrations` that records the
file by hand.

### Trap 1: `init.sql` only runs on a fresh volume

Both compose files mount it into `/docker-entrypoint-initdb.d/`
(`docker-compose.yaml:22`, `docker-compose-prod.yml:19`). The MySQL entrypoint
**skips that directory entirely when the data directory is already
initialised.** Editing `init.sql` and restarting the container does nothing.
Dev volume is the bind mount `./db-data/`; prod is the named volume `db_data`.

### Trap 2 (fixed): `make reset-db` used to be an incomplete reset

`make reset-db` (`Makefile:21-24`) pipes `init.sql` then `seed.sql` into the
running container. `init.sql`'s `DROP TABLE IF EXISTS` list (`init.sql:12-36`)
now covers all 24 tables. It used to omit `github_links`, `activity_log`,
`watches` and `notifications`, whose `CREATE TABLE` statements don't use
`IF NOT EXISTS`, so `reset-db` failed partway through with a duplicate-table
error on a database that already had those four. Fixed by adding them to the
DROP block; order doesn't matter since it runs under
`SET FOREIGN_KEY_CHECKS = 0`.

## 10. Adding a table or column: checklist

1. Add it to `init.sql` in dependency order, and to the `DROP TABLE IF EXISTS`
   block at the top if it is a new table.
2. Add a `migrations/<date>-<descriptive-name>.sql` for existing databases, and
   do **not** add it to `LEGACY_BASELINE` in `scripts/migrate.js`. Lexicographic
   order is the apply order; a date prefix sorts new files correctly among
   themselves and, since digits sort ahead of letters, harmlessly ahead of the
   already-applied legacy set.
3. Index anything you will filter or join on. Look at
   `idx_activity_workspace_time` and `idx_notifications_user_unread` for the
   composite-index style already in use.
4. Decide the FK behaviour deliberately: `CASCADE` for owned children,
   `SET NULL` for attribution (`created_by`, `resolved_by`), no FK for
   polymorphic references.
5. If it is user-scoped and holds content, decide how it interacts with the
   archive ACL. Do not add a per-row ACL column expecting it to work; only
   `archives` is wired into `ownership.js`.
6. Update `docs/database.md` and the test fixtures.

---

## Related

- [access-control.md](access-control.md) for how the ACL columns resolve.
- [documents-and-collab.md](documents-and-collab.md) for the three content
  columns and their divergence.
- [build-test-and-ops.md](build-test-and-ops.md) for the Docker volume
  topologies behind trap 1.

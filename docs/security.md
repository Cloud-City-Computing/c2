```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   SECURITY                                                                 ║
║   Defense-in-depth: edge → middleware → SQL → at-rest encryption.          ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Security

Cloud Codex follows security best practices across all layers of the stack.
The model is **defense-in-depth** — a request is checked at every level
between the network edge and the database, and stored secrets are encrypted
even if the DB is compromised.

```
   request
      │
      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  edge:    helmet (CSP, X-Frame, X-CT, Referrer-Policy)   │
   │           CORS allowlist (no localhost in prod)          │
   │           express-rate-limit (auth 20/15m, search 60/15m)│
   └──────────────────────────────────────────────────────────┘
      │
      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  parsing: JSON 2 MB cap                                  │
   │           multer file size cap (10 MB)                   │
   └──────────────────────────────────────────────────────────┘
      │
      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  auth:    requireAuth (Bearer token / sessionToken cookie)│
   │           validateAndAutoLogin → user object on req      │
   │           requireAdmin / requirePermission               │
   │           workspace tenant check on a body squad_id      │
   └──────────────────────────────────────────────────────────┘
      │
      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  input:   DOMPurify (sanitizeHtml on every user-supplied │
   │           HTML write — REST AND WebSocket paths)         │
   │           length caps + isValidId on path params         │
   └──────────────────────────────────────────────────────────┘
      │
      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  access:  ownership.js readAccessWhere/writeAccessWhere  │
   │           7-step cascade in a single SQL fragment        │
   └──────────────────────────────────────────────────────────┘
      │
      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  storage: parameterized SQL (mysql2 prepared statements) │
   │           bcrypt 12 rounds for passwords                 │
   │           AES-256-GCM (scrypt-derived) for OAuth tokens  │
   └──────────────────────────────────────────────────────────┘
      │
      ▼
                       MySQL 8
```

---

## SQL Injection Prevention

All database queries use parameterized prepared statements via `mysql2`. User-supplied values are never interpolated directly into query strings.

---

## Password Storage

Passwords are hashed with **bcrypt** at 12 salt rounds. Comparisons use constant-time equality to prevent timing attacks.

---

## Session Management

Session tokens are 64-character cryptographically random strings (Node.js `crypto.randomBytes`) with a 7-day expiry. Sessions are invalidated immediately on password change and on successful password reset. IP address and user-agent are recorded per session.

`POST /api/logout` deletes the `sessions` row. It resolves the token through the same exported `extractSessionToken` that `requireAuth` uses (Authorization header, then `sessionToken` cookie, then a `req.body.token` fallback), so a logout terminates the server-side session and not just the client's copy of the token.

---

## Single-purpose Tokens

`password_reset_tokens` is a shared pool: four flows mint into it (password reset, the 2FA login challenge, TOTP enrolment, and the 2FA-disable confirmation) and four flows read out of it.

**Every row records which flow minted it, in a `purpose` column that is `NOT NULL` with no `DEFAULT`, and every reader constrains on it.** The values live in one place, `TOKEN_PURPOSE` in `routes/helpers/shared.js`, and mirror the `CHECK` constraint in `init.sql`. The column is `VARCHAR(32)` plus a `CHECK` rather than an `ENUM` on purpose: MySQL gives a `NOT NULL` `ENUM` with no `DEFAULT` an implicit default of the first listed value even under `STRICT_TRANS_TABLES`, so an omitted purpose would silently become `password_reset`. As written, omitting the column is error 1364 and an unknown value is error 3819.

The rule exists because without it a token was interchangeable across flows. `POST /api/login` mints the 2FA challenge row and hands that token back to the caller in the response body, so an unconstrained `POST /api/reset-password` accepted it. That was a persistent password rewrite plus a full session wipe of the victim, so lockout and an integrity defect, not account takeover: reset-password issues no session and does not clear `two_factor_method`, and the caller must already hold the victim's password to reach the challenge at all.

Consequences for anyone adding a fifth flow:

- Name a new purpose in `TOKEN_PURPOSE`, add it to the `CHECK` constraint in `init.sql`, and ship a migration. Omitting the column fails the insert loudly, which is the point of having no default.
- A new reader of this table gets `AND purpose = ?`. A token lookup by token alone is a defect.
- Bulk invalidation is purpose-scoped too. Forgot-password's `UPDATE ... SET used = TRUE` binds `password_reset`; unscoped it silently killed the user's in-flight 2FA login.
- The one deliberate exception is the admin 2FA reset in `routes/admin.js`, which deletes every unused row for a user regardless of purpose. It is the lockout recovery path and is meant to clear whatever the user is mid-flow on.

---

## Machine Credentials (Service Token)

A machine caller (another service that needs to read this install's documents) authenticates with a shared secret rather than a session. It is **off unless both** `SERVICE_TOKEN` and `SERVICE_TOKEN_USER` are set, so an install that configures neither gains no new authentication path.

| Property | Rule |
| --- | --- |
| Secret | `SERVICE_TOKEN`, minimum 32 characters. Shorter and the feature stays disabled, with the reason logged and the value never logged. |
| Comparison | `crypto.timingSafeEqual` over two SHA-256 digests, never `===`. Equal-length by construction, so a wrong-length token is rejected without throwing and without leaking the configured length. |
| Identity | `SERVICE_TOKEN_USER`, the email of an existing **non-admin** user. The credential acts as that user. |
| Reach | `GET /api/search` and `GET /api/browse`. Nothing else. Every other route, including `GET /api/search/filters`, keeps bare `requireAuth`. |
| Rotation | Change `SERVICE_TOKEN` and restart. No database change, no key version. Any caller still holding the old value gets 401s. |

The credential has no access-control rules of its own. Because it acts as a real user, the whole existing layer applies unchanged and there is no machine-specific permission SQL to get wrong: give a machine what it should see by putting its user in the right squads or on the right archive grants.

**An admin is refused outright.** `is_admin` is the first bound parameter of every access fragment in `routes/helpers/ownership.js`, so an admin principal matches every archive in the install. `verifyMachineCredential` refuses an admin row and logs it, and the principal it returns is built with a literal `is_admin: false` rather than the column. Both guards exist because either one alone silently converts a scoped read credential into a full-install one.

The whole surface is one function, `verifyMachineCredential` in `services/machine-auth.js`. A later OIDC client-credentials grant replaces its body without touching a call site.

---

## HTML Sanitization

**DOMPurify** is applied at three points: on server writes, on WebSocket broadcast, and on client rendering. `data:` URIs are restricted to `<img>` tags to prevent script injection via data URIs.

---

## OAuth Token Encryption

GitHub access tokens are encrypted at rest using **AES-256-GCM** with a key derived from `GITHUB_CLIENT_SECRET` via scrypt. OAuth state tokens are single-use and expire after 10 minutes.

---

## Security Headers

**Helmet** middleware applies a strict Content Security Policy and standard security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, etc.) on every response.

---

## Rate Limiting

**express-rate-limit** enforces per-endpoint limits:

| Scope | Limit |
| --- | --- |
| Auth endpoints | 20 requests / 15 min |
| Search | 60 requests / 15 min |
| WebSocket messages | 60 messages / second |

---

## WebSocket Hardening

- Origin validation on connection upgrade
- Authentication timeout (unauthenticated connections are closed after a short window)
- 5 MB message size limit
- Per-user connection caps to prevent resource exhaustion

---

## Content Size Limits

| Resource | Limit |
| --- | --- |
| Document content | 2 MB |
| Image uploads | 10 MB |

---

## CORS

Allowed origins are configured via the `CORS_ORIGIN` environment variable. The `localhost` bypass that is active in development is disabled in production builds.

---

## Input Validation

Length limits are enforced on all user-provided strings at the API boundary before any database interaction occurs.

---

## Email Header Injection Prevention

All fields used to construct outbound emails (name, subject, address) are sanitized before being passed to Nodemailer to prevent header injection attacks.

---

## The Workspace Tenant Boundary

The **workspace is the tenant boundary**. A global permission flag
(`create_squad`, `create_archive`, `create_log`) means "this account may create
this kind of thing", never "this account may create it anywhere".
`createDefaultPermissions` hands every new account all three flags, so any route
that accepts a caller-supplied workspace or squad id has to resolve that id
against the caller's own workspaces before acting on it.

`isWorkspaceMember(user, workspaceId)` and `isSquadWorkspaceMember(user, squadId)`
in `routes/helpers/ownership.js` are that check. There is no `workspace_members`
table: membership of workspace W is admin, OR `workspaces.owner_id = user`, OR
membership of some squad whose `workspace_id` is W.

| Enforced at | What it gates |
| --- | --- |
| `POST /api/workspaces/:workspaceId/squads` | `isWorkspaceMember` before the `create_squad` lookup, on the non-owner path. Refuses with the byte-for-byte not-found body, so the route is not a workspace enumeration oracle. |
| `requirePermission(flag)` (`middleware/permissions.js`) | `isSquadWorkspaceMember` on a body-supplied `squad_id`, above the global-flag short circuit |
| `POST /api/archives/:id/access` | the grantee, user or squad, has to be inside the archive's workspace. On `add` only: gating `remove` would make pre-existing cross-tenant grants unrevokable. |
| `GET /api/users/search` | a non-admin caller sees themselves, users who share a workspace with them, and the owners of those workspaces. Accounts with no squad membership anywhere are added only for a caller who can invite: a squad `owner`/`admin` role, `can_manage_members`, or a workspace of their own. Without that last disjunct an SSO or squad-less-invitation account is invisible to everyone but a platform admin and can never be invited into a squad. |

The 7-param `readAccessWhere` / `writeAccessWhere` fragments are not part of this
and were not changed. The boundary is a precondition on creating a row or naming
a grantee; the fragments answer the separate question of who may reach a row
that already exists.

Two refusals are deliberate:

- An **orphaned workspace** (`owner_id` NULL because the owner account was
  deleted) is not a public workspace. With no owner to match, membership is the
  only way in, and such a workspace is adopted by an admin rather than claimed
  by whoever asks first.
- An **orphaned squad** (`workspace_id` NULL) has no tenant to test against, so
  `isSquadWorkspaceMember` answers false for everyone but an admin, and the
  archive ACL check refuses every grantee on an archive owned by such a squad.
  Only an archive with **no** squad at all skips that check. All four
  `INSERT INTO squads` sites set `workspace_id`, so only legacy or hand-edited
  rows can be in this state.

[maps/access-control.md](maps/access-control.md) section 3e carries the full
resolution table, the behaviour change that came with the orphaned-squad rule,
and the reason the archive-derived squad is deliberately not checked in the
middleware.

---

## Auditing for Pre-existing Cross-tenant Rows

Those checks are **prospective**. They stop new cross-tenant rows; they remove
none of the rows created before them, and every such row keeps working
afterwards, because each one is an ordinary row that the access fragments
resolve correctly. An owner `squad_members` row still satisfies clause 5 of
`readAccessWhere`, a planted archive still matches `created_by` in clause 3, and
a cross-tenant grant still matches clause 2.

**There is no cleanup migration and no `DELETE`, deliberately.** No query can
tell an attack row from an install that used these routes exactly as they
behaved before the fix. A contractor added to a client workspace, a shared
platform squad, an admin who set a workspace up from a personal account: all
leave the same rows behind. Deleting squads, archives or grants automatically
would destroy legitimate data. The three queries below are read-only. They
produce a list, and the disposition of every row on it is the operator's.

Run them with `make db-shell`. Each returns nothing on an install that was never
used this way.

**Run them in order.** A user that query 1 reports has a `squad_members` row in
that workspace, so queries 2 and 3 read them as a member and will not report
them again. Query 1 is the prerequisite for interpreting the other two.

### 1. Squads whose creator is outside the squad's workspace

**This one cannot use the obvious membership test, and getting it wrong produces
a false green.** The squad-creation route calls `addSquadOwnerMember` on
success, so planting a squad writes a `squad_members` row for the planter
against the squad they just planted. A naive "the creator is not a member of
this workspace" predicate finds that row, through the very squad under
examination, and filters out its own evidence. Two planted squads in one
workspace also alibi each other, so excluding the current row alone is not
enough either.

The predicate below is therefore: the creator is not `workspaces.owner_id`, and
holds no `squad_members` row anywhere in that workspace, as of the moment the
squad was created, once **every squad in that workspace created by that same
user** is excluded.

`sm.joined_at <= s.created_at` is the second half of that, and it is not
optional. Without it a single membership of any squad the creator did not make,
acquired at any time, clears every squad they ever planted in that workspace.
Being onboarded properly later is the most likely thing to happen to a planter,
so the query would go quiet exactly when the operator most needs it. And because
query 2's extra clauses are only applied after reading query 1's output, a
silent query 1 hides the planted archives too. `squad_members.joined_at` defaults to
the insert time and the invitation-accept `ON DUPLICATE KEY UPDATE`
(`squads.js`) does not touch it, so it survives re-invitation.

```sql
SELECT s.id           AS squad_id,
       s.name         AS squad_name,
       s.workspace_id AS workspace_id,
       s.created_by   AS creator_id,
       u.email        AS creator_email,
       s.created_at   AS created_at
FROM squads s
JOIN workspaces w ON w.id = s.workspace_id
LEFT JOIN users u ON u.id = s.created_by
WHERE s.created_by IS NOT NULL
  -- the creator is not the workspace owner
  AND (w.owner_id IS NULL OR w.owner_id <> s.created_by)
  -- and holds no squad membership in this workspace other than the ones the
  -- squads they created handed them
  AND NOT EXISTS (
    SELECT 1
    FROM squad_members sm
    JOIN squads other ON other.id = sm.squad_id
    WHERE other.workspace_id = s.workspace_id
      AND sm.user_id = s.created_by
      AND (other.created_by IS NULL OR other.created_by <> s.created_by)
      AND sm.joined_at <= s.created_at
  )
  -- and is not a platform admin, who may legitimately act in any workspace
  AND NOT EXISTS (
    SELECT 1 FROM users a WHERE a.id = s.created_by AND a.is_admin = TRUE
  )
ORDER BY s.workspace_id, s.id;
```

Reading the output:

- Squads with `workspace_id` NULL are not listed. The `JOIN workspaces` drops
  them, and correctly: an orphaned squad has no workspace for its creator to be
  outside of.
- A squad in an **orphaned workspace** (`owner_id` NULL) whose creator had no
  other footing there *is* listed. That is the shape the current rule refuses,
  and it is worth an operator's eye even though it may predate the rule.
- `is_admin` is current state, not state at creation time. An account that was
  an admin when it created the squad and is not one now will be listed; an
  account promoted since will not.
- Membership is read **as of the squad's creation**, so a squad created by
  someone with no footing in that workspace stays on the list even after they
  are legitimately onboarded. That is deliberate: later onboarding does not
  retroactively authorise the creation. It also means a genuine member who
  created a squad *before* joining any other squad in that workspace is listed,
  and is one of the shapes the operator dispositions by hand.

### 2. Archives whose creator is outside the owning squad's workspace

Planting an archive writes no `squad_members` row, so this one can use the
straightforward membership test.

```sql
SELECT p.id           AS archive_id,
       p.name         AS archive_name,
       p.squad_id     AS squad_id,
       s.workspace_id AS workspace_id,
       p.created_by   AS creator_id,
       u.email        AS creator_email,
       p.created_at   AS created_at
FROM archives p
JOIN squads s ON s.id = p.squad_id
JOIN workspaces w ON w.id = s.workspace_id
LEFT JOIN users u ON u.id = p.created_by
WHERE p.created_by IS NOT NULL
  AND (w.owner_id IS NULL OR w.owner_id <> p.created_by)
  AND NOT EXISTS (
    SELECT 1
    FROM squad_members sm
    JOIN squads m ON m.id = sm.squad_id
    WHERE m.workspace_id = s.workspace_id
      AND sm.user_id = p.created_by
  )
  AND NOT EXISTS (
    SELECT 1 FROM users a WHERE a.id = p.created_by AND a.is_admin = TRUE
  )
ORDER BY s.workspace_id, p.id;
```

`system` archives (the hidden per-PR ones) have `squad_id` NULL, so the
`JOIN squads` drops them. They have no workspace either, so there is nothing to
compare a creator against.

**If query 1 returned rows, this query under-reports.** Someone who planted a
squad in a workspace *does* hold a `squad_members` row there, so any archive
they also planted in that same workspace passes the membership test above. To
see those too, add the same two exclusions query 1 uses:

```sql
      AND (m.created_by IS NULL OR m.created_by <> p.created_by)
      AND sm.joined_at <= p.created_at
```

as the last lines inside the `NOT EXISTS` above. Both are needed, for two
different alibis. The first drops the memberships the planter's own squads
handed them. The second drops memberships acquired *after* the archive was
created, so that a planter who is later onboarded legitimately does not thereby
clear the archive they planted before it: without it, one `squad_members` row
from any squad they did not create hides every archive they planted in that
workspace, which is exactly the shape query 1 guards against one level up.

Only do this after reading query 1's output, because it also reports archives
created by anyone whose only membership of a workspace came from a squad they
made themselves, or who created the archive before joining any other squad
there.

### 3. ACL grants naming a user or squad outside the archive's workspace

The four ACL columns hold JSON arrays of ids (`JSON_ARRAY(...)` on insert,
`JSON.stringify`d arrays on update), so `JSON_TABLE` expands them into rows.
Writing an ACL grant creates no `squad_members` row, so the membership test is
straightforward here as well.

**This query under-reports one shape, deliberately, and an empty result is not
proof of none.** A grantee who holds any `squad_members` row in the archive's
workspace clears the user branch, so a grant naming someone who planted a squad
there, or who was onboarded legitimately afterwards, is not listed. There is no
"as of" time to test against: an ACL grant carries no timestamp of its own.

Query 1 covers only the first half of that. It names users whose footing in a
workspace came from a squad they created themselves, so the follow-up below is
worth running for each user query 1 reports, and only for those users:

```sql
-- substitute the user id query 1 reported for <user_id>
SELECT id, name, squad_id, read_access, write_access FROM archives
WHERE JSON_CONTAINS(read_access,  CAST(<user_id> AS JSON))
   OR JSON_CONTAINS(write_access, CAST(<user_id> AS JSON));
```

**The other half is not recoverable by any of these three queries.** A grant to
someone who was onboarded into the archive's workspace legitimately *after* the
grant was written is invisible to all of them: query 3 skips them because they
now hold a `squad_members` row there, query 1 never names them because they
created nothing, query 2 is about archives rather than grants, and the
`JSON_CONTAINS` follow-up above only runs for the user ids query 1 named. An
ACL grant carries no timestamp, so there is nothing to compare a `joined_at`
against, and no rewrite of these queries fixes it. **An empty query 3 therefore
bounds nothing on its own.** If you need certainty for a particular account,
read its grants directly with the `JSON_CONTAINS` query above, substituting that
account's id whether or not query 1 reported it.

```sql
WITH acl AS (
  SELECT p.id AS archive_id, s.workspace_id AS workspace_id,
         'read_access' AS acl_column, 'user' AS grantee_kind, g.grantee_id AS grantee_id
  FROM archives p, squads s,
       JSON_TABLE(p.read_access, '$[*]' COLUMNS (grantee_id INT PATH '$')) AS g
  WHERE s.id = p.squad_id
  UNION ALL
  SELECT p.id, s.workspace_id, 'write_access', 'user', g.grantee_id
  FROM archives p, squads s,
       JSON_TABLE(p.write_access, '$[*]' COLUMNS (grantee_id INT PATH '$')) AS g
  WHERE s.id = p.squad_id
  UNION ALL
  SELECT p.id, s.workspace_id, 'read_access_squads', 'squad', g.grantee_id
  FROM archives p, squads s,
       JSON_TABLE(p.read_access_squads, '$[*]' COLUMNS (grantee_id INT PATH '$')) AS g
  WHERE s.id = p.squad_id
  UNION ALL
  SELECT p.id, s.workspace_id, 'write_access_squads', 'squad', g.grantee_id
  FROM archives p, squads s,
       JSON_TABLE(p.write_access_squads, '$[*]' COLUMNS (grantee_id INT PATH '$')) AS g
  WHERE s.id = p.squad_id
)
SELECT a.archive_id,
       p.name       AS archive_name,
       a.workspace_id,
       a.acl_column,
       a.grantee_kind,
       a.grantee_id,
       COALESCE(u.email, t.name) AS grantee_label
FROM acl a
JOIN archives p ON p.id = a.archive_id
LEFT JOIN users  u ON a.grantee_kind = 'user'  AND u.id = a.grantee_id
LEFT JOIN squads t ON a.grantee_kind = 'squad' AND t.id = a.grantee_id
WHERE a.workspace_id IS NOT NULL
  AND (
    (
      a.grantee_kind = 'squad'
      AND NOT EXISTS (
        SELECT 1 FROM squads gs
        WHERE gs.id = a.grantee_id AND gs.workspace_id = a.workspace_id
      )
    )
    OR (
      a.grantee_kind = 'user'
      AND NOT EXISTS (
        SELECT 1 FROM workspaces gw
        WHERE gw.id = a.workspace_id AND gw.owner_id = a.grantee_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM squad_members sm
        JOIN squads ms ON ms.id = sm.squad_id
        WHERE ms.workspace_id = a.workspace_id AND sm.user_id = a.grantee_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM users au WHERE au.id = a.grantee_id AND au.is_admin = TRUE
      )
    )
  )
ORDER BY a.workspace_id, a.archive_id, a.acl_column, a.grantee_id;
```

A `grantee_label` of NULL means the grant names an id that no longer exists.
Those are harmless (nothing matches them) but they are worth removing through
`POST /api/archives/:id/access` with `action: 'remove'`, which stays open to
cross-tenant grantees precisely so pre-existing grants can be revoked. **Use
that API call for them, not the UI.** `GET /api/archives/:id/access` resolves
each grantee id through a `users` / `squads` lookup and drops the misses, so a
grant naming a deleted account has no row in the modal at all.

In the UI, open **Manage Archive Access** on the archive: every explicit user
and squad grant *whose grantee still exists* is listed with a Revoke control,
sourced from `GET /api/archives/:id/access` rather than from the user search,
which is workspace-scoped and so cannot find a grantee outside the tenant. Rows
inherited from the owning squad are shown without a Revoke control, because they
hold no ACL row to remove.

**Read the row before trusting the word "revoke".** A grantee can hold the
archive by a second route the ACL entry does not own: membership of the owning
squad or of a granted squad (clauses 5 and 6 of the access fragments), or the
workspace-wide flag (clause 7). Removing the ACL row leaves all of those intact.
Such a row is marked `also inherited from ...`, its control reads **Remove
Grant** rather than Revoke, and the confirmation and the toast say the grant was
removed rather than that access was revoked. To actually take that user's access
away, change the route named on the row: their squad membership or its
`can_read` / `can_write` flags, the squad grant, or the workspace-wide flag on
the Workspace tab.

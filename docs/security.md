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
| `GET /api/users/search` | a non-admin caller sees only themselves plus users who share a workspace with them |

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
  `isSquadWorkspaceMember` answers false for everyone but an admin. All four
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
holds no `squad_members` row anywhere in that workspace once **every squad in
that workspace created by that same user** is excluded.

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
see those too, add the same exclusion query 1 uses:

```sql
      AND (m.created_by IS NULL OR m.created_by <> p.created_by)
```

as the last line inside the `NOT EXISTS` above. Only do this after reading query
1's output, because it also reports archives created by anyone whose only
membership of a workspace came from a squad they made themselves.

### 3. ACL grants naming a user or squad outside the archive's workspace

The four ACL columns hold JSON arrays of ids (`JSON_ARRAY(...)` on insert,
`JSON.stringify`d arrays on update), so `JSON_TABLE` expands them into rows.
Writing an ACL grant creates no `squad_members` row, so the membership test is
straightforward here as well, with the same caveat as query 2 for a grantee who
also planted a squad in that workspace.

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
cross-tenant grantees precisely so pre-existing grants can be revoked.

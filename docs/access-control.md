```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   ACCESS CONTROL                                                           ║
║   Layered, cascading permission resolution — one SQL fragment, 7 priorities║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Access Control

Cloud Codex uses a **layered, cascading** permission system. Access is
evaluated from broad/structural (admin → workspace ownership) down to
fine-grained (per-user JSON grants on an archive). The whole cascade resolves
in a single SQL `WHERE` fragment defined in
[`routes/helpers/ownership.js`](../cloudcodex/routes/helpers/ownership.js) —
no in-application loop, no per-step round trip.

---

## Roles and Hierarchy

```
   Super Admin
     └── Workspace Owner               (by email in workspaces.owner)
           └── Squad Owner             (role = 'owner' in squad_members)
                 └── Squad Admin       (role = 'admin')
                       └── Squad Member (role = 'member', per-flag perms)
                             └── Direct Archive Grants
                                  (read_access / write_access JSON arrays)
```

Roles higher in the chain implicitly grant everything below. There is no
group that sits between "workspace owner" and "squad member" beyond the
admin flag.

---

## Archive (Read / Write) Resolution

When checking whether a user can read or write an archive, the system OR-s
together seven conditions inside a single `EXISTS` subquery. **Any match
grants access.** The conditions, in conceptual priority order:

```
                       ┌────────────────────────────────┐
   request to read ──► │  is the user a super admin?    │ ─── yes ──► ALLOW
   or write archive    └──────────────┬─────────────────┘
                                      │ no
                                      ▼
                       ┌────────────────────────────────┐
                       │  is user.id in read_access /   │ ─── yes ──► ALLOW
                       │  write_access JSON array?      │
                       └──────────────┬─────────────────┘
                                      │ no
                                      ▼
                       ┌────────────────────────────────┐
                       │  is user the archive creator?  │ ─── yes ──► ALLOW
                       └──────────────┬─────────────────┘
                                      │ no
                                      ▼
                       ┌────────────────────────────────┐
                       │  is user the workspace owner   │ ─── yes ──► ALLOW
                       │  (squads.workspace_id →        │
                       │   workspaces.owner = email) ?  │
                       └──────────────┬─────────────────┘
                                      │ no
                                      ▼
                       ┌────────────────────────────────┐
                       │  is user a squad member with   │ ─── yes ──► ALLOW
                       │  role='owner' OR matching      │
                       │  can_read / can_write flag ?   │
                       └──────────────┬─────────────────┘
                                      │ no
                                      ▼
                       ┌────────────────────────────────┐
                       │  is user a member of any squad │ ─── yes ──► ALLOW
                       │  listed in read_access_squads /│
                       │  write_access_squads ?         │
                       └──────────────┬─────────────────┘
                                      │ no
                                      ▼
                       ┌────────────────────────────────┐
                       │  is read_access_workspace /    │ ─── yes ──► ALLOW
                       │  write_access_workspace TRUE   │
                       │  AND user in any squad in the  │
                       │  same workspace ?              │
                       └──────────────┬─────────────────┘
                                      │ no
                                      ▼
                                    DENY
```

The SQL fragments that enforce this are
`readAccessWhere(alias)` / `writeAccessWhere(alias)` (with parameters from
`readAccessParams(user)` / `writeAccessParams(user)`) in
[`routes/helpers/ownership.js`](../cloudcodex/routes/helpers/ownership.js).

Write access always requires also having read access (write implies read
in practice, since write grants are generally given alongside read grants
by the UI).

---

## Archive Ownership (Management Operations)

Destructive or management operations on an archive (delete, manage access grants) require being an **archive owner**. This check is narrower than general write access:

- Super admin
- Archive creator (`archives.created_by`)
- Workspace owner (via squad → workspace chain)
- Squad member with `role = 'owner'`

---

## Per-Log Access

Individual logs have their own `read_access` and `write_access` JSON columns as well. These are supplemental per-document grants that sit on top of archive-level access. In practice the UI mainly controls access at the archive level, but the data model supports document-level overrides.

---

## The `permissions` Table (Global Feature Flags)

Separate from access to specific content, users have a row in the `permissions` table controlling what they can *create*:

| Permission      | Effect                                       |
|-----------------|----------------------------------------------|
| `create_squad`  | Can create new squads in any workspace       |
| `create_archive`| Can create new archives                      |
| `create_log`    | Can create documents (TRUE by default)       |

These global flags are checked first. If a user lacks the global flag, the system also checks:
- Whether they are the workspace owner (bypasses all)
- Whether they have the equivalent squad-member permission (`can_create_archive`, `can_create_log`)

---

## Squad Member Permissions

When a user is added to a squad, they get a row in `squad_members` with granular boolean flags:

| Flag                  | What it controls                                     |
|-----------------------|------------------------------------------------------|
| `can_read`            | View archives and documents in this squad            |
| `can_write`           | Edit documents in this squad's archives              |
| `can_create_log`      | Create new documents                                 |
| `can_create_archive`  | Create new archives inside this squad                |
| `can_manage_members`  | Invite/remove members and update their permissions   |
| `can_delete_version`  | Delete published version snapshots                   |
| `can_publish`         | Publish a new version snapshot                       |

Flags default to the most restrictive values. When a user is invited, the inviter specifies which flags to grant. Only workspace owners and squad creators can grant `can_manage_members` or invite users as `admin`.

---

## Publish Permission

Publishing a version snapshot has its own dedicated check (`canPublish`). A user can publish if **any** of the following are true:

- The archive has no squad (personal/standalone archive) — always allowed
- Super admin
- Workspace owner
- Squad member with `can_publish = TRUE`
- Squad member with `role = 'owner'`
- Archive creator

---

## 2FA and Session Security

Session tokens are 64-character cryptographically random strings stored directly as the session `id` in the `sessions` table. They are transmitted via the `Authorization: Bearer <token>` header (or a `sessionToken` cookie for browser redirects).

When 2FA is enabled on an account:
- **Email 2FA:** After a valid password login, a 6-digit code is emailed. The session is issued only after the code is verified.
- **TOTP 2FA:** A QR code is shown enabling any authenticator app. The 6-digit TOTP is verified against the stored secret before issuing a session.

On password change, all sessions for that user except the current one are invalidated.

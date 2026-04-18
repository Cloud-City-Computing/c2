# Access Control

Cloud Codex uses a layered, cascading permission system. At most levels, access is evaluated from broad/structural (admin → workspace ownership) down to fine-grained (per-user JSON grants on an archive).

---

## Roles and Hierarchy

```
Super Admin
  └── Workspace Owner (by email in workspaces.owner)
        └── Squad Owner (role = 'owner' in squad_members)
              └── Squad Admin (role = 'admin')
                    └── Squad Member (role = 'member', per-flag permissions)
                          └── Direct Archive Grants (read_access / write_access JSON arrays)
```

Roles higher in the chain implicitly grant everything below. There is no group that sits between "workspace owner" and "squad member" beyond the admin flag.

---

## Archive (Read / Write) Resolution

When checking whether a user can read or write an archive, the system queries the following conditions in order. **The first match grants access.**

| Priority | Condition |
|----------|-----------|
| 1 | User is a **super admin** (`users.is_admin = TRUE`) |
| 2 | User's ID is in the archive's **`read_access` / `write_access`** JSON array |
| 3 | User is the **archive creator** (`archives.created_by = user.id`) |
| 4 | User is the **workspace owner** (via `squads → workspaces.owner = user.email`) |
| 5 | User is a squad member with **`role = 'owner'`** or the matching `can_read` / `can_write` flag in `squad_members` |
| 6 | User is a member of any **squad listed** in `read_access_squads` / `write_access_squads` |
| 7 | `read_access_workspace` / `write_access_workspace` is TRUE and the user is a member of any squad in the same workspace |

The SQL fragments that enforce this are defined in [`routes/helpers/ownership.js`](../cloudcodex/routes/helpers/ownership.js) (`readAccessWhere` / `writeAccessWhere`).

Write access always requires also having read access (write implies read in practice, since write grants are generally given alongside read grants by the UI).

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

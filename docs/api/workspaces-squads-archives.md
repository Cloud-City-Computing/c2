```
─── ◆ ─────────────────────────────────────────────────────────────────────
   API · Workspaces, Squads & Archives
─── ◆ ─────────────────────────────────────────────────────────────────────
```

# API Reference — Workspaces, Squads & Archives

These endpoints manage the organizational hierarchy: **Workspaces → Squads → Archives**. All require authentication.

---

## Workspaces

Workspaces are top-level containers owned by a single user (the owner's email is stored). Only admins can create workspaces.

---

### `GET /api/workspaces`

List workspaces the current user has access to. Admins see all workspaces. Regular users see workspaces where they are the owner, a squad creator, a squad member, or have access to an archive.

**Response:** `{ success: true, workspaces: [{ id, name, owner, created_at }] }`

---

### `POST /api/workspaces` *(admin only)*

Create a new workspace.

**Body**

```json
{
  "name": "Acme Corp",
  "squadName": "Engineering",   // optional — creates a squad in one step
  "archiveName": "Platform API" // optional — creates an archive if squadName given
}
```

**Response:** `{ success: true, workspaceId, squadId, archiveId }`

---

### `PUT /api/workspaces/:id`

Rename a workspace. Only the workspace owner (or admin) can do this.

**Body:** `{ name }`

---

### `DELETE /api/workspaces/:id`

Delete a workspace. Cascades to all squads, archives, and documents inside it. Owner or admin only.

---

## Squads

Squads are teams inside a workspace. They own archives and have a member roster.

---

### `GET /api/workspaces/:workspaceId/squads`

List all squads within a workspace. User must have some form of access to the workspace (ownership, membership, or archive access).

**Response:** `{ success: true, squads: [{ id, name, created_at, created_by }] }`

---

### `POST /api/workspaces/:workspaceId/squads`

Create a squad. Requires the `create_squad` permission or workspace ownership.

**Body**

```json
{
  "name": "Backend",
  "archiveName": "API Docs" // optional
}
```

The creator is automatically added as a squad owner. If the workspace is owned by a different user, that owner is also added as a squad owner.

**Response:** `{ success: true, squadId, archiveId }`

---

### `PUT /api/squads/:id`

Rename a squad. Squad creator or workspace owner only.

**Body:** `{ name }`

---

### `DELETE /api/squads/:id`

Delete a squad. Cascades to all associated archives and documents. Squad creator or workspace owner only.

---

### `GET /api/squads/:id/permissions`

Get the squad-level default permissions (`create_archive`, `create_log`). Workspace owner only.

**Response:** `{ success: true, permissions: { create_archive, create_log } }`

---

### `PUT /api/squads/:id/permissions`

Update squad-level default permissions. Workspace owner only.

**Body:** `{ create_archive?, create_log? }`

---

## Squad Members

---

### `GET /api/squads/:id/members`

List all members of a squad (their permissions and roles). Accessible to workspace owners, squad creators, and current squad members.

**Response:** `{ success: true, members: [{ id, user_id, name, email, role, can_read, can_write, can_create_log, can_create_archive, can_manage_members, can_delete_version, can_publish, joined_at }] }`

---

### `POST /api/squads/:id/members/invite`

Invite a user to the squad by their user ID. Creates a `squad_invitations` record and sends a notification email.

**Body**

```json
{
  "userId": 42,
  "role": "member",
  "can_read": true,
  "can_write": true,
  "can_create_log": false,
  "can_create_archive": false,
  "can_manage_members": false,
  "can_delete_version": false,
  "can_publish": false
}
```

Only workspace owners and squad creators can grant `can_manage_members` or invite as `admin`.

---

### `GET /api/squads/:id/invitations`

List pending invitations for a squad. Requires management access.

---

### `POST /api/squads/:id/invitations/:invitationId/respond`

Accept or decline a squad invitation.

**Body:** `{ action: 'accept' | 'decline' }`

On accept, the user is added to `squad_members` with the permissions specified in the invitation.

---

### `PATCH /api/squads/:id/members/:memberId`

Update a member's permission flags or role. Requires squad management access.

**Body:** Any combination of the boolean permission flags or `role`.

---

### `DELETE /api/squads/:id/members/:memberId`

Remove a member from the squad. Requires management access; cannot remove squad owners.

---

## Archives

Archives are document collections inside a squad. Access is controlled by layered JSON arrays on the archive itself (see [Access Control](../access-control.md)).

---

### `GET /api/archives`

List all archives the current user has read access to (across all workspaces and squads).

**Response:** `{ success: true, archives: [{ id, name, created_at, created_by, squad_name, squad_id, workspace_id, workspace_name }] }`

---

### `GET /api/archives/:archiveId/logs`

Get the full document tree for an archive (nested by `parent_id`).

**Response:** `{ success: true, logs: [ /* nested tree */ ] }`

Each node has: `{ id, title, parent_id, version, created_at, updated_at, created_by, archive_id, gh_owner, gh_repo, gh_path, gh_branch, children: [] }`

---

### `POST /api/archives`

Create a new archive. Requires the `create_archive` permission.

**Body:** `{ name, squad_id? }`

The creator is automatically added to `read_access` and `write_access`.

**Response:** `{ success: true, archiveId }`

---

### `PUT /api/archives/:id`

Rename an archive. Requires write access to the archive.

**Body:** `{ name }`

---

### `DELETE /api/archives/:id`

Delete an archive and all its documents. Requires archive ownership (creator, squad owner, or workspace owner).

---

### `GET /api/archives/:id/access`

Get the current access configuration: which users and squads have read/write access, and whether workspace-level access is enabled.

Requires read access to view. Returns explicit user grants, squad grants, workspace flags, and the inherited squad member list.

---

### `POST /api/archives/:id/access`

Add or remove an access grant. Requires archive ownership.

**Body (user grant):**
```json
{ "userId": 5, "accessType": "read", "action": "add" }
```

**Body (squad grant):**
```json
{ "squadId": 2, "accessType": "write", "action": "remove" }
```

**Body (workspace-wide):**
```json
{ "workspace": true, "accessType": "read", "action": "add" }
```

Exactly one of `userId`, `squadId`, or `workspace: true` must be provided.

---

## Archive ↔ GitHub Repository Links

Archives can be linked to one or more GitHub repositories. The links are
used by the GitHub bulk-import workflow (see
[oauth-github.md](./oauth-github.md)) and by the document-link UI to scope
which repos the user picks from when linking a single doc.

### `GET /api/archives/:archiveId/repos` *(read access required)*

List repos linked to an archive.

**Response:** `{ success: true, repos: [{ id, repo_full_name, repo_owner, repo_name, linked_by, linked_at }] }`

### `POST /api/archives/:archiveId/repos` *(archive ownership required)*

Link a GitHub repository to the archive.

**Body:** `{ repoFullName: "owner/repo-name" }`

### `DELETE /api/archives/:archiveId/repos/:repoId` *(archive ownership required)*

Remove a repository link.

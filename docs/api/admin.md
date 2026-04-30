```
─── ◆ ─────────────────────────────────────────────────────────────────────
   API · Admin Panel
─── ◆ ─────────────────────────────────────────────────────────────────────
```

# API Reference — Admin Panel

All endpoints in this section require both authentication (`requireAuth`) and super-admin status (`requireAdmin`). Regular users receive `403 Forbidden`.

The admin panel provides system-level management: user lifecycle, workspace oversight, invitations, permissions, and live server telemetry.

---

## Status Check

### `GET /api/admin/status`

Returns whether the currently authenticated user is an admin. Safe to call for any authenticated user.

**Response:** `{ success: true, isAdmin: boolean }`

---

## Workspace Management

### `GET /api/admin/workspaces`

List all workspaces in the system with aggregate statistics.

**Response**

```json
{
  "success": true,
  "workspaces": [
    {
      "id": 1,
      "name": "Acme Corp",
      "owner": "alice@acme.com",
      "created_at": "...",
      "squad_count": 3,
      "member_count": 12
    }
  ]
}
```

---

### `POST /api/admin/workspaces`

Create a workspace and assign it to any registered user by email.

**Body**

```json
{
  "name": "New Corp",
  "ownerEmail": "bob@example.com",
  "squadName": "Engineering",      // optional
  "archiveName": "API Docs"        // optional, requires squadName
}
```

The specified owner must already have a user account.

**Response:** `{ success: true, workspaceId, squadId, archiveId }`

---

### `DELETE /api/admin/workspaces/:id`

Delete a workspace and all of its contents (squads, archives, documents). **Irreversible.**

---

## User Management

### `GET /api/admin/users`

List all registered users.

**Response**

```json
{
  "success": true,
  "users": [
    {
      "id": 2,
      "name": "bob",
      "email": "bob@example.com",
      "avatar_url": "/avatars/bob.jpg",
      "is_admin": false,
      "created_at": "...",
      "squad_count": 2
    }
  ]
}
```

---

### `DELETE /api/admin/users/:id`

Delete a user account. Cannot delete your own account or another admin account.

---

### `GET /api/admin/users/:id/permissions`

Get the global permission flags for a user (`create_squad`, `create_archive`, `create_log`).

---

### `PUT /api/admin/users/:id/permissions`

Update global permission flags for a user.

**Body:** `{ create_squad?, create_archive?, create_log? }`

---

## Invitations

New users require an admin-issued invitation to register. Invitations expire after 7 days.

### `GET /api/admin/invitations`

List all invitations (pending and accepted).

**Response:** `{ success: true, invitations: [{ id, email, accepted, created_at, expires_at, invited_by_name }] }`

---

### `POST /api/admin/invitations`

Send an invitation email to a new user. The email must not belong to an existing account or an existing pending invitation.

**Body:** `{ email }`

The invitation email contains a signup link with a `?invite=<token>` query parameter that the sign-up form uses.

**Response:** `201` with `{ success: true, message }` on success; `409` if already invited/registered.

---

### `DELETE /api/admin/invitations/:id`

Revoke/cancel an invitation.

---

## Server Telemetry

### `GET /api/admin/presence`

Returns real-time data about active WebSocket connections from the collaborative editing service.

**Response**

```json
{
  "success": true,
  "presence": {
    "activeDocuments": 3,
    "totalConnections": 7,
    "documents": {
      "42": [
        { "id": 1, "name": "alice", "color": "#4a90e2" }
      ]
    }
  }
}
```

---

## Admin Super User Bootstrap

On server startup, `ensureAdminUser()` is called before the HTTP server begins accepting requests. It reads `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_EMAIL` from environment variables and either creates the admin user or syncs their credentials if the account already exists. This means the admin password is always controlled by the `.env` file and is re-applied on every restart.

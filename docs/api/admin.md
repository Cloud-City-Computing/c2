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

List all registered users. `has_totp_secret` is derived (`totp_secret IS NOT
NULL`) and never carries the secret itself: it tells the admin console
whether a user has an unconfirmed authenticator-app setup so the Reset 2FA
button is reachable even while `two_factor_method` is still `'none'`.

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
      "two_factor_method": "none",
      "has_totp_secret": false,
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

### `POST /api/admin/users/:id/2fa/reset`

Clear a user's two-factor enrolment. The recovery path for a locked-out
account: every 2FA code (login for email 2FA, disable-confirmation for
either method) travels by email, so on a mail-less instance a user with
email 2FA cannot log in, disable 2FA, or reset their password. This is the
only self-service-free repair short of editing the database directly.

Clears everything that keeps the account enrolled or mid-flow:
- `users.two_factor_method` back to `'none'` and `users.totp_secret` to `NULL`.
- All `two_factor_codes` rows for the user (login and disable-confirmation codes).
- Unused `password_reset_tokens` rows for the user. `POST /2fa/enable` and
  `POST /2fa/disable` both reuse this table for their short-lived
  `setupToken`/`confirmToken` (there is no dedicated table), so this is
  also where an abandoned setup or disable confirmation lingers.

Always clears state, even if `two_factor_method` is already `'none'`: a
user can have an unconfirmed `totp_secret` written by `/2fa/enable` without
the method ever having changed.

Notifies the affected user in-app (`services/notifications.js`,
type `admin_2fa_reset`) so they know their 2FA was reset if they didn't
expect it; self-suppressed when an admin resets their own account. The
email leg of that notification is a no-op (no `email-templates.js`
builder for the type) by design, since the in-app inbox is the channel
this recovery path exists to not depend on mail for.

**Response:** `{ success: true, message }`; `404` if the user does not exist.

---

## Invitations

New users require an admin-issued invitation to register. Invitations expire after 7 days.

### `GET /api/admin/invitations`

List all invitations (pending and accepted).

**Response:** `{ success: true, invitations: [{ id, email, accepted, created_at, expires_at, invited_by_name }] }`

---

### `POST /api/admin/invitations`

Invite a new user. The email must not belong to an existing account or an existing pending invitation.

**Body:** `{ email }`

The invitation is always created and its signup link (a `?invite=<token>` query
parameter the sign-up form reads) is always returned in the response, so the
link is usable even when no mail is sent. Email delivery is best-effort:
if the instance has no mail server configured, sending is skipped; if
sending fails, the failure is logged and does not fail the request.

**Response:** `201` with
`{ success: true, message, signup_url, emailed }` on success (`emailed` is
`true` only if the invitation email was actually sent); `409` if already
invited/registered.

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

On server startup, `ensureAdminUser()` reads `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_EMAIL` from environment variables and either creates the admin user or syncs their credentials if the account already exists. This means the admin password is always controlled by the `.env` file and is re-applied on every restart.

Right after, `bootstrapInstance(adminId)` seeds a starter workspace: a workspace owned by `ADMIN_EMAIL`, a "General" squad with the admin as its owner member, a "Getting Started" archive, and a "Welcome to Cloud Codex" document. All five writes share one transaction, so a failure partway leaves nothing behind.

It runs only when the database holds **no workspaces, archives or logs at all**. Workspaces alone are not a safe guard: deleting the last workspace leaves orphaned archives and logs behind (`archives.squad_id` is `ON DELETE SET NULL`), and seeding alongside those would drop a second "Getting Started" onto a populated install. So it no-ops on every later boot, and an install with any content is never touched. A failed seed is logged, not fatal: the instance comes up empty and the next restart retries.

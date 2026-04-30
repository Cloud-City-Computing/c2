```
─── ◆ ─────────────────────────────────────────────────────────────────────
   API · Notifications (Inbox · Badge · Preferences)
─── ◆ ─────────────────────────────────────────────────────────────────────
```

# API Reference — Notifications

Reads and writes are scoped to `req.user.id` — a user can only ever see or
mark their own notifications. There is no admin-side bulk surface here;
admins' inboxes are owned by their personal user record like everyone else.

For the conceptual model (fan-out, coalescing, channels), see
[../notifications.md](../notifications.md).

All routes require auth.

---

## Inbox

### `GET /api/notifications`

List the caller's notifications, newest first. Cursor-paginated via
`before`.

**Query params**

| Param     | Type     | Default | Notes                                              |
|-----------|----------|---------|----------------------------------------------------|
| `limit`   | int      | `20`    | Clamped to `[1, 100]`                              |
| `before`  | ISO date | —       | Returns rows with `created_at < before`            |
| `unread`  | `1`/`true` | —     | If set, only unread rows                           |

**Response**

```json
{
  "success": true,
  "results": [
    {
      "id": 42,
      "user_id": 7,
      "type": "mention",
      "actor_id": 3,
      "actor_name": "alice",
      "actor_avatar": "/avatars/3.webp",
      "title": "alice mentioned you in “Onboarding”",
      "body": "…hi @bob, can you …",
      "link_url": "/editor/12#comment-99",
      "resource_type": "log",
      "resource_id": 12,
      "metadata": null,
      "read_at": null,
      "created_at": "2026-04-29T17:14:21.000Z"
    }
  ]
}
```

To paginate the next page, pass the oldest `created_at` from the previous
page as `?before=…`.

---

### `GET /api/notifications/unread-count`

Returns the number of unread notifications for the caller. Powers the
top-bar bell badge.

**Response:** `{ success: true, count: 3 }`

---

### `POST /api/notifications/:id/read`

Mark a single notification read. Idempotent — re-marking a read row is a
no-op. Pushes `{type:'read', id}` over `/notifications-ws` so the badge
in other tabs decrements live.

**Errors:** `400` if `id` is not a positive integer.

---

### `POST /api/notifications/read-all`

Mark all of the caller's unread notifications read. Pushes
`{type:'read_all'}` over `/notifications-ws`.

---

## Preferences

Per-type **email** opt-in/out. In-app inbox delivery is always on; these
preferences only affect the email channel.

### `GET /api/notifications/preferences`

Returns the caller's effective preferences (defaults merged with stored
overrides).

**Response**

```json
{
  "success": true,
  "prefs": {
    "email_mention": true,
    "email_comment_on_my_doc": true,
    "email_watched_comment": true,
    "email_watched_publish": true,
    "email_watched_log_update": false,
    "email_squad_invite": true
  }
}
```

### `PUT /api/notifications/preferences`

Update one or more preferences. Only known keys are accepted; only boolean
values are accepted; unknown or non-boolean values are silently dropped.
The response returns the merged effective preferences after the update.

**Body example**

```json
{
  "email_watched_log_update": true,
  "email_squad_invite": false
}
```

**Response:** the same shape as the `GET`, reflecting the new state.

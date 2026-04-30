```
─── ◆ ─────────────────────────────────────────────────────────────────────
   API · Activity Stream & Watches
─── ◆ ─────────────────────────────────────────────────────────────────────
```

# API Reference — Activity & Watches

Two related surfaces that together drive the workspace activity feed and
the notifications fan-out.

- **Activity** — read-only chronological feed of events in a workspace.
  Filtered at query time so a user only sees rows whose underlying
  resource (log, archive, comment, version) they can read.
- **Watches** — per-user subscriptions that opt the caller into
  notifications about activity on a specific log or archive.

All routes require auth.

---

## Activity

### `GET /api/activity`

Workspace-scoped activity feed. The caller must have any access to the
workspace (admin, owner, or member of any squad in it). Within that, the
returned rows are filtered through `ownership.js` so log/archive/comment/
version events are only included if the caller can read them.

**Query params**

| Param           | Type     | Default | Notes                                    |
|-----------------|----------|---------|------------------------------------------|
| `workspace`     | int      | —       | **required** — the workspace ID          |
| `limit`         | int      | `50`    | Clamped to `[1, 200]`                    |
| `before`        | ISO date | —       | Returns rows with `created_at < before`  |
| `action_prefix` | string   | —       | Filter by action prefix, e.g. `comment.` |

**Response**

```json
{
  "success": true,
  "results": [
    {
      "id": 9213,
      "workspace_id": 1,
      "squad_id": 4,
      "user_id": 3,
      "actor_name": "alice",
      "actor_avatar": "/avatars/3.webp",
      "action": "log.published",
      "resource_type": "log",
      "resource_id": 88,
      "metadata": { "version": 7 },
      "created_at": "2026-04-29T16:02:11.000Z"
    }
  ]
}
```

**Errors**

| Code | Cause                                                       |
|------|-------------------------------------------------------------|
| 400  | `workspace` missing or not a valid ID                       |
| 403  | Caller has no access to the workspace                       |

---

### `GET /api/activity/log/:logId`

Single-document activity. Returns events directly on the log plus optional
related comments and versions. Read access on the log is required (`403`
otherwise).

**Query params**

| Param                | Type   | Default | Notes                                |
|----------------------|--------|---------|--------------------------------------|
| `limit`              | int    | `50`    | Clamped to `[1, 200]`                |
| `include_comments`   | `0`/-  | include | Pass `0` to exclude comment events   |
| `include_versions`   | `0`/-  | include | Pass `0` to exclude version events   |

**Response:** same shape as `/api/activity`, minus `workspace_id` /
`squad_id`.

---

## Watches

A watch links a user to a `log` or `archive`. Activity events on a watched
resource fan out to per-user notifications via the activity helpers.

### `GET /api/watches`

List the caller's watches. Each row resolves the resource's display name
in a single query.

**Response**

```json
{
  "success": true,
  "watches": [
    {
      "id": 14,
      "resource_type": "log",
      "resource_id": 88,
      "resource_name": "Onboarding",
      "source": "manual",
      "created_at": "2026-04-15T09:11:02.000Z"
    },
    {
      "id": 15,
      "resource_type": "archive",
      "resource_id": 7,
      "resource_name": "Cloud Infrastructure",
      "source": "manual",
      "created_at": "2026-04-12T11:00:00.000Z"
    }
  ]
}
```

`source` is `"manual"` if the user toggled the watch from the UI, or
`"auto"` (with a tag like `"mention"`) when it was added implicitly by
another action.

---

### `GET /api/watches/:type/:id`

Whether the caller is currently watching a specific resource.

**Path params:** `:type` ∈ {`log`, `archive`}; `:id` is a positive int.

**Response:** `{ success: true, watching: true, source: "manual" }` —
`source` is `null` when `watching` is `false`.

---

### `POST /api/watches`

Create or replace a manual watch. **Idempotent** — re-posting an existing
watch returns success. Setting `source` to `"manual"` always; an existing
auto-watch becomes manual after this call.

**Body**

```json
{ "resourceType": "log", "resourceId": 88 }
```

`resourceType` ∈ {`log`, `archive`}.

**Errors**

| Code | Cause                                                   |
|------|---------------------------------------------------------|
| 400  | Bad `resourceType` or non-integer `resourceId`           |
| 403  | Caller does not have read access to the target resource |

---

### `DELETE /api/watches/:type/:id`

Remove a watch. **Idempotent** — deleting a non-existent watch returns
success.

**Response:** `{ success: true, watching: false }`

```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   NOTIFICATIONS                                                            ║
║   One funnel, three channels, sixty-second coalescing.                     ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Notifications Subsystem

Cloud Codex routes every user-facing alert — mentions, comments on watched
docs, watched-doc edits and publishes, squad invitations — through a single
service: `cloudcodex/services/notifications.js`. That service owns
**persistence + WebSocket push + email**, and it applies the rules that keep
a busy team from drowning in their own activity.

This doc covers the **conceptual model**. For the HTTP API, see
[api/notifications.md](./api/notifications.md). For the runtime details
(file paths, exported functions, hardening), see
[services.md](./services.md).

---

## The funnel

Every alert resolves through `createNotification()`:

```
   source event  (mention, comment, publish, squad invite, watched-doc edit)
        │
        ▼
   createNotification({recipientId, actorId, type, title, body, linkUrl,
                       resourceType, resourceId, metadata, emailData})
        │
        ├─► self-suppression
        │     actorId === recipientId   →  drop
        │
        ├─► coalesce (60 s window)
        │     existing row with same
        │     (recipient, type, resource_type, resource_id) → drop
        │
        ├─► sanitize
        │     sanitizeHtml(title) → strip tags → 255 chars
        │     sanitizeHtml(body)  → 2 000 chars
        │
        ├─► INSERT notifications  ─────────────────► MySQL row (one)
        │
        ├─► broadcastToUser(recipientId, …)  ─────► every open tab
        │       (via services/user-channel.js, /notifications-ws)
        │
        └─► deliverEmail(recipientId, type, emailData)
                │
                ├─► getRecipient → email + notification_prefs
                │
                ├─► shouldEmail(prefs, type)?  (defaults below)
                │
                ├─► buildNotificationEmail(type, data)
                │       (services/email-templates.js)
                │
                └─► sendEmail({to, subject, text, html})
                        (services/email.js → Nodemailer / SMTP)
```

Three channels, one call. Each channel can fail independently — the
WebSocket push and the email send are fire-and-forget; the DB write is the
source of truth. If a recipient has no open tab, the WS push is a no-op
(0 sockets) — they will see the row when they next load `/notifications`.

---

## Why coalesce?

Several real workflows produce a flurry of small events: a user types and
publishes a quick edit ten times in a minute, a team back-and-forths on a
comment thread for sixty seconds, an automated reformat touches every doc
in an archive. Without coalescing, every recipient's inbox would record
ten near-identical entries.

The rule is intentionally narrow: **same (recipient, type,
resource_type, resource_id) within 60 s → drop**. Different docs do not
coalesce against each other; different alert types on the same doc do
not coalesce against each other. The window is short enough that
"new" events still feel new, but long enough that quick repeats fold
into one entry.

Coalescing only applies to types that supply both `resource_type` and
`resource_id`. Resource-less alerts (e.g. squad invitations) always
create a row.

---

## Trigger catalog

These are the types currently emitted. Adding a new type is a four-step
change: pick a name, call `createNotification()` from the source, define
the email template (or skip it), set a sensible default in
`DEFAULT_EMAIL_PREFS`.

| Type                  | Source                                | Default email | Auto-watches the doc? |
|-----------------------|---------------------------------------|---------------|------------------------|
| `mention`             | `@user` in editor (`routes/helpers/mentions.js`) | on  | yes |
| `comment_on_my_doc`   | new comment on a doc you authored     | on            | (already author)        |
| `watched_comment`     | new comment on a watched doc          | on            | already watching        |
| `watched_publish`     | new version published on a watched doc | on           | already watching        |
| `watched_log_update`  | watched doc edited                    | **off**       | already watching        |
| `squad_invite`        | invited to a squad                    | on            | n/a                     |

> The `watched_log_update` default is off intentionally — even with the
> 60 s coalesce, edit-storms on a watched doc would otherwise dominate
> a user's inbox. Users who specifically want edit alerts can flip it on.

---

## Preferences

Per-type **email** opt-in/out lives in `users.notification_prefs` (JSON,
nullable). A NULL value means "use defaults"; a JSON object overrides
per-key. The wire surface is:

```
GET  /api/notifications/preferences  →  {success, prefs:{email_<type>:bool}}
PUT  /api/notifications/preferences  ←  {email_<type>: bool, ...}
```

Only known keys are persisted (whitelist), and only boolean values are
accepted. The merge function applies defaults on top of stored values so
brand-new types get sensible behavior without a migration.

In-app inbox delivery is **always on**. Preferences only control the
email channel. The bell icon and the `/notifications` page reflect every
non-coalesced, non-self alert regardless of email preference.

---

## Watches as the fan-out source

The `watches` table is the link between an actor's action and a recipient's
inbox. A user watches a log or an archive (manually from the doc UI, or
automatically when they're mentioned). When something happens on a watched
resource, the activity helpers iterate watchers and call
`createNotification()` for each.

```
   actor publishes log L
        │
        ├─► routes/helpers/activity.js logs the event
        │
        └─► fan-out:
                SELECT user_id FROM watches WHERE resource_type='log'
                                              AND resource_id = L.id
                  AND user_id <> actor.id
                  ─►  for each watcher:
                          createNotification({recipientId,
                                              type:'watched_publish', …})
                                │
                                └─► self-suppress / coalesce / persist / push
```

---

## Push channel: `/notifications-ws`

A user holds **one connection per open tab** to `/notifications-ws`,
authenticated by their session token (sent as the first message). The
channel is push-only; the server emits:

```
   {type:'connected',     userId}                  on auth success
   {type:'notification',  notification: {…row…}}   on a new alert
   {type:'unread_count',  count}                   on demand
   {type:'read',          id}                      on markRead
   {type:'read_all'}                               on markAllRead
```

Hardening (see [services.md](./services.md) for full details): same-origin
only, 5 s auth timeout, 10 simultaneous connections per user.

---

## Operational notes

- The email send and WS push are fire-and-forget. If SMTP is briefly down,
  the notification row still exists; the user will see it in-app.
- The `services/notifications.js` test suite (`tests/services/
  notifications.test.js`) covers self-suppression, coalescing, and prefs
  merging behaviour. Coverage threshold is 90 / 88 / 80 / 88 — keep it
  there if you change the file.
- A future failure to deliver (e.g. SMTP outage) is **not retried**.
  This is intentional: notifications are best-effort. If you need a
  transactional email guarantee for a specific event, use the email
  service directly from a route handler, not via `createNotification()`.

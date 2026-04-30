```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   BACKEND SERVICES                                                         ║
║   Long-lived runtime modules: collab, notifications, email, DB pool.       ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Backend Services

Cloud Codex runs in a single Node process. Five services live alongside the
Express routers and own the long-lived runtime: real-time collab,
notifications, the user-scoped WebSocket channel, email delivery, and email
templates. Plus the MySQL pool and the auth/permission middleware that every
route depends on.

```
       request path           background path
            │                      │
            ▼                      ▼
   ┌────────────────┐    ┌────────────────────┐
   │ Express routes │    │ services/collab.js │  WS  /collab/:logId
   │  (HTTP / JSON) │    │  Yjs CRDT sync     │  ──► clients
   └───────┬────────┘    └─────────┬──────────┘
           │                        │ debounced ydoc_state save
           │                        ▼
           │              ┌────────────────────┐
           │              │ mysql_connect.js   │
           │              │  c2_query() + pool │
           │              └────────────────────┘
           │                        ▲
           ▼                        │
   ┌────────────────────────┐       │
   │ services/              │       │
   │   notifications.js     ├───────┘  persist + read prefs
   │   user-channel.js (WS) │
   │   email.js  (SMTP)     │  ──►  recipient inbox / browser tabs / email
   │   email-templates.js   │
   └────────────────────────┘
```

---

## Collaborative Editing Service

**File:** `cloudcodex/services/collab.js`

Powers real-time multi-user document editing. Runs a WebSocket server attached
to the same HTTP server instance as the Express API (no separate port).

### Technology

- **[Yjs](https://yjs.dev/)** — CRDT (Conflict-free Replicated Data Type)
  library. Handles concurrent edits and automatic merge resolution. Think of
  it as a shared data structure that multiple clients can modify
  independently and then sync without conflicts.
- **[y-protocols](https://github.com/yjs/y-protocols)** — Binary sync protocol
  over WebSocket for efficient Yjs state transfer.
- **[Tiptap](https://tiptap.dev/)** (client-side) — ProseMirror-based rich
  text editor configured with the `@tiptap/extension-collaboration`
  extension. The frontend Tiptap instance maintains the Yjs `Y.Doc` locally
  and syncs it with the server.

### Connection Lifecycle

```
   client                           server                          MySQL
   ──────                           ──────                          ─────

   open WS  ──────────────────────►
   /collab/:logId?token=…
                                    validate session token
                                    check archive read access
                                    load or create Y.Doc            ydoc_state
                                                                   ◄────────
                                    sync protocol handshake
                              ◄──── send server state
                              ────► send client state
                                    awareness broadcast (presence)

   live edits ─────► broadcast to all other clients (binary update)
                                    │
                                    ▼ debounce 3 s of inactivity
                                    write ydoc_state ─────────────► (UPDATE)

   client closes ───────────────────► awareness broadcast (gone)
                                    │
                                    │ if last user, 30 s cleanup
                                    ▼ destroy Y.Doc from memory
```

1. A client opens a WebSocket to `/collab/:logId?token=<sessionToken>`.
2. The server validates the session token and checks that the user has
   **read access** to the archive containing that log.
3. Write permission is determined and attached to the connection. Read-only
   clients receive sync updates but their edits are rejected server-side.
4. An in-memory `Y.Doc` is loaded for the `logId` (or created if it doesn't
   exist yet). Initial CRDT state is loaded from `logs.ydoc_state` in MySQL.
5. The Yjs sync protocol runs: the server sends its current state to the new
   client, and the client sends its state to the server. Yjs merges both
   sides automatically.
6. A **presence** (awareness) message is broadcast to all other connected
   users showing the new user has joined (name, avatar, a randomly assigned
   color for cursor rendering).

### Live Editing

- Every mutation a client makes to the `Y.Doc` is broadcast to all other
  connected clients (except the sender) as a binary Yjs update message.
- The server also listens to `Y.Doc` mutations and schedules a **debounced
  save** (3 seconds of inactivity) that writes the binary CRDT state back
  to `logs.ydoc_state`. This ensures the document can be restored after a
  server restart without losing recent edits.
- **HTML content** is *not* written to the database by the WebSocket service.
  Only `ydoc_state` is saved via the collab service. `html_content` is
  written by the REST `POST /api/save-document` endpoint (triggered by the
  frontend's autosave) and on publish.

### Connection Cleanup

- When a user disconnects, an awareness broadcast notifies remaining users.
- If all users leave a document, a 30-second cleanup timer fires that
  destroys the `Y.Doc` from memory (after flushing any pending saves).

### Limits & Safety

| Limit                          | Value                              |
|--------------------------------|------------------------------------|
| Max WebSocket message size     | 5 MB                               |
| Max HTML content (on save)     | 2 MB                               |
| Debounce before DB save        | 3 seconds                          |
| Cleanup delay after last user  | 30 seconds                         |
| Max simultaneous WS per user   | 10 connections                     |
| Rate limit (messages/second)   | 60 messages per 1 second window    |

### Presence API

The collab service exposes two functions used by other parts of the server:

- **`getAllPresence()`** — Returns a map of `logId → [{ id, name,
  avatar_url, color }]` for all actively connected documents. Used by the
  Admin API's telemetry endpoint and by the search/browse APIs to annotate
  results with live editing indicators.
- **`getActiveDocCount()`** — Returns the number of documents currently held
  in memory.

---

## Notification Service

**File:** `cloudcodex/services/notifications.js`

The single funnel for every user-facing alert: mentions, comments on watched
docs, watched-doc edits/publishes, squad invitations. Owns persistence, push
delivery, optional email, and the rules that prevent floods.

### How a notification fans out

```
  source event (mention, comment, publish, …)
        │
        ▼
  createNotification({recipientId, actorId, type, …})
        │
        ├─► self-suppression       (actor === recipient → drop)
        │
        ├─► coalesce window        (same recipient+type+resource within 60 s
        │                           already exists → drop)
        │
        ├─► sanitize title/body    (sanitizeHtml + strip tags + truncate)
        │
        ├─► INSERT notifications   ─────────────────► MySQL row
        │
        ├─► broadcastToUser(WS)    ─────────────────► open browser tabs
        │   (services/user-channel.js)
        │
        └─► deliverEmail()         (look up prefs; default ON for most types
                                    except watched_log_update)
                │
                ▼
            buildNotificationEmail(type, data)
                │  (services/email-templates.js)
                ▼
            sendEmail({to, subject, text, html})
                │  (services/email.js)
                ▼
            recipient inbox
```

### Defaults

A user with `users.notification_prefs IS NULL` receives email for these
types out of the box; a user with a JSON prefs object overrides per-key:

| Type                       | Default email |
|----------------------------|---------------|
| `mention`                  | on            |
| `comment_on_my_doc`        | on            |
| `watched_comment`          | on            |
| `watched_publish`          | on            |
| `watched_log_update`       | **off**       |
| `squad_invite`             | on            |

In-app inbox delivery is always on — preferences only control email.

### Public surface

| Function                                     | Purpose                              |
|----------------------------------------------|--------------------------------------|
| `createNotification(args)`                   | The fan-out entrypoint               |
| `markRead(id, userId)`                       | Idempotent; pushes `{type:'read'}`   |
| `markAllRead(userId)`                        | Pushes `{type:'read_all'}`           |
| `getUnreadCount(userId)`                     | Powers the bell badge                |
| `listForUser(userId, {limit,before,unreadOnly})` | Cursor-paginated inbox           |
| `getPrefs(userId)` / `setPrefs(userId,p)`    | Merge with defaults; whitelisted keys|

See [notifications.md](./notifications.md) for the conceptual deep-dive and
[api/notifications.md](./api/notifications.md) for the HTTP surface.

---

## User-Channel WebSocket Service

**File:** `cloudcodex/services/user-channel.js`

Push-only WebSocket distinct from the doc-keyed `/collab` channel. A user
holds **one connection here** regardless of which document they have open;
the notification service uses this channel to deliver inbox updates to all
of that user's open tabs at once.

### Protocol

```
   client                                     server
   ──────                                     ──────
   open WS /notifications-ws  ──────────────►
                                              start 5 s auth timer
   {type:'auth', token:'<sessionToken>'} ───►
                                              validateAndAutoLogin(token)
                                              cap: 10 connections per user
                              ◄────────────── {type:'connected', userId}

                              ◄────────── {type:'notification', notification}
                              ◄────────── {type:'unread_count', count}
                              ◄────────── {type:'read', id}
                              ◄────────── {type:'read_all'}
```

### Hardening

- **Same-origin only** (CSWSH protection): the `Origin` header host must
  match the request `Host`; otherwise the upgrade is refused with `403`.
- **Auth timeout**: an unauthenticated client is closed after 5 s.
- **Connection cap**: 10 concurrent WebSockets per user.
- **No client→server messages after auth** — this is a push-only channel.

### Helpers exported

| Function                       | Use                                  |
|--------------------------------|--------------------------------------|
| `setupUserChannelServer(http)` | Attach to the existing HTTP server   |
| `broadcastToUser(userId, msg)` | Send JSON to all of a user's tabs    |
| `getConnectedUserCount()`      | Diagnostics                          |
| `isUserConnected(userId)`      | Diagnostics                          |

---

## Email Templates

**File:** `cloudcodex/services/email-templates.js`

Builds the `{ subject, text, html }` payload for each notification type the
Notification Service knows how to email. Renders with a small shared shell
(heading, intro, optional snippet quote, CTA button, footer with manage-
notifications link).

Templates currently registered:

| Type                  | Subject pattern                                       |
|-----------------------|-------------------------------------------------------|
| `mention`             | `[Cloud Codex] {actor} mentioned you in “{doc}”`      |
| `comment_on_my_doc`   | `[Cloud Codex] {actor} commented on “{doc}”`          |
| `watched_log_update`  | `[Cloud Codex] {actor} edited “{doc}”`                |
| `watched_publish`     | `[Cloud Codex] {actor} published “{doc}”`             |
| `watched_comment`     | `[Cloud Codex] {actor} commented on “{doc}”`          |

`buildNotificationEmail(type, data)` returns `null` for unknown types so the
notification service skips sending an email for those (in-app inbox still
fires).

All user-supplied values are HTML-escaped before they reach the template
output.

---

## Email Service

**File:** `cloudcodex/services/email.js`

A thin wrapper around [Nodemailer](https://nodemailer.com) for sending
transactional emails. Configured entirely via environment variables.

**Required env:** `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`
**Optional:** `SMTP_PORT` (default 587), `SMTP_FROM`

A TLS connection is automatically used when `SMTP_PORT` is 465.

### `sendEmail({ to, subject, text?, html?, from? })`

Sends a single email. Security notes:
- `to`, `subject`, and `from` headers are validated to reject strings
  containing newline characters, which would allow
  [header injection attacks](https://owasp.org/www-community/attacks/Mail_header_injection_attack).
- The `Precedence: bulk` header is set on all outgoing mail to reduce
  auto-responder loops.

### Where it's used

```
   trigger                  caller
   ──────────────────────   ──────────────────────────────────────
   user invitation          routes/admin.js
   password reset           routes/auth.js
   email 2FA code           routes/auth.js
   squad invitation         routes/squads.js
   mention                  services/notifications.js  (mention)
   comment on my doc        services/notifications.js  (comment_on_my_doc)
   comment on watched doc   services/notifications.js  (watched_comment)
   watched doc edited       services/notifications.js  (watched_log_update)
   watched doc published    services/notifications.js  (watched_publish)
```

### `verifyEmailConnection()`

Called once at server startup. Attempts a connection to the SMTP server and
returns `true`/`false`. If it returns `false`, the server exits immediately
with an error — SMTP is a hard dependency.

---

## Database Connection Module

**File:** `cloudcodex/mysql_connect.js`

Manages the MySQL connection pool and the session token lifecycle.

### Connection Pool

Uses `mysql2/promise` with:
- Pool size: 10 connections
- Infinite queue (`queueLimit: 0`)
- Waits for a connection to become available rather than failing immediately

The pool is created at module load time. `DB_USER` and `DB_PASS` env vars
are required; the process exits if they're missing.

### Key Functions

#### `c2_query(sql, params)`

A simple wrapper around `pool.execute()`. Always uses parameterized queries
— SQL strings are never constructed by string concatenation with user input
anywhere in the codebase.

#### `generateSessionToken(user, ip, userAgent)`

Manages session creation with a "one session per user" model:
1. If the user has an existing non-expired session, it is reused (metadata
   updated).
2. If the session is expired, the token is rotated in place (same row, new
   token).
3. If no session exists, a new one is inserted.

Tokens are 64-character random alphanumeric strings generated using
`crypto.getRandomValues`.

#### `validateAndAutoLogin(sessionToken)`

Looks up a session token, checks expiry, and returns the associated `user`
object (`id`, `name`, `email`, `avatar_url`, `is_admin`) or `null`. Called
on every authenticated request by the `requireAuth` middleware.

#### `touchSession(sessionToken)`

Updates `last_active_at` on the session row. Called asynchronously on every
authenticated request (fire-and-forget — errors are swallowed so they don't
affect the response).

---

## Middleware

**File:** `cloudcodex/middleware/auth.js`

### `requireAuth`

Reads the session token from the `Authorization: Bearer <token>` header, or
falls back to the `sessionToken` cookie (for OAuth browser redirects). Calls
`validateAndAutoLogin` and attaches the user object to `req.user`. Returns
`401` if the token is missing or invalid.

### `requireAdmin`

Must be used after `requireAuth`. Returns `403` if `req.user.is_admin` is
not true.

---

**File:** `cloudcodex/middleware/permissions.js`

### `loadPermissions`

Fetches the user's global permission flags from the `permissions` table and
attaches them to `req.permissions`. Used in routes that need to make
multiple permission decisions without repeated DB queries.

### `requirePermission(permission)`

Returns Express middleware that:
1. Returns `next()` immediately for admins.
2. Checks the user's global `permissions` row.
3. If global permission is missing, falls back to checking squad-level
   permissions (`squad_members` flags) when a `squad_id` can be inferred
   from the request context.
4. Returns `403` if no grant is found.

---

## Route Helpers

**File:** `cloudcodex/routes/helpers/shared.js`

Shared utilities used across all route files:

- **`sanitizeHtml(html)`** — Runs DOMPurify server-side to strip XSS
  vectors. Allows `data:` URIs on `img` tags (for pasted images), denies
  all other dangerous patterns.
- **`asyncHandler(fn)`** — Wraps an async route handler so that rejected
  promises are forwarded to Express's `next(err)` error pipeline instead
  of hanging.
- **`isValidId(id)`** — Confirms a value is a positive integer (guards
  against injection via ID params).
- **`canPublish(squadId, archiveCreatorId, user)`** — Async helper that
  checks the full publish permission chain.
- **`checkLogReadAccess(logId, user)`** /
  **`checkLogWriteAccess(logId, user)`** /
  **`checkArchiveReadAccess(archiveId, user)`** — Convenience wrappers
  for the archive-level access SQL checks, used in comment, version, and
  watch routes.

**File:** `cloudcodex/routes/helpers/ownership.js`

- **`readAccessWhere(alias)`** / **`writeAccessWhere(alias)`** — Returns a
  SQL `WHERE` fragment for access checking. Takes 7 positional parameters
  via `readAccessParams(user)` / `writeAccessParams(user)`.
- **`isArchiveOwner(user, archiveId)`** — Async check for management-level
  ownership.

**File:** `cloudcodex/routes/helpers/images.js`

- **`extractImagesFromHtml(html)`** — Scans HTML for base64-encoded `<img>`
  tags, writes them to disk under `public/doc-images/`, and replaces the
  `src` with a served URL. This prevents large binary blobs from being
  stored in MySQL and speeds up document loads.
- **`inlineImagesForExport(html)`** /
  **`inlineImagesForMarkdownExport(html)`** — Re-embeds served images back
  as base64 for self-contained DOCX/Markdown exports.

# Backend Services

---

## Collaborative Editing Service

**File:** `cloudcodex/services/collab.js`

This service powers real-time multi-user document editing. It runs a WebSocket server attached to the same HTTP server instance as the Express API (no separate port needed).

---

### Technology

- **[Yjs](https://yjs.dev/)** — CRDT (Conflict-free Replicated Data Type) library. Handles concurrent edits and automatic merge resolution. Think of it as a shared data structure that multiple clients can modify independently and then sync without conflicts.
- **[y-protocols](https://github.com/yjs/y-protocols)** — Binary sync protocol over WebSocket for efficient Yjs state transfer.
- **[Tiptap](https://tiptap.dev/)** (client-side) — ProseMirror-based rich text editor configured with the `@tiptap/extension-collaboration` extension. The frontend Tiptap instance maintains the Yjs `Y.Doc` locally and syncs it with the server.

---

### How It Works

#### Connection Lifecycle

1. A client opens a WebSocket to `/collab/:logId?token=<sessionToken>`.
2. The server validates the session token and checks that the user has **read access** to the archive containing that log.
3. The user's write permission is determined and attached to the connection. Write-only clients receive sync updates but their edits are rejected server-side.
4. An in-memory `Y.Doc` is loaded for the `logId` (or created if it doesn't exist yet). Initial CRDT state is loaded from `logs.ydoc_state` in MySQL.
5. The Yjs sync protocol runs: the server sends its current state to the new client, and the client sends its state to the server. Yjs merges both sides automatically.
6. A **presence** (awareness) message is broadcast to all other connected users showing the new user has joined (name, avatar, a randomly assigned color for cursor rendering).

#### Live Editing

- Every mutation a client makes to the `Y.Doc` is broadcast to all other connected clients (except the sender) as a binary Yjs update message.
- The server also listens to `Y.Doc` mutations and schedules a **debounced save** (3 seconds of inactivity) that writes the binary CRDT state back to `logs.ydoc_state`. This ensures the document can be restored after a server restart without losing recent edits.
- **HTML content** is *not* written to the database by the WebSocket service. Only `ydoc_state` is saved via the collab service. `html_content` is written by the REST `POST /api/save-document` endpoint (triggered by the frontend's autosave) and on publish.

#### Connection Cleanup

- When a user disconnects, an awareness broadcast notifies remaining users.
- If all users leave a document, a 30-second cleanup timer fires that destroys the `Y.Doc` from memory (after flushing any pending saves).

---

### Limits & Safety

| Limit                          | Value                              |
|--------------------------------|------------------------------------|
| Max WebSocket message size     | 5 MB                               |
| Max HTML content (on save)     | 2 MB                               |
| Debounce before DB save        | 3 seconds                          |
| Cleanup delay after last user  | 30 seconds                         |
| Max simultaneous WS per user   | 10 connections                     |
| Rate limit (messages/second)   | 60 messages per 1 second window    |

---

### Presence API

The collab service exposes two functions used by other parts of the server:

- **`getAllPresence()`** — Returns a map of `logId → [{ id, name, avatar_url, color }]` for all actively connected documents. Used by the Admin API's telemetry endpoint and by the search/browse APIs to annotate results with live editing indicators.
- **`getActiveDocCount()`** — Returns the number of documents currently held in memory.

---

## Email Service

**File:** `cloudcodex/services/email.js`

A thin wrapper around [Nodemailer](https://nodemailer.com) for sending transactional emails. Configured entirely via environment variables.

**Required environment variables:** `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`

**Optional:** `SMTP_PORT` (default 587), `SMTP_FROM` (default Cloud Codex noreply address)

A TLS connection is automatically used when `SMTP_PORT` is 465.

---

### `sendEmail({ to, subject, text?, html?, from? })`

Sends a single email. Security notes:
- `to`, `subject`, and `from` headers are validated to reject strings containing newline characters, which would allow [header injection attacks](https://owasp.org/www-community/attacks/Mail_header_injection_attack).
- The `Precedence: bulk` header is set on all outgoing mail to reduce auto-responder loops.

**Where it's used:**

| Event                         | Recipient                    |
|-------------------------------|------------------------------|
| User invitation               | New user email               |
| Password reset                | Account owner email          |
| Email 2FA code                | Account owner email          |
| Squad invitation notification | Invited user email           |

---

### `verifyEmailConnection()`

Called once at server startup. Attempts a connection to the SMTP server and returns `true`/`false`. If it returns `false`, the server exits immediately with an error — SMTP is a hard dependency.

---

## Database Connection Module

**File:** `cloudcodex/mysql_connect.js`

Manages the MySQL connection pool and the session token lifecycle.

### Connection Pool

Uses `mysql2/promise` with:
- Pool size: 10 connections
- Infinite queue (`queueLimit: 0`)
- Waits for a connection to become available rather than failing immediately

The pool is created at module load time. `DB_USER` and `DB_PASS` env vars are required; the process exits if they're missing.

### Key Functions

#### `c2_query(sql, params)`

A simple wrapper around `pool.execute()`. Always uses parameterized queries — SQL strings are never constructed by string concatenation with user input anywhere in the codebase.

#### `generateSessionToken(user, ip, userAgent)`

Manages session creation with a "one session per user" model:
1. If the user has an existing non-expired session, it is reused (metadata updated).
2. If the session is expired, the token is rotated in place (same row, new token).
3. If no session exists, a new one is inserted.

Tokens are 64-character random alphanumeric strings generated using `crypto.getRandomValues`.

#### `validateAndAutoLogin(sessionToken)`

Looks up a session token, checks expiry, and returns the associated `user` object (`id`, `name`, `email`, `avatar_url`, `is_admin`) or `null`. Called on every authenticated request by the `requireAuth` middleware.

#### `touchSession(sessionToken)`

Updates `last_active_at` on the session row. Called asynchronously on every authenticated request (fire-and-forget — errors are swallowed so they don't affect the response).

---

## Middleware

**File:** `cloudcodex/middleware/auth.js`

### `requireAuth`

Reads the session token from the `Authorization: Bearer <token>` header, or falls back to the `sessionToken` cookie (for OAuth browser redirects). Calls `validateAndAutoLogin` and attaches the user object to `req.user`. Returns `401` if the token is missing or invalid.

### `requireAdmin`

Must be used after `requireAuth`. Returns `403` if `req.user.is_admin` is not true.

---

**File:** `cloudcodex/middleware/permissions.js`

### `loadPermissions`

Fetches the user's global permission flags from the `permissions` table and attaches them to `req.permissions`. Used in routes that need to make multiple permission decisions without repeated DB queries.

### `requirePermission(permission)`

Returns Express middleware that:
1. Returns `next()` immediately for admins.
2. Checks the user's global `permissions` row.
3. If global permission is missing, falls back to checking squad-level permissions (`squad_members` flags) when a `squad_id` can be inferred from the request context.
4. Returns `403` if no grant is found.

---

## Route Helpers

**File:** `cloudcodex/routes/helpers/shared.js`

Shared utilities used across all route files:

- **`sanitizeHtml(html)`** — Runs DOMPurify server-side to strip XSS vectors. Allows `data:` URIs on `img` tags (for pasted images), denies all other dangerous patterns.
- **`asyncHandler(fn)`** — Wraps an async route handler so that rejected promises are forwarded to Express's `next(err)` error pipeline instead of hanging.
- **`isValidId(id)`** — Confirms a value is a positive integer (guards against injection via ID params).
- **`canPublish(squadId, archiveCreatorId, user)`** — Async helper that checks the full publish permission chain.
- **`checkLogReadAccess(logId, user)`** / **`checkLogWriteAccess(logId, user)`** — Convenience wrappers for the archive-level access SQL checks, used in comment and version routes.

**File:** `cloudcodex/routes/helpers/ownership.js`

- **`readAccessWhere(alias)`** / **`writeAccessWhere(alias)`** — Returns a SQL `WHERE` fragment for access checking. Takes 7 positional parameters via `readAccessParams(user)` / `writeAccessParams(user)`.
- **`isArchiveOwner(user, archiveId)`** — Async check for management-level ownership.

**File:** `cloudcodex/routes/helpers/images.js`

- **`extractImagesFromHtml(html)`** — Scans HTML for base64-encoded `<img>` tags, writes them to disk under `public/doc-images/`, and replaces the `src` with a served URL. This prevents large binary blobs from being stored in MySQL and speeds up document loads.
- **`inlineImagesForExport(html)`** / **`inlineImagesForMarkdownExport(html)`** — Re-embeds served images back as base64 for self-contained DOCX/Markdown exports.

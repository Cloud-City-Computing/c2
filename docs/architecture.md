```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   ARCHITECTURE                                                             ║
║   Single-process Node app · Yjs CRDT · MySQL FULLTEXT · GitHub-as-proxy.   ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Cloud Codex — Technical Architecture

Cloud Codex is a self-hosted **collaborative document platform** for teams.
It supports structured knowledge organization (workspaces → squads →
archives → documents), real-time co-editing with CRDTs, version control,
inline comments, full-text search, GitHub file sync, and an in-app
notification inbox.

The whole product runs in **one Node process** in front of one MySQL
container. There is no message broker, no separate WebSocket service, no
external search index, no background job queue. This is a deliberate
self-hosting choice — the cost of operating Cloud Codex should not require
running a small data platform.

---

## System Overview

```
   ┌────────────────────────────────────────────────────────────────────┐
   │                      Browser (single-page app)                     │
   │                                                                    │
   │   React 19  +  React Router 7                                      │
   │   Tiptap 3 (editor)  +  Yjs (CRDT)                                 │
   │   Bundled by Vite 7, served by vite-express                        │
   └─────────┬─────────────────┬─────────────────┬─────────────────────┘
             │ HTTP / JSON     │ WS /collab      │ WS /notifications-ws
             │                 │ (Yjs binary)    │ (push only)
   ┌─────────▼─────────────────▼─────────────────▼─────────────────────┐
   │                       Node.js (single process)                     │
   │                                                                    │
   │   Express                                                          │
   │     · 18 routers (auth, documents, archives, comments, search,     │
   │       workspaces, squads, admin, oauth, github, favorites,         │
   │       avatars, doc-images, upload, notifications, activity,        │
   │       watches)                                                     │
   │     · helmet CSP + rate limiters + DOMPurify on input              │
   │     · ownership.js access SQL fragments — one cascade per check    │
   │                                                                    │
   │   WebSocket servers (attached to the same HTTP server)             │
   │     · services/collab.js          — Yjs sync per /collab/:logId    │
   │     · services/user-channel.js    — push-only inbox channel        │
   │                                                                    │
   │   Background services                                              │
   │     · services/notifications.js   — coalesced fan-out funnel       │
   │     · services/email.js           — Nodemailer (SMTP)              │
   │     · daily activity_log prune (>365 d)                            │
   └─────────┬──────────────────────────────────────────────────────────┘
             │ mysql2 connection pool (size 10)
   ┌─────────▼──────────────────────────────────────────────────────────┐
   │                          MySQL 8 (Docker)                           │
   │                                                                    │
   │   25 tables across the workspace → squad → archive → log → version │
   │   hierarchy, plus notifications / watches / activity / GitHub      │
   │   sync tables. FULLTEXT index on logs(title, plain_content).       │
   └────────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### Single-Process Architecture

The entire application — API server, Vite dev server, and both WebSocket
servers — runs in a single Node.js process. This is intentional for
simplicity: no inter-process communication, no message broker. Both WS
servers attach to the same HTTP server instance as Express via the
`upgrade` event.

In production, `vite-express` serves the pre-built Vite `dist/` output
alongside the API. In development, Vite's HMR dev server runs within the
same process.

### Invite-Only User Registration

There is no public signup page. An admin must issue an invitation via
`POST /api/admin/invitations`, which sends a tokenized link. The sign-up
form validates the token and associates the new account with the email the
token was issued to. This keeps the user base controlled.

### Layered Access Control

Access to archives is not modeled as a simple "is user a member of X?"
check. Multiple grant mechanisms stack on top of each other and resolve in
**a single SQL `WHERE` fragment** (no per-step DB round-trips):

1. Admin bypass
2. Direct per-user JSON grants on the archive
3. Archive creator implicit access
4. Workspace owner implicit full access
5. Squad member role/flags
6. Squad-level grants on the archive
7. Workspace-wide boolean flag

This gives administrators flexibility to share documents across squads or
whole organizations without restructuring the org hierarchy. See
[access-control.md](./access-control.md) for the full resolution flowchart.

### Document Storage: Dual-State Model

Each document (`log`) has two content representations:

| Column           | Written by                      | Purpose                                       |
|------------------|---------------------------------|-----------------------------------------------|
| `html_content`   | REST `POST /api/save-document`  | Human-readable; used for rendering and export |
| `ydoc_state`     | WebSocket collab service        | Binary CRDT; used for live sync restore       |

The CRDT state is authoritative for the "live" document while a session
is active. The HTML state is persisted by the frontend autosave (every
few seconds of inactivity) and on publish. On next open, the editor
loads from `html_content` and the CRDT state is restored in parallel.

### No Dedicated Search Service

Full-text search is implemented directly on MySQL using a `FULLTEXT`
index over `logs.title` and `logs.plain_content` (a stored generated
column that strips HTML tags). MySQL's built-in boolean-mode relevance
ranking with prefix matching is sufficient at moderate scale and
eliminates an infrastructure dependency. **Don't propose adding
Elasticsearch / Meilisearch / Typesense without a strong reason.**

### GitHub Integration as a Live Proxy

The GitHub integration does not use webhooks or background sync. Every
GitHub operation (listing repos/files, reading/committing content,
creating PRs, search, embeds) is made in real time via the user's
stored access token when they navigate the GitHub section of the app.
Tokens are encrypted at rest using AES-256-GCM derived from the
`GITHUB_CLIENT_SECRET` via scrypt.

### Notifications Funnel

Every user-facing alert goes through `services/notifications.js`, which
combines persistence + WebSocket push + optional email behind a single
`createNotification()` call. Self-events are suppressed; same-resource
repeats inside a 60-second window coalesce. See
[notifications.md](./notifications.md).

---

## Request Lifecycles

Two paths handle nearly all production traffic. Both share the same
auth + access-control machinery.

### REST: save a document

```
   POST /api/save-document  { logId, htmlContent, plainContent }
       │
       ▼
   helmet → cors → JSON parse (2 MB limit)
       │
       ▼
   requireAuth      validateAndAutoLogin(token)  ─────────► sessions
       │                                                     ◄────── user
       ▼
   asyncHandler(handler)
       │
       ▼
   isValidId(logId)  + sanitizeHtml(htmlContent)
       │
       ▼
   writeAccessWhere('a')  + writeAccessParams(user)   ─────► archives
       │                                                     ◄────── 1 row?
       ▼
   UPDATE logs SET html_content=?, plain_content=?, updated_at=NOW(),
                   updated_by=?  WHERE id=? AND <writable>
       │
       ▼
   { success: true }
```

### WebSocket: live edit a document

```
   open WS /collab/:logId?token=…
       │
       ▼
   validateAndAutoLogin(token)  + readAccessWhere('a')
       │
       ▼
   load Y.Doc  ◄── ydoc_state from logs (or empty)
       │
       ▼
   sync handshake  ⇄  client
       │
       ▼
   for every Y.Doc update:
       broadcast to other clients  +  schedule debounced 3 s save
                                              │
                                              ▼
                                        UPDATE logs SET ydoc_state=?
                                              WHERE id=?
       │
       ▼
   on disconnect: awareness broadcast; if last user, 30 s cleanup timer
```

---

## Project Structure

```
cloudcodex/                  — Application root
├── app.js                   — Express app setup (middleware, route mounting)
├── server.js                — Entry point: starts HTTP + 2 WS servers,
│                              verifies SMTP, bootstraps admin, schedules
│                              the daily activity_log prune
├── mysql_connect.js         — DB pool, session management, c2_query()
├── middleware/
│   ├── auth.js              — requireAuth, requireAdmin
│   └── permissions.js       — loadPermissions, requirePermission
├── routes/
│   ├── auth.js              — login, signup, 2FA, password reset
│   ├── workspaces.js
│   ├── squads.js
│   ├── archives.js
│   ├── documents.js
│   ├── comments.js
│   ├── search.js
│   ├── favorites.js
│   ├── notifications.js     — inbox + preferences
│   ├── activity.js          — workspace activity feed
│   ├── watches.js           — per-user subscriptions
│   ├── admin.js
│   ├── oauth.js             — Google SSO + GitHub OAuth
│   ├── github.js            — GitHub API proxy (40+ endpoints)
│   ├── avatars.js           — avatar upload/serve
│   ├── doc-images.js        — document image extraction
│   ├── upload.js            — document import (HTML/MD/PDF/DOCX)
│   └── helpers/
│       ├── shared.js        — validators, asyncHandler, sanitizeHtml
│       ├── ownership.js     — SQL fragments for access control
│       ├── images.js        — base64 image extraction to disk
│       ├── activity.js      — activity_log writer + watch fan-out
│       └── mentions.js      — @mention parser + notification emit
├── services/
│   ├── collab.js            — Yjs WebSocket server
│   ├── notifications.js     — coalesced inbox + WS push + email funnel
│   ├── user-channel.js      — push-only WS for inbox updates
│   ├── email.js             — Nodemailer wrapper
│   └── email-templates.js   — subject/text/html builders per type
├── public/
│   ├── avatars/             — uploaded user avatars
│   └── doc-images/          — extracted document images
└── src/                     — React frontend
    ├── App.jsx              — router
    ├── main.jsx             — React root mount
    ├── pages/               — full-page route components
    ├── components/          — reusable UI (incl. components/github/)
    ├── extensions/          — Tiptap nodes (Mention, GitHubCodeEmbed, …)
    ├── hooks/               — useCollab, useNotificationChannel, …
    ├── page_layouts/        — shared layout wrappers
    └── assets/              — static assets
```

---

## Tech Stack

### Frontend

| Technology                                    | Purpose                              |
|-----------------------------------------------|--------------------------------------|
| [React](https://react.dev) 19                 | UI framework                         |
| [React Router](https://reactrouter.com) 7     | Client-side routing                  |
| [Vite](https://vite.dev) 7                    | Build tool and dev server            |
| [Tiptap](https://tiptap.dev) 3                | Headless rich text editor (ProseMirror) |
| [Yjs](https://yjs.dev) + y-protocols          | CRDT for real-time sync              |
| [Lowlight](https://github.com/wooorm/lowlight)| Syntax highlighting (25 languages)   |
| [marked](https://marked.js.org)               | Markdown → HTML                      |
| [Turndown](https://github.com/mixmark-io/turndown) | HTML → Markdown                 |

### Backend

| Technology                                    | Purpose                              |
|-----------------------------------------------|--------------------------------------|
| [Express](https://expressjs.com) 5            | HTTP framework                       |
| [vite-express](https://github.com/szymmis/vite-express) | Vite + Express integration |
| [ws](https://github.com/websockets/ws)        | WebSocket server                     |
| [mysql2](https://github.com/sidorares/node-mysql2) | MySQL driver, prepared statements |
| [Sharp](https://sharp.pixelplumbing.com)      | Image processing (avatars, WebP)     |
| [Multer](https://github.com/expressjs/multer) 2 | Multipart file upload              |
| [Nodemailer](https://nodemailer.com)          | Transactional email                  |
| [google-auth-library](https://github.com/googleapis/google-auth-library-nodejs) | Google SSO |
| [Mammoth](https://github.com/mwilliamson/mammoth.js) | DOCX → HTML import           |
| [html-to-docx](https://github.com/privateOmega/html-to-docx) | HTML → DOCX export    |
| [pdf-parse](https://www.npmjs.com/package/pdf-parse) | PDF text extraction           |

### Security

| Technology                                    | Purpose                              |
|-----------------------------------------------|--------------------------------------|
| [bcrypt](https://github.com/kelektiv/node.bcrypt.js) | Password hashing (12 rounds)  |
| [Helmet](https://helmetjs.github.io)          | Security headers + CSP               |
| [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) | Rate limiting |
| [DOMPurify](https://github.com/cure53/DOMPurify) | HTML sanitization (server + client) |
| [CORS](https://github.com/expressjs/cors)     | Cross-origin policy                  |
| [otpauth](https://github.com/hectorm/otpauth) | TOTP 2FA                             |
| [qrcode](https://github.com/soldair/node-qrcode) | QR-code generation for 2FA setup  |
| Node.js `crypto`                              | AES-256-GCM for OAuth tokens at rest |

### Testing

| Technology                                    | Purpose                              |
|-----------------------------------------------|--------------------------------------|
| [Vitest](https://vitest.dev) 4                | Test runner (two projects)           |
| [Supertest](https://github.com/ladjs/supertest) 7 | HTTP endpoint testing            |
| [@testing-library/react](https://testing-library.com/docs/react-testing-library/intro/) | Component testing |
| `jsdom`                                       | Browser DOM in Node                  |

### Infrastructure

| Technology                                    | Purpose                              |
|-----------------------------------------------|--------------------------------------|
| [MySQL](https://www.mysql.com) 8              | Relational database                  |
| [Docker Compose](https://docs.docker.com/compose/) | Container orchestration         |

---

## Environment Configuration

Copy `.env.example` to `.env`. See [getting-started.md](./getting-started.md)
for the full annotated walkthrough. Required at minimum: DB credentials,
SMTP credentials, admin super-user. Optional: Google + GitHub OAuth.

---

## Documentation Index

| Document | Contents |
|----------|----------|
| [getting-started.md](./getting-started.md) | Local setup, env, scripts, seed data |
| [features.md](./features.md) | Every major capability |
| [database.md](./database.md) | Full schema reference (25 tables) |
| [access-control.md](./access-control.md) | Permission resolution flowchart |
| [services.md](./services.md) | Collab WS, notifications, email, DB module, middleware |
| [notifications.md](./notifications.md) | Notifications subsystem deep-dive |
| [frontend.md](./frontend.md) | React app routing, pages, hooks, components |
| [security.md](./security.md) | Defense-in-depth model |
| [testing.md](./testing.md) | Two Vitest projects + coverage thresholds |
| [deployment.md](./deployment.md) | Production operations |
| [troubleshooting.md](./troubleshooting.md) | Common setup/runtime failures |
| [api/auth.md](./api/auth.md) | Authentication endpoints |
| [api/workspaces-squads-archives.md](./api/workspaces-squads-archives.md) | Org hierarchy + archive grants |
| [api/documents.md](./api/documents.md) | Document CRUD, save, publish, versioning, export |
| [api/comments.md](./api/comments.md) | Comment + reply endpoints |
| [api/search-favorites.md](./api/search-favorites.md) | Search, browse, favorites |
| [api/notifications.md](./api/notifications.md) | Inbox, badge, preferences |
| [api/activity-watches.md](./api/activity-watches.md) | Activity feed + watches |
| [api/admin.md](./api/admin.md) | Admin panel endpoints |
| [api/oauth-github.md](./api/oauth-github.md) | OAuth + 40+ GitHub proxy endpoints |

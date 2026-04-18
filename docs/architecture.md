# Cloud Codex — Technical Architecture

Cloud Codex is a **collaborative document platform** for teams. It supports structured knowledge organization (workspaces → squads → archives → documents), real-time co-editing, version control, inline comments, full-text search, and GitHub file sync.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                         Client (Browser)                      │
│                                                              │
│   React + Tiptap + Yjs (CRDT)                               │
│   Served by Vite (dev HMR) / Vite-Express (prod)            │
└────────────────────────────┬─────────────────────────────────┘
                             │ HTTP REST (JSON)
                             │ WebSocket (Yjs binary protocol)
┌────────────────────────────▼─────────────────────────────────┐
│                    Node.js Application Server                 │
│                                                              │
│   Express API  ─────────────────────────────────────────    │
│   • Auth & sessions          • Workspaces / Squads          │
│   • Archives & Logs          • Comments                      │
│   • Search (FULLTEXT)        • Favorites                     │
│   • Version Control          • Admin Panel                   │
│   • OAuth (Google, GitHub)   • GitHub API Proxy              │
│   • File Uploads             • Export (DOCX, Markdown)       │
│                                                              │
│   Collab WebSocket Server (Yjs / y-protocols)               │
│   • Real-time CRDT sync      • Presence / awareness          │
│   • Debounced DB persistence                                 │
│                                                              │
│   Services                                                   │
│   • Email (Nodemailer / SMTP)                               │
└────────────────────────────┬─────────────────────────────────┘
                             │ mysql2 connection pool
┌────────────────────────────▼─────────────────────────────────┐
│                         MySQL 8 (Docker)                      │
│                                                              │
│   workspaces → squads → archives → logs → versions          │
│   users, sessions, permissions, comments, favorites          │
└──────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### Single-Process Architecture

The entire application — API server, Vite dev server, and WebSocket collab server — runs in a single Node.js process. This is intentional for simplicity: no inter-process communication, no message broker. The collab WebSocket server shares the same HTTP server instance as Express.

In production, `vite-express` serves the pre-built Vite `dist/` output alongside the API. In development, Vite's HMR dev server runs within the same process.

### Invite-Only User Registration

There is no public signup page. An admin must issue an invitation via `POST /api/admin/invitations`, which sends a tokenized link. The sign-up form validates the token and associates the new account with the email the token was issued to. This keeps the user base controlled.

### Layered Access Control

Access to archives is not modeled as a simple "is user a member of X?" check. Instead, multiple grant mechanisms stack on top of each other:

1. Admin bypass
2. Direct per-user JSON grants on the archive
3. Archive creator implicit access
4. Workspace owner implicit full access
5. Squad member role/flags
6. Squad-level grants on the archive
7. Workspace-wide boolean flag

This gives administrators flexibility to share documents across squads or whole organizations without restructuring the org hierarchy. See [access-control.md](./access-control.md).

### Document Storage: Dual-State Model

Each document (`log`) has two content representations:

| Column           | Written by                  | Purpose                                      |
|------------------|-----------------------------|----------------------------------------------|
| `html_content`   | REST `POST /api/save-document` | Human-readable; used for rendering and export |
| `ydoc_state`     | WebSocket collab service    | Binary CRDT; used for live sync restore       |

The CRDT state is authoritative for the "live" document while a session is active. The HTML state is persisted by the frontend autosave (every few seconds of inactivity) and on publish. On next open, the editor loads from `html_content` and the CRDT state is restored in parallel.

### No Dedicated Search Service

Full-text search is implemented directly on MySQL using a `FULLTEXT` index over `logs.title` and `logs.plain_content` (a stored generated column that strips HTML tags). This uses MySQL's built-in boolean-mode relevance ranking with prefix matching. No Elasticsearch, Typesense, or similar — the MySQL approach is sufficient at moderate scale and eliminates an infrastructure dependency.

### GitHub Integration as a Proxy

The GitHub integration does not use webhooks or background sync. It is a pure API proxy: every GitHub operation (listing repos/files, reading/committing content, creating PRs) is made in real time via the user's stored access token when they navigate the GitHub section of the app. Tokens are encrypted at rest using AES-256-GCM derived from the `GITHUB_CLIENT_SECRET`.

---

## Project Structure

```
cloudcodex/          — Application root
├── app.js           — Express app setup (middleware, route mounting)
├── server.js        — Entry point: starts server, verifies SMTP, bootstraps admin user
├── mysql_connect.js — DB pool, session management, query wrapper
├── middleware/
│   ├── auth.js      — requireAuth, requireAdmin
│   └── permissions.js — loadPermissions, requirePermission
├── routes/
│   ├── auth.js      — Login, signup, 2FA, password reset
│   ├── workspaces.js
│   ├── squads.js
│   ├── archives.js
│   ├── documents.js
│   ├── comments.js
│   ├── search.js
│   ├── favorites.js
│   ├── admin.js
│   ├── oauth.js     — Google SSO + GitHub OAuth
│   ├── github.js    — GitHub API proxy
│   ├── avatars.js   — Avatar upload/serve
│   ├── doc-images.js — Document image extraction
│   └── helpers/
│       ├── shared.js    — Validators, asyncHandler, sanitizeHtml, permission checks
│       ├── ownership.js — SQL fragments for access control
│       └── images.js    — Base64 image extraction to disk
├── services/
│   ├── collab.js    — Yjs WebSocket server
│   └── email.js     — Nodemailer wrapper
├── public/
│   ├── avatars/     — Uploaded user avatars
│   └── doc-images/  — Extracted document images
└── src/             — React frontend
    ├── App.jsx       — Router
    ├── main.jsx      — React root mount
    ├── pages/        — Full-page route components
    ├── components/   — Reusable UI components
    ├── hooks/        — Custom React hooks
    ├── page_layouts/ — Shared layout wrappers
    └── assets/       — Static assets (icons, styles)
```

---

## Environment Configuration

Copy `.env.example` to `.env`. Required variables:

| Variable              | Purpose                                            |
|-----------------------|----------------------------------------------------|
| `DB_HOST`             | MySQL host                                         |
| `DB_USER`             | MySQL username                                     |
| `DB_PASS`             | MySQL password                                     |
| `DB_NAME`             | MySQL database name                                |
| `SMTP_HOST`           | SMTP server hostname                               |
| `SMTP_USER`           | SMTP auth username                                 |
| `SMTP_PASS`           | SMTP auth password                                 |
| `ADMIN_USERNAME`      | Admin super user username (synced on startup)      |
| `ADMIN_PASSWORD`      | Admin super user password (synced on startup)      |
| `ADMIN_EMAIL`         | Admin super user email (synced on startup)         |
| `APP_URL`             | Public base URL (e.g. `https://app.example.com`)  |
| `GOOGLE_CLIENT_ID`    | Google OAuth app client ID (optional)              |
| `GOOGLE_CLIENT_SECRET`| Google OAuth app client secret (optional)          |
| `GOOGLE_OAUTH_DOMAIN` | Restrict Google SSO to this domain (optional)      |
| `GITHUB_CLIENT_ID`    | GitHub OAuth app client ID (optional)              |
| `GITHUB_CLIENT_SECRET`| GitHub OAuth app client secret (optional)          |
| `CORS_ORIGIN`         | Allowed CORS origin in production (optional)       |

---

## Running Locally

```bash
# 1. Start the MySQL container
docker compose up -d

# 2. Initialize the schema
mysql -h 127.0.0.1 -P 3306 -u <DB_USER> -p <DB_NAME> < init.sql

# 3. (Optional) Load sample data
mysql -h 127.0.0.1 -P 3306 -u <DB_USER> -p <DB_NAME> < seed.sql

# 4. Install dependencies
cd cloudcodex && npm install

# 5. Configure environment
cp ../.env.example ../.env  # then edit .env

# 6. Start the development server
npm run dev
# → http://localhost:3000
```

---

## Documentation Index

| Document | Contents |
|----------|----------|
| [database.md](./database.md) | Full schema reference for all 17 tables |
| [access-control.md](./access-control.md) | How read/write permissions are resolved |
| [services.md](./services.md) | Collab WebSocket, email, DB module, middleware |
| [frontend.md](./frontend.md) | React app structure, routing, key components |
| [api/auth.md](./api/auth.md) | Authentication, 2FA, account management endpoints |
| [api/workspaces-squads-archives.md](./api/workspaces-squads-archives.md) | Org hierarchy and archive access endpoints |
| [api/documents.md](./api/documents.md) | Document CRUD, save, publish, versioning, export |
| [api/comments.md](./api/comments.md) | Comment and reply annotation endpoints |
| [api/search-favorites.md](./api/search-favorites.md) | Full-text search, browse, and favorites endpoints |
| [api/admin.md](./api/admin.md) | Admin panel endpoints |
| [api/oauth-github.md](./api/oauth-github.md) | OAuth flows and GitHub API proxy endpoints |

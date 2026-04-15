<p align="center">
  <img src="cloudcodex/src/assets/ccc_brand/ccc_no_txt_transparent.png" alt="Cloud Codex" width="120" />
</p>

<h1 align="center">Cloud Codex</h1>

<p align="center">
  A real-time collaborative documentation platform by <a href="https://cloudcitycomputing.com">Cloud City Computing, LLC</a>
</p>

---

## About

Cloud Codex is a self-hosted documentation platform that lets squads write, organize, and collaborate on documents in real time. Multiple users can edit the same log simultaneously with conflict-free merging, leave inline comments and annotations, manage access through workspaces and squads, and track change history with publishable versions — all from a modern browser-based interface.

The archive is designed for workspaces that want full control over their documentation infrastructure without relying on third-party SaaS platforms. It runs entirely on your own hardware or cloud with a single Docker container for the database and a Node.js application server.

## Features

### Real-Time Collaborative Editing
Multiple users can edit the same document simultaneously. Changes are merged automatically using Yjs CRDTs (Conflict-free Replicated Data Types), ensuring every user sees a consistent view without manual conflict resolution. Remote cursors and text selections are displayed in real time so collaborators can see exactly where others are working.

### Presence Awareness
Live presence indicators show which users are currently viewing or editing each log. Avatar badges appear throughout the interface — in the log tree sidebar, the editor toolbar, the top navigation bar, and the explore/browse view — giving squads immediate visibility into who is active. A dedicated presence API exposes per-log editing sessions for integration across views.

### Rich Text & Markdown Editing
Documents can be authored in either a full WYSIWYG rich text editor (powered by Tiptap) or a Markdown source editor with a live rendered preview. Users can switch between modes at any time, and their preference is saved across sessions.

### Code Syntax Highlighting
Fenced code blocks support syntax highlighting for 25 languages (JavaScript, TypeScript, Python, Java, C, C++, Go, Rust, Ruby, PHP, SQL, HTML, CSS, JSON, YAML, Bash, and more). A language selector dropdown is built into each code block, with auto-detection as a fallback. Highlighting is rendered in both the editor and read-only views.

### Draw.io Diagram Integration
Users can embed draw.io (diagrams.net) diagrams directly into documents. Clicking the toolbar button opens the draw.io editor in a popup. Diagram XML and a rendered SVG preview are stored inline in the document, and the diagram can be re-opened, edited, or removed at any time via the embed API.

### Resizable Images
Images inserted into documents can be interactively resized using drag handles. The width is persisted in the document HTML so the layout is preserved for all viewers. An image crop modal with an eight-handle crop rectangle, rule-of-thirds grid overlay, and canvas-based output is available when inserting images.

### Document Image Hosting
Images pasted or dropped into the editor are automatically uploaded, processed (resized to a maximum of 2048 px, converted to WebP at 85 % quality), and served from a dedicated static endpoint with 30-day cache headers. Content-hash deduplication (SHA-256) prevents storing the same image twice. Base64 data URIs are extracted on save and re-inlined for self-contained exports.

### Inline Comments & Annotations
Squad members can highlight text and attach comments anchored to specific passages. Comments support a tag system (comment, suggestion, question, issue, note) and a status workflow (open → resolved / dismissed). Threaded replies enable focused discussions, and all comment activity is broadcast in real time via WebSocket.

### Workspaces & Squads
Content is organized under workspaces, each managed by a single owner. Within a workspace, squads group users with role-based membership (member, admin, owner). Squad invitations track pending, accepted, and declined states. Granular per-member permissions control read, write, log creation, archive creation, member management, version deletion, and publishing rights.

### Archives & Three-Tier Access Control
Archives serve as top-level containers for related logs and can optionally be scoped to a specific squad. Logs are arranged in a hierarchical parent-child tree structure with breadcrumb navigation. Access control operates at three tiers:

1. **User-level** — per-user read/write grants stored as JSON arrays of user IDs.
2. **Squad-level** — read/write grants for entire squads; all current members of a granted squad inherit the permission.
3. **Workspace-level** — a boolean flag that opens read or write access to every member of any squad in the same workspace.

A collapsible access panel on each archive card displays the owner, inherited squad members with role and permission badges, workspace-level grants, explicitly granted squads, and individually granted users. Users whose access is already covered by a squad or owner membership are omitted from the individual user list to keep the display clean.

### GitHub Integration
Archives can be linked to GitHub repositories for browsing, editing, and pull request management without leaving the platform. Features include:

- Repository search, file tree navigation, and file viewing with smart text-file filtering (50 + supported extensions)
- In-browser file editing with commit support (create and update files via the GitHub Contents API)
- Branch management (list and create branches from any ref)
- Pull request listing and creation
- Encrypted access token storage (AES-256-GCM derived from the client secret via scrypt)

### OAuth & Single Sign-On
Google Workspace SSO enables domain-restricted login with automatic account creation for allowed domains. GitHub OAuth provides account linking and access token exchange. Both providers support unlinking flows with lockout prevention, and a provider detection endpoint drives a dynamic login UI.

### Admin Console
A dedicated admin dashboard provides platform-wide management:

- **Statistics** — live counts of users, workspaces, squads, archives, logs, and pending invitations.
- **Workspace management** — create workspaces (with optional squad and archive scaffolding), list, and delete.
- **User management** — list all users with squad membership counts, delete non-admin accounts.
- **User invitations** — invite users by email (sends a branded HTML signup link), list pending invitations, and revoke.

An admin super-user is automatically synced from environment variables on server startup.

### Explore & Browse Documents
A card-based browse view lists all accessible documents with sorting (newest, oldest, title, archive), paginated results, and integrated search with contextual match snippets and keyword highlighting. Each card shows the archive name, author, date, word count, and live presence avatars indicating who is currently editing.

### Version History
Any authorized user can publish a named version snapshot with optional release notes (up to 5 000 characters). The version browser lets users browse, preview, and compare historical snapshots. Previous versions can be restored at any time, with all content re-sanitized on restoration.

### Document Import & Export
Logs can be created by uploading HTML, Markdown, plain text, PDF, or Word DOCX files. All imported formats are automatically converted to sanitized HTML. Logs can be exported as DOCX, HTML, Markdown, plain text, or PDF (via browser print-to-PDF).

### Full-Text Search
Search is powered by a MySQL FULLTEXT index across log titles and plain-text content. Results are scoped to logs the current user has permission to access and are returned with paginated snippet previews.

### Favorites
Users can star any document to add it to their personal favorites list. A star toggle appears in the editor header on every document. The home page displays a dedicated favorites section above the browse view, showing the most recently favorited documents as cards with title, archive, author, and excerpt. Favorites are scoped per-user and persist across sessions.

### User Profiles & Preferences
Users can upload a profile picture (automatically resized to 256 × 256 WebP), update their name, email, and password, and customize appearance preferences including accent color, font size, UI density, sidebar behavior, and default editor mode.

### Authentication & Two-Factor Security
Authentication uses 64-character cryptographically random session tokens with a 7-day expiry. Password reset is handled via email-based token flow. Two-factor authentication supports both email OTP codes and TOTP authenticator apps (with QR code setup).

### Guided Onboarding
A post-signup welcome wizard walks new users through creating their first workspace, squad, and archive in a single guided flow.

---

## Tech Stack

### Frontend

| Technology | Purpose |
| --- | --- |
| [React](https://react.dev) 19 | UI framework |
| [React Router](https://reactrouter.com) 7 | Client-side routing |
| [Vite](https://vite.dev) 7 | Build tool and dev server |
| [Tiptap](https://tiptap.dev) | Headless rich text editor (ProseMirror-based) |
| [Lowlight](https://github.com/wooorm/lowlight) | Syntax highlighting (highlight.js AST, 25 languages) |
| [Marked](https://marked.js.workspace) | Markdown → HTML parsing |
| [Turndown](https://github.com/mixmark-io/turndown) | HTML → Markdown conversion |
| [Yjs](https://yjs.dev) | CRDT framework for real-time sync |

### Backend

| Technology | Purpose |
| --- | --- |
| [Express](https://expressjs.com) 5 | HTTP framework |
| [ViteExpress](https://github.com/szymmis/vite-express) | Vite + Express integration |
| [mysql2](https://github.com/sidorares/node-mysql2) | MySQL driver with prepared statements |
| [ws](https://github.com/websockets/ws) | WebSocket server |
| [Sharp](https://sharp.pixelplumbing.com) | Image processing (avatars, document images, WebP conversion) |
| [Multer](https://github.com/expressjs/multer) 2 | Multipart file upload handling |
| [Nodemailer](https://nodemailer.com) | Transactional email delivery |
| [google-auth-library](https://github.com/googleapis/google-auth-library-nodejs) | Google OAuth / SSO |
| [Mammoth](https://github.com/mwilliamson/mammoth.js) | DOCX → HTML conversion |
| [html-to-docx](https://github.com/nicksrandall/html-to-docx) | HTML → DOCX export |
| [pdf-parse](https://github.com/nicksrandall/pdf-parse) | PDF text extraction |

### Security

| Technology | Purpose |
| --- | --- |
| [bcrypt](https://github.com/kelektiv/node.bcrypt.js) | Password hashing (12 rounds) |
| [Helmet](https://helmetjs.github.io) | Security headers & Content Security Policy |
| [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) | Request rate limiting |
| [DOMPurify](https://github.com/cure53/DOMPurify) | HTML sanitization (server & client) |
| [CORS](https://github.com/expressjs/cors) | Cross-origin request policy |
| [OTPAuth](https://github.com/nicksrandall/otpauth) | TOTP two-factor authentication |
| [QRCode](https://github.com/nicksrandall/qrcode) | QR code generation for 2FA setup |
| Node.js `crypto` | AES-256-GCM encryption for OAuth tokens at rest |

### Infrastructure

| Technology | Purpose |
| --- | --- |
| [MySQL](https://www.mysql.com) 8 | Relational database |
| [Docker Compose](https://docs.docker.com/compose/) | Container orchestration |

### Testing

| Technology | Purpose |
| --- | --- |
| [Vitest](https://vitest.dev) 4 | Test runner |
| [Supertest](https://github.com/ladjs/supertest) 7 | HTTP endpoint testing |

---

## Prerequisites

- **Linux** or **Windows Subsystem for Linux (WSL)**
- **Docker** with Compose v2
- **Node.js** 20 or later
- **npm**

> On Debian/Ubuntu, the included startup script can install missing system packages automatically.

---

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd c2
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and set your database credentials, SMTP credentials, and admin super-user credentials. SMTP is required — the server will not start without valid credentials. It is used for password reset, email-based two-factor authentication, and user invitations.

```dotenv
# ─── Database ────────────────────────────────────────────────
DB_HOST=localhost
DB_USER=admin
DB_PASS=changeme
DB_NAME=c2
MYSQL_ROOT_PASSWORD=changeme

# ─── App ─────────────────────────────────────────────────────
APP_URL=http://localhost:3000
CORS_ORIGIN=

# ─── Admin ───────────────────────────────────────────────────
ADMIN_USERNAME=admin
ADMIN_EMAIL=
ADMIN_PASSWORD=

# ─── SMTP (required — server will not start without valid credentials)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# ─── OAuth (optional — enables SSO and GitHub integration) ───
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_DOMAIN=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

### 3. Start the application

The quickest way to get everything running is the included startup script:

```bash
./start.sh
```

This script will:
1. Verify and install system dependencies (Docker, Node.js, npm, mysql-client)
2. Start the Docker daemon if it is not already running
3. Launch the MySQL 8 container via Docker Compose
4. Wait for the database to accept connections
5. Install npm dependencies
6. Start the development server on **http://localhost:3000**

### Manual Setup

If you prefer to start services individually:

```bash
# Start the MySQL container
docker compose up -d

# Install dependencies
cd cloudcodex
npm install

# Start the dev server
npm run dev
```

The application will be available at **http://localhost:3000**.

### 4. Load sample data (optional)

A seed script populates the database with a workspace, three squads, eight archives, and ~60 logs of realistic content for testing search, pagination, and collaboration features.

```bash
mysql -u $DB_USER -p -h 127.0.0.1 c2 < seed.sql
```

All seed accounts use the password **`password`**.

| Account | Email | Role / Notes |
| --- | --- | --- |
| `alice` | alice@acme.com | Workspace owner. Engineering squad owner. Full permissions (create squads, archives, logs). |
| `bob` | bob@acme.com | Engineering and Operations member. Can create archives and logs. |
| `carol` | carol@acme.com | Design squad owner. Can create archives and logs. |
| `dave` | dave@acme.com | Operations squad owner. Can create archives and logs. |
| `eve` | eve@acme.com | Engineering member and Data Pipeline lead. Can create logs only. |

**Squads and archives:**

| Squad | Owner | Archives |
| --- | --- | --- |
| Engineering | alice | Platform API, Cloud Infrastructure, Mobile App, Data Pipeline |
| Design | carol | Brand Guidelines, Website Redesign |
| Operations | dave | Incident Runbooks, Onboarding |

---

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `DB_HOST` | MySQL server hostname | `localhost` |
| `DB_USER` | MySQL username | — (required) |
| `DB_PASS` | MySQL password | — (required) |
| `DB_NAME` | MySQL database name | `c2` |
| `MYSQL_ROOT_PASSWORD` | Root password for the Docker MySQL instance | — (required) |
| `APP_URL` | Base URL used in outbound email links | `http://localhost:3000` |
| `CORS_ORIGIN` | Allowed origin for API requests (auto-allows `localhost` in dev) | — |
| `SMTP_HOST` | SMTP server hostname | — (required) |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username | — (required) |
| `SMTP_PASS` | SMTP password | — (required) |
| `SMTP_FROM` | Sender address for outbound email | — |
| `ADMIN_USERNAME` | Username for the auto-created admin super-user | `admin` |
| `ADMIN_EMAIL` | Email address for the auto-created admin super-user | — (required) |
| `ADMIN_PASSWORD` | Password for the admin super-user | — (required) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (enables Google SSO) | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | — |
| `GOOGLE_OAUTH_DOMAIN` | Restrict Google SSO to a specific email domain | — |
| `GITHUB_CLIENT_ID` | GitHub OAuth application client ID | — |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth application client secret | — |

---

## NPM Scripts

Run these from the `cloudcodex/` directory:

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server with hot reload |
| `npm run build` | Build the frontend for production |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint across the codebase |
| `npm test` | Run the full test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with code coverage reporting |

## Makefile Targets

Run these from the project root:

| Target | Description |
| --- | --- |
| `make seed` | Load seed data (wipes existing data first) |
| `make reset-db` | Re-run the init.sql schema then seed |
| `make db-shell` | Open a MySQL shell in the Docker container |

---

## Database Schema

The MySQL database consists of 19 tables:

| Table | Description |
| --- | --- |
| `workspaces` | Top-level workspace units |
| `users` | User accounts, credentials, avatar URLs, and 2FA configuration |
| `oauth_accounts` | Linked Google and GitHub OAuth accounts with encrypted tokens |
| `sessions` | Active login sessions with IP address and user-agent tracking |
| `password_reset_tokens` | Time-limited tokens for password reset and 2FA setup flows |
| `two_factor_codes` | Email-based one-time password codes |
| `user_invitations` | Admin-initiated email invitations for new user onboarding |
| `squads` | Squad groups within workspaces |
| `squad_members` | Membership records with role and granular permission flags |
| `squad_invitations` | Pending, accepted, and declined squad invitations |
| `permissions` | Global user-level permission flags |
| `squad_permissions` | Squad-level default permission settings |
| `archives` | Document archives with three-tier access control (user, squad, workspace) |
| `archive_repos` | Links between archives and GitHub repositories |
| `logs` | Document logs with FULLTEXT-indexed content |
| `versions` | Published version snapshots with release notes |
| `comments` | Inline comments anchored to text ranges |
| `comment_replies` | Threaded replies on comments |
| `favorites` | Per-user favorited logs |

The schema is automatically created on first startup via `init.sql` mounted into the MySQL container's entrypoint directory.

---

## Archive Structure

```
c2/
├── docker-compose.yaml       # MySQL 8 container definition
├── init.sql                  # Database schema (runs on first startup)
├── seed.sql                  # Optional sample data (~60 logs, 5 users)
├── start.sh                  # One-command startup script
├── .env.example              # Environment variable template
│
└── cloudcodex/               # Application root
    ├── app.js                # Express app: middleware, CORS, route mounting
    ├── server.js             # HTTP + WebSocket server startup
    ├── mysql_connect.js      # Connection pool and session management
    │
    ├── middleware/
    │   ├── auth.js           # Session token validation
    │   └── permissions.js    # Permission loading and enforcement
    │
    ├── routes/
    │   ├── admin.js          # Admin console, stats, user invitations
    │   ├── auth.js           # Authentication, 2FA, password reset
    │   ├── avatars.js        # Profile picture upload and removal
    │   ├── comments.js       # Comments and replies CRUD
    │   ├── doc-images.js     # Document image upload and processing
    │   ├── documents.js      # Log content, versions, export
    │   ├── github.js         # GitHub API proxy (repos, files, branches, PRs)
    │   ├── oauth.js          # Google SSO and GitHub OAuth flows
    │   ├── workspaces.js     # Workspace management
    │   ├── archives.js       # Archives, log tree, access control, repo linking
    │   ├── favorites.js      # User favorites CRUD
    │   ├── search.js         # Full-text search, browse, and presence
    │   ├── squads.js         # Squads, members, invitations
    │   ├── upload.js         # Document file import
    │   └── helpers/          # Shared validators, access control, image processing, DB helpers
    │
    ├── services/
    │   ├── collab.js         # WebSocket collaboration server (Yjs)
    │   └── email.js          # Email delivery via Nodemailer
    │
    ├── src/                  # React frontend
    │   ├── App.jsx           # Router configuration
    │   ├── main.jsx          # Entry point
    │   ├── index.css         # Global styles
    │   ├── util.jsx          # API helpers, shared utilities (timeAgo, docUrl, TAG_LABELS)
    │   ├── userPrefs.js      # User preference management and shared constants
    │   ├── editorUtils.js    # Editor utility functions (base64, SVG extraction)
    │   ├── components/       # Reusable UI components
    │   ├── pages/            # Top-level page views
    │   ├── page_layouts/     # Layout shells (sidebar, topbar, footer)
    │   └── hooks/            # Custom React hooks (useCollab, usePresence, useClickOutside)
    │
    └── tests/                # Test suite
        ├── setup.js          # Global mocks (DB, email, sharp, fs)
        ├── helpers.js        # Shared test fixtures
        ├── middleware/       # Middleware unit tests
        └── routes/           # API endpoint tests
```

---

## Testing

The test suite uses **Vitest** and **Supertest** with fully mocked database and email layers — no running services are required.

```bash
cd cloudcodex
npm test
```

**495 tests** across 17 test files:

| Test File | Tests | Scope |
| --- | --- | --- |
| `auth.test.js` | 77 | Account creation, login, 2FA, password reset, sessions |
| `comments.test.js` | 58 | Comments, replies, tags, status workflow, access control |
| `documents.test.js` | 45 | Log save, publish, versions, restore, export |
| `archives.test.js` | 50 | Archive and log tree, three-tier access control, repo linking |
| `squads.test.js` | 43 | Squad CRUD, invitations, member roles, permissions |
| `admin.test.js` | 43 | Admin console, stats, user/workspace management, invitations |
| `editorUtils.test.js` | 28 | Editor utility functions and helpers |
| `github.test.js` | 20 | GitHub API proxy, repos, files, branches, PRs |
| `favorites.test.js` | 16 | Favorite add, remove, check, list, access control |
| `workspaces.test.js` | 14 | Workspace CRUD, ownership transfer |
| `search.test.js` | 13 | Full-text search, browse, presence, pagination |
| `oauth.test.js` | 13 | Google SSO, GitHub OAuth, account linking |
| `avatars.test.js` | 12 | Upload, replace, remove, validation, authorization |
| `upload.test.js` | 9 | File import, format conversion, error handling |
| `permissions.test.js` | 8 | Permission middleware, role fallbacks |
| `doc-images.test.js` | 6 | Image upload, processing, deduplication, validation |
| `auth.test.js` (middleware) | 5 | Token validation, session refresh |

---

## Security

Cloud Codex follows security best practices across all layers:

- **SQL injection prevention** — All database queries use parameterized prepared statements
- **Password storage** — bcrypt hashing with 12 salt rounds and constant-time comparison
- **Session management** — Cryptographically random 64-character tokens with 7-day expiry; sessions are invalidated on password change and password reset
- **HTML sanitization** — DOMPurify applied on server writes, WebSocket broadcasts, and client rendering; `data:` URIs restricted to `<img>` tags
- **OAuth token encryption** — GitHub access tokens encrypted at rest with AES-256-GCM (key derived via scrypt); OAuth state tokens expire after 10 minutes
- **Security headers** — Helmet middleware with Content Security Policy
- **Rate limiting** — Auth endpoints (20 requests/15 min), search (60/15 min), WebSocket messages (60/s)
- **WebSocket hardening** — Origin validation, authentication timeout, 5 MB message size limit, per-user connection caps
- **Content size limits** — 2 MB maximum document content, 10 MB maximum image upload
- **CORS** — Configurable allowed origin; localhost bypass is disabled in production
- **Input validation** — Length limits enforced on all user-provided strings
- **Email header injection prevention** — Outbound email fields are sanitized before dispatch

---

## License

Cloud Codex is released under a **source-available license**. You may view, modify, and self-host the software for personal, educational, or internal business use at no cost. Commercial use as a hosted service requires a separate license from [Cloud City Computing, LLC](https://cloudcitycomputing.com).

See [LICENSE](LICENSE) for full terms.

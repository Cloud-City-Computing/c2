# Cloud Codex

A real-time collaborative documentation platform built with React, Express, and MySQL. Features live multi-user editing with CRDT conflict resolution, organization and team management, inline comments and annotations, version history, profile avatars, full-text search, and two-factor authentication.

## Features

### Real-Time Collaboration
- **Live co-editing** — Yjs CRDT-based document sync across multiple simultaneous users
- **Remote cursors & selections** — See other users' cursor positions and text selections in real time
- **Presence indicators** — Colored avatar badges showing who is active on each page
- **WebSocket protocol** — Auth-first handshake, 60 msg/s rate limiting, 5 MB message cap, per-user connection limits

### Document Editing
- **Rich text editor** — Full WYSIWYG editing powered by Jodit
- **Markdown editor** — Source editing with live rendered preview
- **Switchable modes** — Per-user preferred editor mode saved in preferences

### Comments & Annotations
- **Inline comments** — Anchor comments to selected text ranges within documents
- **Tag system** — Categorize as comment, suggestion, question, issue, or note
- **Status workflow** — Open → resolved / dismissed, with attribution and timestamps
- **Threaded replies** — Nested conversation threads on each comment
- **Text highlighting** — Visual overlays for commented text in both editor modes
- **Real-time sync** — Comment events broadcast via WebSocket to all connected clients

### Organizations & Teams
- **Organizations** — Top-level grouping with single-owner management
- **Teams** — Groups within organizations, with role-based membership (member, admin, owner)
- **Invitations** — Invite users to teams with pending/accepted/declined status tracking
- **Granular permissions** — Per-member toggles for read, write, create page, create project, manage members, delete versions, and publish

### Projects & Pages
- **Projects** — Containers for pages, optionally tied to a team
- **Nested page trees** — Hierarchical parent-child page structure with drag-free reordering
- **Access control lists** — Per-project and per-page read/write JSON ACLs
- **Breadcrumb navigation** — Full path display for nested pages

### Version History
- **Version snapshots** — Publish named versions with release notes
- **Version browser** — Browse, preview, and compare historical versions
- **Restore** — Roll back to any previous version with HTML re-sanitization
- **Permission-gated publishing** — Only users with `can_publish` can create snapshots

### Document Import & Export
- **Import** — Upload HTML, Markdown, plain text, PDF, and Word DOCX files as new pages
- **Export** — Download pages as DOCX documents
- **Auto-conversion** — All imported formats converted to sanitized HTML

### Search
- **Full-text search** — MySQL FULLTEXT index across page titles and plain-text content
- **Access-scoped results** — Only returns pages the current user can read
- **Paginated results** — Configurable limit with snippet previews

### User Accounts
- **Profile pictures** — Upload, replace, and remove avatars (resized to 256×256 WebP via Sharp)
- **Account settings** — Update name, email, and password
- **Appearance preferences** — Accent color, font size, UI density, sidebar default, preferred editor mode

### Authentication & Security
- **Session-based auth** — 64-character cryptographically random tokens, 7-day expiry
- **Password reset** — Email-based token flow with session invalidation
- **Two-factor authentication** — Email OTP codes and TOTP authenticator app support with QR code setup
- **Parameterized queries** — All SQL uses prepared statements (no concatenation)
- **HTML sanitization** — DOMPurify on both server and client, `data:` URIs restricted to `<img>` tags
- **Security headers** — Helmet with Content Security Policy
- **Rate limiting** — Auth endpoints (20/15min), search (60/15min), WebSocket messages (60/s)
- **WebSocket hardening** — Origin validation, auth timeout, message size limits, per-user connection caps
- **CORS policy** — Configurable allowed origin, localhost bypass only in development

### Onboarding
- **Welcome setup** — Post-signup wizard to create an organization, team, and first project in one step

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, React Router 7, Vite 7 |
| Rich Text Editor | Jodit React |
| Markdown | Marked (parse), Turndown (HTML→MD) |
| Backend | Express 5, ViteExpress |
| Database | MySQL 8 (Docker) |
| Real-Time | Yjs CRDTs, WebSocket (ws) |
| Image Processing | Sharp |
| Auth | bcrypt (12 rounds), OTPAuth, QRCode |
| Security | Helmet, express-rate-limit, DOMPurify, CORS |
| Email | Nodemailer |
| File Conversion | Mammoth (DOCX→HTML), html-to-docx, pdf-parse |
| Testing | Vitest, Supertest |

## Database Schema

| Table | Purpose |
| --- | --- |
| `organizations` | Top-level organizational units |
| `users` | User accounts with avatar and 2FA settings |
| `sessions` | Active login sessions with IP/UA tracking |
| `password_reset_tokens` | Password reset and 2FA setup tokens |
| `two_factor_codes` | Email-based OTP codes |
| `teams` | Team groups within organizations |
| `team_members` | Membership with role and granular permissions |
| `team_invitations` | Pending team invitations |
| `permissions` | Global user permission flags |
| `team_permissions` | Team-level permission defaults |
| `projects` | Document projects with JSON ACLs |
| `pages` | Document pages with FULLTEXT index |
| `versions` | Published version snapshots |
| `comments` | Inline comments with text anchoring |
| `comment_replies` | Threaded replies on comments |

## Requirements

- **Linux** or **WSL**
- **Docker** with Compose
- **Node.js** 20+
- **npm**

## Quick Start

### 1. Configure environment

```bash
cp .env.example .env
```

Open `.env` and set your database credentials and (optionally) SMTP settings.

### 2. Start the app

```bash
./start.sh
```

This script checks dependencies, starts the MySQL container, installs npm packages, and launches the app at **http://localhost:3000**.

> On Debian/Ubuntu, the script can install missing system packages automatically.

### Manual startup

```bash
# Start the database
docker compose up -d

# Install dependencies and start the dev server
cd cloudcodex
npm install
npm run dev
```

## Environment Variables

All configuration is read from a `.env` file in the repository root. See [.env.example](.env.example) for the full template.

| Variable | Purpose | Required |
| --- | --- | --- |
| `DB_HOST` | MySQL host | No (defaults to `localhost`) |
| `DB_USER` | MySQL user | **Yes** |
| `DB_PASS` | MySQL password | **Yes** |
| `DB_NAME` | MySQL database name | No (defaults to `c2`) |
| `MYSQL_ROOT_PASSWORD` | MySQL root password (used by Docker) | **Yes** |
| `APP_URL` | Base URL for email links | No (defaults to `http://localhost:3000`) |
| `CORS_ORIGIN` | Allowed origin for API requests | No (auto-allows `localhost` in development) |
| `SMTP_HOST` | SMTP server hostname | For email features |
| `SMTP_PORT` | SMTP server port | For email features |
| `SMTP_USER` | SMTP username | For email features |
| `SMTP_PASS` | SMTP password | For email features |
| `SMTP_FROM` | Sender address for outbound email | For email features |

> Password reset and email-based 2FA require valid SMTP credentials.

## Available Scripts

From `cloudcodex/`:

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Build the frontend for production |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run the test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |

## Seed Data

After the database is running, optionally load sample data:

```bash
mysql -u $DB_USER -p -h 127.0.0.1 c2 < seed.sql
```

This creates a sample organization, three users (Alice, Bob, Carol), a team, a project with pages, and permission assignments.

## Testing

Tests use Vitest and Supertest with mocked database and email layers — no external services required.

```bash
cd cloudcodex
npm test
```

**291 tests** across 11 test files covering all API routes and middleware:

| File | Tests | Coverage |
| --- | --- | --- |
| `auth.test.js` | 65 | Account creation, login, 2FA, password reset, sessions, permissions |
| `comments.test.js` | 58 | Comments, replies, tags, status workflow, access control |
| `documents.test.js` | 44 | Page save, publish, versions, restore, export |
| `teams.test.js` | 43 | Team CRUD, invitations, member roles, permissions |
| `projects.test.js` | 28 | Project/page tree, access control, page operations |
| `organizations.test.js` | 13 | Organization CRUD, ownership |
| `avatars.test.js` | 12 | Upload, replace, remove, validation, authorization |
| `upload.test.js` | 9 | File import, format conversion, error handling |
| `search.test.js` | 6 | Full-text search, presence, pagination |
| `permissions.test.js` | 8 | Permission middleware, role fallbacks |
| `auth.test.js` (middleware) | 5 | Token validation, session refresh |

## Project Structure

```
cloudcodex/
├── app.js                  # Express app setup, middleware, CORS, routes
├── server.js               # HTTP server with ViteExpress + WebSocket
├── mysql_connect.js        # Database pool, session management
├── middleware/
│   ├── auth.js             # requireAuth middleware
│   └── permissions.js      # Permission loading & enforcement
├── routes/
│   ├── auth.js             # Auth, 2FA, password reset, user management
│   ├── avatars.js          # Profile picture upload/delete
│   ├── comments.js         # Comments & replies CRUD
│   ├── documents.js        # Page content, versions, export
│   ├── organizations.js    # Organization CRUD
│   ├── projects.js         # Projects & page tree
│   ├── search.js           # Full-text search & presence
│   ├── teams.js            # Teams, members, invitations
│   ├── upload.js           # Document file import
│   └── helpers/
│       ├── shared.js       # Validators, sanitization, access checks
│       └── ownership.js    # SQL access control helpers
├── services/
│   ├── collab.js           # WebSocket collaboration server (Yjs)
│   └── email.js            # Nodemailer email service
├── src/
│   ├── App.jsx             # React Router configuration
│   ├── main.jsx            # React entry point
│   ├── index.css           # Global styles
│   ├── util.jsx            # API fetch, session, modal utilities
│   ├── userPrefs.js        # Local preference persistence
│   ├── components/         # Reusable UI components
│   ├── pages/              # Top-level page views
│   ├── page_layouts/       # Layout shells (sidebar, topbar)
│   └── hooks/              # Custom React hooks
├── tests/
│   ├── setup.js            # Global mocks (DB, email, sharp, fs)
│   ├── helpers.js          # Shared test fixtures
│   ├── middleware/          # Middleware tests
│   └── routes/             # Route endpoint tests
└── public/
    └── avatars/            # Uploaded profile pictures
```

## Security

- Parameterized SQL queries throughout — no string concatenation
- bcrypt password hashing (12 rounds) with constant-time comparison
- Cryptographically random 64-character session tokens
- HTML sanitization via DOMPurify on both server writes and WebSocket broadcasts
- `data:` URI scheme restricted to `<img>` tags only
- Helmet security headers with strict Content Security Policy
- Rate limiting on auth and search endpoints
- WebSocket origin validation, auth timeouts, message size limits, and per-user connection caps
- CORS policy with configurable allowlist, localhost bypass gated to non-production
- Session invalidation on password change and password reset
- Input length validation on all user-provided strings

## License

See [LICENSE](LICENSE) for terms.

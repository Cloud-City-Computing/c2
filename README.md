# Cloud Codex

Cloud Codex is a real-time collaborative documentation and knowledge-management platform built with React, Express, and MySQL. It provides authenticated document editing with live multi-user collaboration, organization and team management, project/page hierarchies, invitation-based membership, version history, search, password reset, and two-factor authentication.

This repository is structured as a small full-stack app:

- `cloudcodex/` contains the React frontend, Express API, and Vite configuration
- `docker-compose.yaml` starts the MySQL 8 database used by the app
- `init.sql` initializes the schema
- `seed.sql` adds optional sample data
- `start.sh` installs dependencies, starts Docker/MySQL, and runs the app locally

## Current Project State

The application currently includes these implemented areas:

- Account creation and login
- Session-based authentication
- Password reset via emailed reset links
- Two-factor authentication with either email codes or authenticator-app TOTP
- Organization creation and management
- Team creation, membership, invitations, and team-level permissions
- Project creation and access control
- Nested page trees inside projects
- Document editing with two modes:
  - Rich text editing with Jodit
  - Markdown editing with live preview
- Real-time collaborative editing via WebSocket:
  - Yjs CRDT-based document sync
  - Live presence indicators showing connected users
  - Remote cursor tracking with colored name labels in both editor modes
  - Debounced auto-save with version snapshots
- Version history with preview, restore, and deletion controls
- Search across pages the current user can read
- User preferences and account settings
- Server-side HTML sanitization on all save paths (REST and WebSocket)

## Security

- Security headers applied to API routes with Helmet (CSP, X-Frame-Options, etc.)
- Rate limiting on login, signup, password reset, 2FA verification, and user search endpoints
- Server-side HTML sanitization with DOMPurify on both REST and WebSocket document saves
- Client-side HTML sanitization on render with DOMPurify
- WebSocket origin validation to prevent Cross-Site WebSocket Hijacking
- WebSocket message size limits (5 MB max payload)
- WebSocket per-connection rate limiting (60 messages/second)
- Per-user WebSocket connection cap (10 concurrent connections)
- Cursor data validation — only numeric position fields are forwarded to peers
- Parameterized SQL queries throughout (no string concatenation in queries)
- Duplicate email prevention on registration
- Privilege escalation prevention on team invitations and member permission updates
- bcrypt password hashing with 12 rounds
- Cryptographically random session tokens (64 characters)

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, React Router 7, Vite 7 |
| Backend | Express 5, ViteExpress |
| Database | MySQL 8 |
| Auth/Security | bcrypt, Helmet, express-rate-limit |
| Editor | Jodit, Marked, Turndown, DOMPurify |
| Collaboration | Yjs, WebSocket (ws) |
| Sanitization | isomorphic-dompurify (server), DOMPurify (client) |
| Email | Nodemailer |
| 2FA | OTPAuth, QRCode |
| Testing | Vitest, Supertest |
| CI | GitHub Actions |
| Tooling | ESLint 9 |

## Repository Layout

```text
.
├── .github/
│   └── workflows/
│       └── ci.yml                  # GitHub Actions CI (lint + tests)
├── cloudcodex/
│   ├── server.js                   # ViteExpress startup + WebSocket attach
│   ├── app.js                      # Express app setup (importable for tests)
│   ├── mysql_connect.js            # MySQL pool and session helpers
│   ├── vitest.config.js            # Test runner configuration
│   ├── services/
│   │   ├── collab.js               # WebSocket collaborative editing server
│   │   └── email.js                # SMTP-backed email service
│   ├── middleware/
│   │   ├── auth.js                 # Session auth middleware
│   │   └── permissions.js          # Permission gate helpers
│   ├── routes/
│   │   ├── auth.js                 # Accounts, sessions, reset, 2FA, permissions
│   │   ├── documents.js            # Document fetch/save/version APIs
│   │   ├── organizations.js        # Organization CRUD
│   │   ├── projects.js             # Projects, pages, access control
│   │   ├── search.js               # Page search
│   │   ├── teams.js                # Teams, members, invitations
│   │   └── helpers/
│   │       └── ownership.js        # Read/write access SQL helpers
│   ├── tests/
│   │   ├── setup.js                # Global mocks (DB, email)
│   │   ├── helpers.js              # Shared test utilities
│   │   ├── middleware/
│   │   │   ├── auth.test.js
│   │   │   └── permissions.test.js
│   │   └── routes/
│   │       ├── auth.test.js
│   │       ├── documents.test.js
│   │       ├── organizations.test.js
│   │       ├── projects.test.js
│   │       ├── search.test.js
│   │       └── teams.test.js
│   ├── src/
│   │   ├── App.jsx                 # Frontend routes
│   │   ├── main.jsx                # React entry point
│   │   ├── index.css               # Global styles
│   │   ├── util.jsx                # API helpers and modal helpers
│   │   ├── userPrefs.js            # Editor mode preferences
│   │   ├── hooks/
│   │   │   └── useCollab.js        # WebSocket collab React hook
│   │   ├── components/
│   │   │   ├── AccountMenu.jsx
│   │   │   ├── AccountPanel.jsx
│   │   │   ├── CollabPresence.jsx  # Connected-user avatars
│   │   │   ├── ConfirmDialog.jsx
│   │   │   ├── Login.jsx
│   │   │   ├── ProjectBrowser.jsx
│   │   │   ├── RemoteCursors.jsx   # Remote cursor overlays
│   │   │   ├── SearchBox.jsx
│   │   │   └── SearchResultItem.jsx
│   │   ├── pages/
│   │   │   ├── AccountSettings.jsx
│   │   │   ├── Editor.jsx          # Document editor with collab
│   │   │   ├── HomePage.jsx
│   │   │   ├── OrganizationsPage.jsx
│   │   │   ├── ProjectsPage.jsx
│   │   │   ├── ResetPasswordPage.jsx
│   │   │   ├── SettingsPage.jsx
│   │   │   └── TeamsPage.jsx
│   │   ├── page_layouts/
│   │   └── assets/
│   ├── public/
│   ├── package.json
│   ├── eslint.config.js
│   ├── vite.config.js
│   └── index.html
├── docker-compose.yaml             # Local MySQL 8 container
├── init.sql                        # Schema bootstrap
├── seed.sql                        # Optional seed data
├── start.sh                        # One-command local startup
└── docs/
    └── database.MD                 # Short DB access note
```

## Requirements

- Linux or WSL is the intended local environment
- Docker with Compose support
- Node.js 20+
- npm

The included `start.sh` script can install missing system dependencies on Debian/Ubuntu-based environments.

## Local Development

### Recommended startup

Run the root startup script:

```bash
./start.sh
```

What it does:

- checks for Docker, Compose, Node.js, npm, and a MySQL client
- installs missing packages on Debian/Ubuntu systems when needed
- starts the MySQL container
- waits for the database to accept connections
- installs npm dependencies in `cloudcodex/`
- starts the app on `http://localhost:3000`

### Manual startup

1. Start the database:

```bash
docker compose up -d
```

2. Install app dependencies:

```bash
cd cloudcodex
npm install
```

3. Start the development server:

```bash
npm run dev
```

The app runs on `http://localhost:3000`.

## Database Configuration

The default local database values in the repository are:

- Host: `localhost`
- Port: `3306`
- Database: `c2`
- User: `admin`
- Password: `admin`

The Docker container is configured in `docker-compose.yaml` and stores MySQL data in `db-data/`.

To connect manually from the host:

```bash
mysql -h 127.0.0.1 -P 3306 -u admin -padmin c2
```

## Environment Variables

The app will run locally with the built-in database defaults, but some features rely on environment variables.

### Database

Used by `cloudcodex/mysql_connect.js`:

- `DB_HOST`
- `DB_USER`
- `DB_PASS`
- `DB_NAME`

### App URL

Used when building password reset links:

- `APP_URL`

Default: `http://localhost:3000`

### SMTP

Used by `cloudcodex/services/email.js` for password reset and 2FA email delivery:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

Without valid SMTP settings, email-based flows will not work correctly:

- forgot password
- email 2FA
- authenticator-app setup email delivery
- 2FA disable confirmation email delivery

## Available Scripts

From `cloudcodex/`:

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Express + Vite development server |
| `npm run build` | Build the frontend with Vite |
| `npm run preview` | Preview the Vite production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run backend tests once (CI-friendly) |
| `npm run test:watch` | Run tests in watch mode during development |
| `npm run test:coverage` | Run tests with coverage report |

From the repository root:

| Command | Description |
| --- | --- |
| `./start.sh` | Install/check dependencies, start DB, run app |
| `docker compose up -d` | Start the MySQL container |
| `docker compose down` | Stop the MySQL container |

## Seed Data

To load sample data into the database:

```bash
mysql -uadmin -padmin -h127.0.0.1 c2 < seed.sql
```

Use this only after the schema is available and the database container is running.

## Main Frontend Routes

The current frontend route map includes:

- `/` - home page and recent pages
- `/reset-password` - reset-password form driven by emailed token
- `/editor/:pageId` - document editor
- `/account` - account settings and user preferences
- `/projects` and `/projects/:projectId` - project browser
- `/organizations` and `/organizations/:orgId` - organizations and teams

## Main API Areas

The Express API under `/api` is organized into these groups:

- Account and session APIs
- Permission APIs
- Password reset APIs
- 2FA APIs (email codes and TOTP)
- Organization APIs
- Team, membership, and invitation APIs
- Project and page APIs
- Document and version-history APIs
- Search APIs
- WebSocket collaborative editing (`/collab`)

## Collaborative Editing

The WebSocket-based collaboration server runs alongside the Express API on the same HTTP server. When a user opens a document in the editor:

1. The client connects to `ws://<host>/collab?pageId=<id>&token=<sessionToken>`
2. The server authenticates the token, verifies page access, and joins the user to the document room
3. Document state is managed via a Yjs CRDT — edits are broadcast to all connected peers in real time
4. The server debounce-saves content back to MySQL (3-second delay) and creates version snapshots
5. Presence awareness shows connected users with colored avatars
6. Remote cursors are rendered as colored name labels in both rich text and markdown modes

The collaboration service enforces origin validation, per-connection rate limiting, message size caps, per-user connection limits, cursor data validation, and server-side HTML sanitization before persistence.

## Testing

The backend API has a functional test suite using Vitest and Supertest. Tests mock the database and email layers so they run without any external services.

Run all tests:

```bash
cd cloudcodex
npm test
```

122 tests cover all route groups (auth, documents, projects, organizations, teams, search) and both middleware modules (auth, permissions).

## CI

A GitHub Actions workflow at `.github/workflows/ci.yml` runs lint and tests on every push and pull request to `main`.

## Notes

- This codebase does not currently include a separate production deployment configuration beyond the local development setup
- The WebSocket collaboration server shares the same HTTP server as the Express API
- Email-based features (password reset, email 2FA) require valid SMTP credentials in `.env`

## License

This repository includes a `LICENSE` file at the root. Review that file for the governing license terms.

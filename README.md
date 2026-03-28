# Cloud Codex

Cloud Codex is a documentation and knowledge-management application built with React, Express, and MySQL. The current codebase provides authenticated document editing, organization and team management, project/page hierarchies, invitation-based membership, version history, search, password reset, and two-factor authentication.

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
- Version history with preview, restore, and deletion controls
- Search across pages the current user can read
- User preferences and account settings

What this codebase is not today:

- It is not a real-time collaborative editor
- It does not currently include a separate production deployment configuration beyond the local development setup

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, React Router 7, Vite |
| Backend | Express 5, ViteExpress |
| Database | MySQL 8 |
| Auth/Security | bcrypt, Helmet, express-rate-limit |
| Editor | Jodit, Marked, Turndown, DOMPurify |
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
│       └── ci.yml              # GitHub Actions CI (lint + tests)
├── cloudcodex/
│   ├── server.js               # ViteExpress startup
│   ├── app.js                  # Express app setup (importable for tests)
│   ├── mysql_connect.js        # MySQL pool and session helpers
│   ├── vitest.config.js        # Test runner configuration
│   ├── services/
│   │   └── email.js            # SMTP-backed email service
│   ├── middleware/
│   │   ├── auth.js             # Session auth middleware
│   │   └── permissions.js      # Permission gate helpers
│   ├── routes/
│   │   ├── auth.js             # Accounts, sessions, reset, 2FA, permissions
│   │   ├── documents.js        # Document fetch/save/version APIs
│   │   ├── organizations.js    # Organization CRUD
│   │   ├── projects.js         # Projects, pages, access control
│   │   ├── search.js           # Page search
│   │   ├── teams.js            # Teams, members, invitations
│   │   └── helpers/
│   ├── tests/
│   │   ├── setup.js            # Global mocks (DB, email)
│   │   ├── helpers.js          # Shared test utilities
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
│   │   ├── App.jsx             # Frontend routes
│   │   ├── util.jsx            # API helpers and modal helpers
│   │   ├── page_layouts/
│   │   ├── components/
│   │   └── pages/
│   ├── package.json
│   └── vite.config.js
├── docker-compose.yaml         # Local MySQL 8 container
├── init.sql                    # Schema bootstrap
├── seed.sql                    # Optional seed data
├── start.sh                    # One-command local startup
└── docs/
    └── database.MD             # Short DB access note
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

The Express API under `/api` is currently organized into these groups:

- account and session APIs
- permission APIs
- password reset APIs
- 2FA APIs
- organization APIs
- team, membership, and invitation APIs
- project and page APIs
- document and version-history APIs
- search APIs

## Testing

The backend API has a functional test suite using Vitest and Supertest. Tests mock the database and email layers so they run without any external services.

Run all tests:

```bash
cd cloudcodex
npm test
```

Tests cover all route groups (auth, documents, projects, organizations, teams, search) and both middleware modules (auth, permissions).

## CI

A GitHub Actions workflow at `.github/workflows/ci.yml` runs lint and tests on every push and pull request to `main`.

## Notes

- Security headers are applied to API routes with Helmet
- Rate limiting is enabled for login, signup, password reset, 2FA verification, and user search endpoints
- The document editor sanitizes rendered HTML with DOMPurify
- Search results are limited and filtered by project read access
- Version history is persisted in the database

## License

This repository includes a `LICENSE` file at the root. Review that file for the governing license terms.

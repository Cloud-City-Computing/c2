# Cloud Codex

A real-time collaborative documentation platform built with React, Express, and MySQL. Features live multi-user editing, organization/team management, version history, full-text search, and two-factor authentication.

## Features

- **Real-time collaboration** — Yjs CRDT-based document sync with live presence and remote cursors
- **Dual editor modes** — Rich text (Jodit) and Markdown with live preview
- **Organizations & teams** — Hierarchical access control with invitation-based membership
- **Projects & pages** — Nested page trees with per-user read/write permissions
- **Version history** — Preview, restore, and manage document snapshots
- **Document import/export** — HTML, Markdown, Plain Text, PDF, and Word DOCX
- **Authentication** — Session-based auth, password reset, email 2FA, and TOTP
- **Search** — Full-text search scoped to pages the current user can access

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, React Router 7, Vite 7 |
| Backend | Express 5, ViteExpress |
| Database | MySQL 8 |
| Collaboration | Yjs, WebSocket (ws) |
| Auth | bcrypt, Helmet, express-rate-limit |
| Email | Nodemailer |
| Testing | Vitest, Supertest |
| CI | GitHub Actions |

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
| `npm run lint` | Run ESLint |
| `npm test` | Run the test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |

## Seed Data

After the database is running, optionally load sample data:

```bash
mysql -u $DB_USER -p -h 127.0.0.1 c2 < seed.sql
```

## Testing

Tests use Vitest and Supertest with mocked database and email layers — no external services required.

```bash
cd cloudcodex
npm test
```

CI runs lint and tests on every push and pull request to `main` via GitHub Actions.

## Security

- Parameterized SQL queries throughout
- bcrypt password hashing (12 rounds)
- Cryptographically random session tokens
- Server-side and client-side HTML sanitization (DOMPurify)
- Helmet security headers with CSP
- Rate limiting on auth endpoints
- WebSocket origin validation, message size limits, per-connection rate limiting, and per-user connection caps
- CORS policy restricting cross-origin requests

## License

See [LICENSE](LICENSE) for terms.

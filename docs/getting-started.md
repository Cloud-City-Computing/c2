```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   GETTING STARTED                                                          ║
║   From a clean machine to a running Cloud Codex in five minutes.           ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Getting Started

This guide covers everything you need to run Cloud Codex locally — from
prerequisites through a working application with optional sample data.

```
   ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │  clone  │──►│ cp .env  │──►│ ./start  │──►│ first    │──►│ invite   │
   │  repo   │   │ .example │   │   .sh    │   │ admin    │   │ teammates│
   └─────────┘   └──────────┘   └──────────┘   │ login    │   └──────────┘
                      │              │         └──────────┘
                      ▼              ▼
                 fill DB,       installs deps
                 SMTP, admin    boots MySQL
                 values         starts Vite + API
```

---

## Prerequisites

- **Linux** or **Windows Subsystem for Linux (WSL)**
- **Docker** with Compose v2
- **Node.js** 20 or later
- **npm**

> On Debian/Ubuntu, the included startup script can detect and install missing system packages automatically.

---

## 1. Clone the repository

```bash
git clone <repository-url>
cd c2
```

---

## 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in the required values. At minimum you need database credentials, SMTP credentials, and admin account credentials. **SMTP is required** — the server will not start without valid credentials. It is used for password reset, email-based two-factor authentication, and user invitations.

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

---

## 3. Start the application

### Quickstart (recommended)

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

### Manual setup

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

---

## 4. Load sample data (optional)

A seed script populates the database with a workspace, three squads, eight archives, and ~60 logs of realistic content. This is useful for testing search, pagination, browsing, and collaboration features before creating real content.

```bash
mysql -u $DB_USER -p -h 127.0.0.1 c2 < seed.sql
```

All seed accounts use the password **`password`**.

| Account | Email | Role / Notes |
| --- | --- | --- |
| `alice` | alice@acme.com | Workspace owner. Engineering squad owner. Full permissions. |
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

Run from the `cloudcodex/` directory:

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server with hot reload |
| `npm run build` | Build the frontend for production |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint across the codebase |
| `npm test` | Run the full test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with code coverage reporting |

---

## Makefile Targets

Run from the project root:

| Target | Description |
| --- | --- |
| `make seed` | Load seed data (wipes existing data first) |
| `make reset-db` | Re-run the init.sql schema then seed |
| `make db-shell` | Open a MySQL shell in the Docker container |

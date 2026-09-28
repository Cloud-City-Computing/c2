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
                 admin values   boots MySQL
                 (SMTP is       starts Vite + API
                 optional)
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

Open `.env` and fill in the required values. At minimum you need database credentials and admin account credentials. **SMTP is optional**: leave it blank and the server still starts. With mail disabled: invitations are still created and their signup link is shown copyable in the admin UI instead of emailed, password reset reports itself unavailable rather than silently failing, and email-based two-factor authentication is refused (authenticator-app TOTP still works, showing its QR code and secret in the app instead of emailing them). Squad invitations still work either way and still raise the in-app notification. **If you turn SMTP off on an instance that already had it**, note that any account already using email 2FA can no longer log in, and no account can turn 2FA off, because both flows confirm with an emailed code. An administrator clears that from the Admin console, or with `POST /api/admin/users/:id/2fa/reset`, without needing mail.

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

# ─── SMTP (optional — leave blank to run without email) ─────
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

# ─── Runtime (optional) ──────────────────────────────────────
# NODE_ENV=
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

MySQL is published on **127.0.0.1:3306** only, which the dev server, `make`
and a `mysql` client on the same machine reach (`DB_HOST=localhost` works).
Nothing else on your network can reach it, since it runs with a development
password. Set `DB_BIND=0.0.0.0` in `.env` only if you deliberately need it
from another machine. This loopback binding has not been tested under WSL; if
a client there cannot reach `127.0.0.1:3306`, `DB_BIND=0.0.0.0` restores the
previous mapping.

On first boot, once the admin logs in, they land inside a seeded "Getting
Started" archive with a "Welcome to Cloud Codex" document, not an empty app.
This only happens on a database that holds no workspaces, archives or logs at
all; it never touches an install with any content in it.

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
| `DB_POOL_SIZE` | MySQL connections the app keeps open, 1 to 100; anything else stops the boot | `10` |
| `MYSQL_ROOT_PASSWORD` | Root password for the Docker MySQL instance | — (required) |
| `APP_URL` | Base URL used to build invitation/reset links, in emails and in the admin UI's copyable link. **Required in production**: the server will not start without an `http(s)` URL | `http://localhost:3000` in development |
| `PORT` | The port the app listens on; a value that is not a valid port stops the boot | `3000` |
| `TRUST_PROXY` | Which proxies Express believes about the client address, named by address (an address or CIDR list in standard notation, subnet names such as `loopback`, or `false`); the rate limiters count by that address. A hop count, `true`, or a range wider than an IPv4 /8 or an IPv6 /16 (outside `fc00::/7` and `fe80::/10`) stops the boot | `127.0.0.1/32, ::1/128, 172.29.0.1/32` (a proxy on this host, in front of either compose file) |
| `TRUST_PROXY_ALLOW_HOP_COUNT` | `true` accepts a hop count, `true` or an over-wide range in `TRUST_PROXY` anyway, letting any client that can reach the port choose its own address | unset (off) |
| `APP_BIND` | Docker Compose only: the host address the app port is published on. Set `0.0.0.0` only to reach the app from other machines on purpose; an IPv4 address only, never `::` | `127.0.0.1` |
| `DB_BIND` | `docker-compose.yaml` (dev) and `docker-compose-prod.yml`: the host address MySQL's 3306 is published on | `127.0.0.1` |
| `CORS_ORIGIN` | One more origin allowed to call the API, for a separate front end. The app's own origin and `APP_URL`'s are always allowed | unset |
| `C2_INSTANCE_LOCK` | The one-process-per-database lock: a second process on the same schema refuses to start. Only `0` turns it off, as an escape, not a way to run replicas | `1` |
| `DOC_IMAGES_PUBLIC` | Exactly `1` serves document images to anyone with their address, as releases before the per-reader check did. Only for an upgrade that has to start before `npm run backfill:doc-images` has run; see [deployment.md](./deployment.md#the-document-images-backfill-once) | unset (off) |
| `SMTP_HOST` | SMTP server hostname | — (optional; leave blank to run without email) |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username | — (optional; leave blank to run without email) |
| `SMTP_PASS` | SMTP password | — (optional; leave blank to run without email) |
| `SMTP_FROM` | Sender address for outbound email; blank uses the default | `Cloud Codex <noreply@cloudcitycomputing.com>` |
| `ADMIN_USERNAME` | Username for the admin super-user. Boot creates it, or syncs an existing admin, and never promotes a non-admin (`.env.example` ships `admin`) | (required) |
| `ADMIN_EMAIL` | Email address for the auto-created admin super-user | — (required) |
| `ADMIN_PASSWORD` | Password for the admin super-user | — (required) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (enables Google SSO) | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | — |
| `GOOGLE_OAUTH_DOMAIN` | Restrict Google SSO to a specific email domain | — |
| `AUTH_PROVIDERS` | Sign-in methods to offer, a comma list of `local` and `google`. Leave unset: the server derives it (local, plus Google when configured) and refuses to start on a value that disagrees with the Google variables | unset |
| `GITHUB_CLIENT_ID` | GitHub OAuth application client ID | — |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth application client secret | — |
| `NODE_ENV` | `production` serves the built frontend and puts the security headers on every response; the Docker image and `npm run start` set it. In every mode the API accepts the app's own origin, `APP_URL`'s and `CORS_ORIGIN`; outside production it also accepts any `localhost` or `127.0.0.1` origin, for the Vite dev server | unset (development) |
| `SERVICE_TOKEN` | Optional, and off unless `SERVICE_TOKEN_USER` is set too. A secret of at least 32 characters with which another service, such as Cloud Command, reads `GET /api/search`, `GET /api/browse` and `GET /api/documents/state`, and nothing else | unset (off) |
| `SERVICE_TOKEN_USER` | The email of the existing non-admin user whose read access the service token acts with | unset (off) |

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

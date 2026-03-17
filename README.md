# Cloud Codex

**A modern, collaborative documentation platform built for development and technical support teams.**

Cloud Codex solves the persistent challenge of creating, organizing, and sharing technical documentation across engineering and support organizations. It provides a centralized workspace where teams can author rich documents, manage access at a granular level, and keep knowledge discoverable — all through a clean, modern interface.

> All Rights Reserved to Cloud City Computing, LLC 2026
> [cloudcitycomputing.com](https://cloudcitycomputing.com)

---

## Features

### Document Editing
- **Rich Text Editor** — Full WYSIWYG editing powered by Jodit with formatting, tables, images, and more.
- **Markdown Editor** — Split-pane Markdown mode with a live HTML preview for developers who prefer plaintext workflows.
- **Version History** — Every save creates a version snapshot, allowing you to browse and restore previous revisions.

### Organization & Access
- **Organizations** — Top-level grouping for companies or departments.
- **Teams** — Create teams within organizations and manage members with granular permissions (read, write, create pages, create projects, manage members).
- **Projects & Pages** — Organize documents into projects. Control read/write access per project with user-level and team-level permissions.
- **Team Invitations** — Invite users to teams with customizable permission sets. Invitees accept or decline from their dashboard.

### Search & Navigation
- **Full-Text Search** — Search across all pages you have access to, with highlighted excerpt previews.
- **Recent Pages Dashboard** — Quick access to your most recently edited documents on the home page.
- **Collapsible Sidebar** — Persistent navigation that collapses to icons and expands on hover.

### Security
- **Authentication** — Secure account creation and login with bcrypt password hashing and cryptographic session tokens.
- **Access Control** — Fine-grained read/write permissions on every project and page, enforced server-side.
- **XSS Protection** — All user-generated HTML is sanitized with DOMPurify before rendering.
- **Security Headers** — Helmet.js provides standard HTTP security headers on all API responses.
- **Rate Limiting** — Brute-force protection on authentication endpoints.

---

## Tech Stack

| Layer      | Technology                             |
|------------|----------------------------------------|
| Frontend   | React 19, React Router, Vite           |
| Backend    | Express 5, ViteExpress                 |
| Database   | MySQL 8 (Docker)                       |
| Editor     | Jodit (WYSIWYG), Marked + Turndown (Markdown) |
| Security   | bcrypt, DOMPurify, Helmet, express-rate-limit |

---

## Getting Started

### Prerequisites

- **Node.js** 20+ and **npm**
- **Docker** and **Docker Compose**
- A Linux or WSL environment (the startup script handles dependency installation on Debian/Ubuntu)

### Quick Start (Recommended)

The included startup script checks for dependencies, starts the database container, waits for MySQL to be ready, installs npm packages, and launches the dev server — all in one command:

```bash
./start.sh
```

The application will be available at **http://localhost:3000**.

### Manual Setup

If you prefer to run each step yourself:

1. **Start the database**

   ```bash
   docker compose up -d
   ```

   This launches a MySQL 8 container with the schema automatically initialized from `init.sql`. The database is accessible at `127.0.0.1:3306` (user: `admin`, password: `admin`, database: `c2`).

2. **Install dependencies**

   ```bash
   cd cloudcodex
   npm install
   ```

3. **Start the dev server**

   ```bash
   npm run dev
   ```

   This starts the Express API and Vite dev server together on **http://localhost:3000** with hot module replacement enabled.

### Useful Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the development server (API + frontend) |
| `npm run build` | Build the frontend for production |
| `npm run lint` | Run ESLint across the codebase |
| `docker compose up -d` | Start the MySQL database container |
| `docker compose down` | Stop the database container |
| `mysql -uadmin -padmin -h127.0.0.1 c2` | Connect to the database from the host |

### Seeding Test Data

To populate the database with sample organizations, users, and projects:

```bash
mysql -uadmin -padmin -h127.0.0.1 c2 < seed.sql
```

---

## Project Structure

```
├── docker-compose.yaml    # MySQL 8 container configuration
├── init.sql               # Database schema (auto-runs on first container start)
├── seed.sql               # Optional test data
├── start.sh               # One-command setup & launch script
├── docs/                  # Additional documentation
└── cloudcodex/            # Application source
    ├── server.js          # Express API entry point
    ├── mysql_connect.js   # Database connection pool
    ├── middleware/         # Auth & permission middleware
    ├── routes/            # API route handlers
    │   ├── auth.js        #   Authentication & user management
    │   ├── documents.js   #   Page CRUD & version history
    │   ├── organizations.js # Organization management
    │   ├── projects.js    #   Project & access management
    │   ├── search.js      #   Full-text search
    │   └── teams.js       #   Teams, members & invitations
    └── src/               # React frontend
        ├── App.jsx        #   Router & top-level routes
        ├── components/    #   Reusable UI components
        ├── pages/         #   Page-level views
        ├── page_layouts/  #   Layout wrappers (sidebar, etc.)
        └── util.jsx       #   API helper functions
```

---

## Contact

- [Kyle Adams](https://www.linkedin.com/in/kyleadams12/) — Founder & Co-Owner
- [Dylan Fodor](https://www.linkedin.com/in/dylan-fodor/) — Co-Owner

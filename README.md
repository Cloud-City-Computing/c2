<p align="center">
  <img src="cloudcodex/src/assets/ccc_brand/ccc_no_txt_transparent.png" alt="Cloud Codex" width="120" />
</p>

<h1 align="center">Cloud Codex</h1>

<p align="center">
  A real-time collaborative documentation platform by <a href="https://cloudcitycomputing.com">Cloud City Computing, LLC</a>
</p>

<p align="center">
  <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/RhykerWells/c2/ci.yml?branch=main&label=CI" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-1128%20passing-brightgreen" />
  <img alt="Coverage (lines)" src="https://img.shields.io/badge/coverage%20(lines)-43%25-yellow" />
  <img alt="Node" src="https://img.shields.io/badge/node-20.x-339933" />
</p>

> The CI badge tracks the workflow run; the test count and coverage badge
> reflect the latest known numbers (run `npm run test:coverage` from
> `cloudcodex/` to refresh locally). Coverage is enforced via per-glob
> thresholds in `cloudcodex/vitest.config.js` — see
> [`cloudcodex/tests/README.md`](cloudcodex/tests/README.md) for testing
> patterns.

---

## About

Cloud Codex is a self-hosted documentation platform that lets squads write, organize, and collaborate on documents in real time. Multiple users can edit the same log simultaneously with conflict-free merging, leave inline comments and annotations, manage access through workspaces and squads, and track change history with publishable versions — all from a modern browser-based interface.

It is designed for teams that want full control over their documentation infrastructure without relying on third-party SaaS platforms. It runs entirely on your own hardware or cloud with a single Docker container for the database and a Node.js application server.

---

## Who Is This For?

Cloud Codex is a good fit for teams that:

- Need a **self-hosted** alternative to Notion, Confluence, or similar platforms
- Want **real-time collaborative editing** with CRDT-based conflict resolution, not last-write-wins
- Operate with **squads and workspaces** and need granular, role-based access control per document
- Want to keep documentation and **GitHub repository work** in the same interface
- Require **invite-only user management** rather than open public registration

It is not optimized for public-facing wikis, anonymous access, or very large organizations with complex SSO requirements beyond Google Workspace domain restriction.

---

## What It Supports

| Capability | Details |
| --- | --- |
| Collaborative editing | Yjs CRDTs, remote cursors, live presence indicators |
| Rich text & Markdown | WYSIWYG (Tiptap) and Markdown modes, switchable per user |
| Code blocks | Syntax highlighting for 25 languages with language selector |
| Diagrams | Embedded draw.io diagrams, stored as XML + SVG |
| Images | Paste/drop upload, WebP conversion, resizable in-editor, crop modal |
| Comments | Inline text-anchored comments, threaded replies, tag + status workflow |
| Access control | Three-tier: workspace → squad → per-user read/write grants |
| Version history | Named snapshots with release notes, preview, restore |
| Import / export | HTML, Markdown, plain text, PDF, DOCX in both directions |
| Full-text search | MySQL FULLTEXT index, scoped to accessible documents |
| GitHub integration | File browser, in-browser editing, branch and PR management |
| OAuth / SSO | Google Workspace domain SSO, GitHub account linking |
| Admin console | User invitations, workspace scaffolding, platform statistics |
| 2FA | Email OTP and TOTP authenticator app (QR code setup) |

→ See [docs/features.md](docs/features.md) for detailed descriptions of every feature.

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

## Quick Start

```bash
git clone <repository-url>
cd c2
cp .env.example .env   # fill in DB, SMTP, and admin credentials
./start.sh             # installs deps, starts MySQL, launches dev server
```

The application will be available at **http://localhost:3000**.

→ See [docs/getting-started.md](docs/getting-started.md) for the full setup guide, environment variable reference, NPM scripts, Makefile targets, and sample seed data.

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/getting-started.md](docs/getting-started.md) | Prerequisites, setup, environment variables, scripts, seed data |
| [docs/features.md](docs/features.md) | Detailed descriptions of every feature |
| [docs/security.md](docs/security.md) | Security model — auth, sanitization, encryption, rate limiting |
| [docs/testing.md](docs/testing.md) | Test suite overview and per-file breakdown |
| [docs/architecture.md](docs/architecture.md) | System design, project structure, key design decisions |
| [docs/database.md](docs/database.md) | Full MySQL schema — all 19 tables, columns, indexes |
| [docs/access-control.md](docs/access-control.md) | Three-tier access control resolution logic |
| [docs/services.md](docs/services.md) | Collaborative editing (Yjs/WebSocket), email, DB module |
| [docs/frontend.md](docs/frontend.md) | React app routing, pages, components, build setup |
| [docs/README.md](docs/README.md) | API reference index |

---

## License

Cloud Codex is released under a **source-available license**. You may view, modify, and self-host the software for personal, educational, or internal business use at no cost. Commercial use as a hosted service requires a separate license from [Cloud City Computing, LLC](https://cloudcitycomputing.com).

See [LICENSE](LICENSE) for full terms.

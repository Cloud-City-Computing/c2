<p align="center">
  <img src="../cloudcodex/src/assets/ccc_brand/ccc_no_txt_transparent.png" alt="Cloud Codex" width="120" />
</p>

<h1 align="center">Cloud Codex</h1>

<p align="center">
  A real-time collaborative documentation platform by <a href="https://cloudcitycomputing.com">Cloud City Computing, LLC</a>
</p>

## Start Here

→ **[Getting Started](./getting-started.md)** — Prerequisites, environment setup, running the application, and seed data.

→ **[Architecture Overview](./architecture.md)** — System design, project structure, and key design decisions.


## References

| Document | Summary |
|----------|---------|
| [getting-started.md](./getting-started.md) | Prerequisites, setup, environment variables, NPM scripts, Makefile targets, seed data |
| [features.md](./features.md) | Detailed descriptions of every feature |
| [security.md](./security.md) | Security model — auth, sanitization, encryption, headers, rate limiting |
| [testing.md](./testing.md) | Test suite overview and per-file breakdown (528 tests, 17 files) |
| [architecture.md](./architecture.md) | High-level system overview, design decisions, project structure |
| [database.md](./database.md) | Complete MySQL schema reference — all 19 tables, columns, indexes, and relationships |
| [access-control.md](./access-control.md) | How read/write permissions are resolved across the workspace → squad → archive → log hierarchy |
| [services.md](./services.md) | Collaborative editing (Yjs/WebSocket), email service, DB module, middleware |
| [frontend.md](./frontend.md) | React app routing, pages, components, auth flow, build setup |

## API Reference

| Document | Endpoints covered |
|----------|-------------------|
| [api/auth.md](./api/auth.md) | Login, signup (invite-only), 2FA, password reset, session management |
| [api/workspaces-squads-archives.md](./api/workspaces-squads-archives.md) | Workspaces, squads, squad members, archives, access grants |
| [api/documents.md](./api/documents.md) | Document CRUD, autosave, publish, version history, export (Markdown/DOCX) |
| [api/comments.md](./api/comments.md) | Document comments, replies, status, text-selection anchors |
| [api/search-favorites.md](./api/search-favorites.md) | Full-text search, browse, favorites |
| [api/admin.md](./api/admin.md) | User/workspace management, invitations, permissions, live presence telemetry |
| [api/oauth-github.md](./api/oauth-github.md) | Google SSO, GitHub OAuth, GitHub repo browser and file sync proxy |


## License

Cloud Codex is released under a **source-available license**. You may view, modify, and self-host the software for personal, educational, or internal business use at no cost. Commercial use as a hosted service requires a separate license from [Cloud City Computing, LLC](https://cloudcitycomputing.com).

See [../LICENSE](../LICENSE) for full terms.

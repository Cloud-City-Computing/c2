# Cloud Codex — Documentation

Technical specification and reference documentation for the Cloud Codex platform.

---

## Start Here

→ **[Architecture Overview](./architecture.md)** — System design, project structure, environment setup, and links to all other docs.

---

## References

| Document | Summary |
|----------|---------|
| [architecture.md](./architecture.md) | High-level system overview, design decisions, project structure |
| [database.md](./database.md) | Complete MySQL schema reference — all 17 tables, columns, indexes, and relationships |
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

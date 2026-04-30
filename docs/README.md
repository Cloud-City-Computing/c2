<p align="center">
  <img src="../cloudcodex/src/assets/ccc_brand/ccc_no_txt_transparent.png" alt="Cloud Codex" width="120" />
</p>

<h1 align="center">Cloud Codex — Documentation</h1>

<p align="center">
  A real-time collaborative documentation platform by <a href="https://cloudcitycomputing.com">Cloud City Computing, LLC</a>
</p>

```
   ┌──────────────────────────────┐
   │   Start Here                 │
   └─────────┬─────────┬──────────┘
             │         │
             ▼         ▼
        getting-   architecture
        started
             │         │
             └────┬────┘
                  │
       ┌──────────┼──────────────────────────────────┐
       ▼          ▼              ▼                   ▼
   features   access-control   security        deployment
                  │              │                   │
                  │              └─► testing         │
                  │                                  │
                  ▼                                  ▼
            services / notifications          troubleshooting
                  │
                  ▼
              frontend
                  │
                  ▼
   ┌──────────────────────────────────────────────────┐
   │                 API Reference                    │
   │    auth · workspaces-squads-archives             │
   │    documents · comments · search-favorites       │
   │    notifications · activity-watches              │
   │    admin · oauth-github                          │
   └──────────────────────────────────────────────────┘
```

## Start Here

→ **[Getting Started](./getting-started.md)** — Prerequisites, environment setup, running the application, and seed data.

→ **[Architecture Overview](./architecture.md)** — System design, project structure, key design decisions, full tech stack.


## References

| Document | Summary |
|----------|---------|
| [getting-started.md](./getting-started.md) | Prerequisites, setup, environment variables, NPM scripts, Makefile targets, seed data |
| [features.md](./features.md) | Detailed descriptions of every feature |
| [architecture.md](./architecture.md) | System overview, design decisions, project structure, tech stack |
| [database.md](./database.md) | Complete MySQL schema reference — 25 tables, columns, indexes, relationships, migrations list |
| [access-control.md](./access-control.md) | Layered access control — 7-priority resolution flowchart |
| [services.md](./services.md) | Collab WebSocket, notifications, user-channel WS, email, DB module, middleware |
| [notifications.md](./notifications.md) | Notifications subsystem — funnel, coalescing, triggers, preferences |
| [frontend.md](./frontend.md) | React app routing, pages, hooks, components, build setup |
| [security.md](./security.md) | Defense-in-depth model — auth, sanitization, encryption, headers, rate limiting |
| [testing.md](./testing.md) | Two Vitest projects, 1128 tests across 57 files, per-glob coverage thresholds |
| [deployment.md](./deployment.md) | Production operations — Docker Compose, TLS, backups, upgrades, logs |
| [troubleshooting.md](./troubleshooting.md) | Common setup/runtime failures and the fix for each |

## API Reference

| Document | Endpoints covered |
|----------|-------------------|
| [api/auth.md](./api/auth.md) | Login, signup (invite-only), 2FA, password reset, session management |
| [api/workspaces-squads-archives.md](./api/workspaces-squads-archives.md) | Workspaces, squads, squad members, archives, access grants, archive ↔ repo links |
| [api/documents.md](./api/documents.md) | Document CRUD, autosave, publish, version history, export (Markdown/DOCX) |
| [api/comments.md](./api/comments.md) | Document comments, replies, status, text-selection anchors |
| [api/search-favorites.md](./api/search-favorites.md) | Full-text search, browse, favorites |
| [api/notifications.md](./api/notifications.md) | Inbox, unread badge, preferences |
| [api/activity-watches.md](./api/activity-watches.md) | Workspace activity stream + per-user watches |
| [api/admin.md](./api/admin.md) | User/workspace management, invitations, permissions, live presence telemetry |
| [api/oauth-github.md](./api/oauth-github.md) | Google SSO, GitHub OAuth, 40+ GitHub repo / PR / issue / embed proxy endpoints |


## License

Cloud Codex is released under a **source-available license**. You may view, modify, and self-host the software for personal, educational, or internal business use at no cost. Commercial use as a hosted service requires a separate license from [Cloud City Computing, LLC](https://cloudcitycomputing.com).

See [../LICENSE](../LICENSE) for full terms.

---

## ASCII conventions (for contributors)

The docs use a consistent ASCII visual style — please match it when adding
new content:

- **Banners** use a `╔══...══╗` box, max width **78 columns**, with title
  in caps and a short subtitle below.
- **Diagrams** use heavy box-drawing (`┃ ━ ┏ ┛`) for primary flows and
  light (`│ ─ ┌ ┘`) for secondary structure. Arrows: `▼ ▲ ◀ ▶` for
  flow, `─►` for lighter pointers.
- **API doc banners** use the slim `─── ◆ ───` style instead — the API
  pages are reference docs and shouldn't carry chrome.
- **All ASCII inside fenced code blocks** so GitHub doesn't reflow it.
- **No emoji** in ASCII — visual weight comes from box characters and
  whitespace.
- **78-column max width** — keeps everything readable in terminal,
  GitHub, and IDE markdown previews.

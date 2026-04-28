# Cloud Codex — Agent Guide

> Self-hosted, real-time collaborative documentation platform.
> Confluence/Notion alternative for teams that need to own their data.
> © Cloud City Computing, LLC.

## What this product is

**Cloud Codex** is a multi-user web app for creating, editing, and organizing
team documentation. Differentiating capabilities:

- **Real-time collaborative editing** via Yjs CRDT — multiple users edit the
  same document simultaneously with conflict-free merging, not last-write-wins.
- **Hierarchical organization**: Workspaces → Squads → Archives → Logs (documents).
- **Layered access control** (admin → user grants → creator → workspace owner →
  squad role → squad grants → workspace-wide flag).
- **Invite-only registration** (no public signup; admin issues invite tokens).
- **GitHub integration** as a live API proxy: browse repos, edit files, manage
  branches/PRs, link documents to GitHub files. No webhooks, no background sync.
- **Self-hosted**: Docker Compose for dev and prod. MySQL 8 + Node 20.

The "c2" repo name is a legacy codename — refer to the product as **Cloud Codex**
in user-facing strings, comments, and commit messages.

## Repository layout (the dual-root quirk)

The repo root holds Docker, docs, and SQL. The Node application lives one level
down in `cloudcodex/`. **Run all `npm` commands from `cloudcodex/`.**

```
c2/                              ← repo root (Docker, docs, SQL, Make)
├── docker-compose.yaml          ← dev: MySQL only
├── docker-compose-prod.yml      ← prod: MySQL + app
├── docker-compose.linux.yml     ← WSL variant
├── Makefile                     ← seed, reset-db, db-shell
├── start.sh                     ← one-shot dev bootstrap
├── init.sql / seed.sql          ← schema + sample data
├── migrations/                  ← incremental SQL migrations
├── docs/                        ← human-facing architecture docs (read these!)
├── .github/workflows/ci.yml     ← lint + test on push/PR to main
└── cloudcodex/                  ← the Node application
    ├── app.js                   ← Express app (middleware, route mounting)
    ├── server.js                ← entry point (verifies SMTP + admin)
    ├── mysql_connect.js         ← DB pool, sessions, c2_query()
    ├── vite.config.js           ← code-splitting strategy (read before adding deps)
    ├── eslint.config.js         ← strict flat config
    ├── routes/                  ← API endpoints
    │   ├── helpers/             ← shared.js, ownership.js, images.js — REUSE THESE
    │   ├── auth.js, documents.js, archives.js, workspaces.js, squads.js,
    │   ├── comments.js, search.js, favorites.js, admin.js,
    │   ├── oauth.js, github.js, avatars.js, doc-images.js, upload.js
    ├── middleware/              ← auth.js (requireAuth, requireAdmin), permissions.js
    ├── services/                ← collab.js (Yjs WS), email.js (Nodemailer)
    ├── src/                     ← React frontend
    │   ├── App.jsx              ← router + lazy-loaded pages
    │   ├── pages/               ← full-page components
    │   ├── components/          ← reusable UI
    │   ├── hooks/               ← useCollab, usePresence, useClickOutside, useGitHubStatus
    │   ├── util.jsx             ← apiFetch + API wrappers — USE THIS for new calls
    │   ├── userPrefs.js         ← localStorage prefs + theme constants
    │   └── editorUtils.js       ← editor-specific helpers
    ├── public/                  ← uploaded avatars, document images
    └── tests/                   ← Vitest + Supertest, mirrors routes/
```

## Application areas (what already exists)

Before writing new code in any of these areas, **read the existing files**.
Most "new feature" work is extension, not greenfield.

### Auth & accounts — `routes/auth.js`, `routes/oauth.js`, `middleware/auth.js`
Email+password login, signup via invite token, password reset, two-factor (email
OTP and TOTP with QR), session tokens (DB-backed, auto-refreshing), Google
Workspace SSO, GitHub OAuth (token AES-256-GCM encrypted at rest). Use
`requireAuth` and `requireAdmin` from `middleware/auth.js` on any new protected
route.

### Org hierarchy — `routes/workspaces.js`, `routes/squads.js`, `routes/archives.js`
Workspaces own squads; squads own archives; archives own logs. Squad members
have roles (member/admin/owner) and per-member permission flags
(read/write/create_log/create_archive/manage_members/delete_version/publish).
Squad invitations have a pending/accepted/declined lifecycle. **All access
checks go through `routes/helpers/ownership.js` — do not re-derive permission
SQL inline.**

### Documents & editor — `routes/documents.js`, `src/pages/Editor.jsx`, `services/collab.js`
Logs (documents) have **dual-state storage**: `html_content` (human-readable,
written by REST saves and exports) and `ydoc_state` BLOB (binary CRDT state for
live sync restore). The Yjs WebSocket server in `services/collab.js` debounces
saves on a 3-second window. Editor uses Tiptap 3 + ProseMirror with Lowlight
syntax highlighting, draw.io diagrams, and resizable images.

### Comments — `routes/comments.js`, `src/components/Comment*.jsx`
Text-anchored inline comments (selection_start/end), tags
(comment/suggestion/question/issue/note), open→resolved/dismissed status,
threaded replies, real-time WS broadcast via the collab service.

### Versions & publishing — `routes/documents.js` (`/document/:logId/publish`, `/versions/*`)
Named snapshots with release notes. Publish is permission-gated. Restore writes
back to current state. Version delete is permission-gated.

### Import / Export — `routes/upload.js`, `routes/documents.js` (`/export`)
Import: HTML, Markdown, plain text, PDF (`pdf-parse`), DOCX (`mammoth`).
Export: DOCX (`html-to-docx`), HTML, Markdown (`turndown`), plain text, PDF
(browser print). Image extraction/inlining handled by `routes/helpers/images.js`.

### Search & browse — `routes/search.js`
MySQL FULLTEXT index on `logs(title, plain_content)`. No external search
service. `/browse` returns recent + favorited documents for users with no
query. **Do not propose Elasticsearch/Meilisearch/etc. without a strong reason.**

### Favorites — `routes/favorites.js`
Per-user mark/unmark/list/check.

### GitHub integration — `routes/github.js`, `src/pages/GitHubPage.jsx`, `src/hooks/useGitHubStatus.js`
Live API proxy. Repo list, branch list/create, file tree (text-file filtered),
read/write/delete/rename file contents, PRs (list/create/view), commit history,
file search. Document↔GitHub-file linking via `github_links` table. UI hides
GitHub action when user hasn't linked their account — use `useGitHubStatus`.

### Admin console — `routes/admin.js`, `src/pages/AdminPage.jsx`
Platform stats, workspace/user/invitation/squad management, live presence
telemetry, permission flag toggles. Admin user is auto-synced from `.env` on
startup (see `server.js`).

### User preferences — `src/userPrefs.js`
Editor mode (WYSIWYG vs Markdown), accent color, font size, layout density.
Stored in localStorage. New preferences go through `loadUserPrefs` /
`saveUserPrefs` and `applyPrefsToDOM` — don't write to localStorage directly.

## Critical architectural decisions (don't undo without discussing)

1. **Single Node process** runs Express, Vite (in dev), and the Yjs WebSocket
   server. No external broker, no separate collab service.
2. **Dual-state document storage** (`html_content` + `ydoc_state`). REST saves
   write `html_content`; live editing writes `ydoc_state`. Both must stay in
   sync after a publish/save.
3. **MySQL FULLTEXT only** for search. No external index.
4. **Invite-only signup**. The `users` table is never written without a valid
   invite token, an admin action, or an OAuth flow with a valid provider config.
5. **OAuth tokens encrypted at rest** with AES-256-GCM, key derived from
   `GITHUB_CLIENT_SECRET` via scrypt. Never log raw tokens.
6. **Layered access control** lives in `routes/helpers/ownership.js`. All
   read/write checks compose `readAccessWhere()`/`writeAccessWhere()` SQL
   fragments and pass `readAccessParams(user)`/`writeAccessParams(user)`. This
   resolves admin → user JSON → creator → workspace owner → squad role → squad
   JSON → workspace-wide flag in one query. Don't shortcut it.

## Development commands

All `npm` commands run from `cloudcodex/` unless noted.

```
npm install                  # install deps
npm run dev                  # Vite HMR + Express, single process
npm run build                # production frontend build
npm run preview              # preview the prod build
npm run lint                 # ESLint over the whole package
npm test                     # Vitest, single run
npm run test:watch           # Vitest watch
npm run test:coverage        # coverage report
```

From the repo root:

```
make seed                    # load seed.sql
make reset-db                # rerun init.sql + seed.sql
make db-shell                # mysql CLI in the Docker container
./start.sh                   # one-shot bootstrap (deps, Docker, dev)
```

CI (`.github/workflows/ci.yml`) runs `npm ci && npm run lint && npm test` on
push and PR to `main`. **There are no pre-commit hooks** — local lint/test is
on you.

## Rules

### Reuse before adding

The single most common failure mode for an AI agent in this repo is to write a
new helper that already exists. **Before adding any utility, search for an
existing one.**

| Need                                       | Use                                                       |
|--------------------------------------------|-----------------------------------------------------------|
| Validate a numeric ID                      | `isValidId` in `routes/helpers/shared.js`                 |
| Wrap an async route handler                | `asyncHandler` in `routes/helpers/shared.js`              |
| Sanitize user-supplied HTML                | `sanitizeHtml` in `routes/helpers/shared.js`              |
| Read or write access SQL fragments         | `routes/helpers/ownership.js`                             |
| Check log read/write access in code        | `checkLogReadAccess` / `checkLogWriteAccess` in `shared.js` |
| Require authentication on a route          | `requireAuth` in `middleware/auth.js`                     |
| Require admin on a route                   | `requireAdmin` in `middleware/auth.js`                    |
| Require a permission flag                  | `requirePermission(flag)` in `middleware/permissions.js`  |
| Run a SQL query                            | `c2_query(sql, params)` in `mysql_connect.js`             |
| Make an authenticated frontend API call    | `apiFetch(method, url, data)` in `src/util.jsx`           |
| Read/write user preferences                | `loadUserPrefs` / `saveUserPrefs` in `src/userPrefs.js`   |
| Subscribe to real-time doc updates         | `useCollab` in `src/hooks/useCollab.js`                   |
| Show presence avatars                      | `usePresence` + `<PresenceAvatars>`                       |
| Toast / confirm dialog                     | `<Toast>`, `<ConfirmDialog>` in `src/components/`         |
| Send an email                              | `sendEmail` in `services/email.js`                        |
| Extract / inline images for export         | `routes/helpers/images.js`                                |

If you genuinely need a new helper: place it next to its peers (route helpers
in `routes/helpers/`, frontend utils in `src/`), match the export style of the
file it joins, and add a JSDoc block if it's a public utility.

### Linting and style

ESLint (`eslint.config.js`) is the source of truth. Notable rules:

- `no-var`, `prefer-const`, `eqeqeq` — modern JS only.
- `no-console: warn (allow: [error])` — **never `console.log` in committed
  code**. Use `console.error` for errors with the project format:
  `` `[${new Date().toISOString()}] ${req.method} ${req.path}:` `` plus the error.
- `no-alert` — **don't use `window.alert`** (a couple of legacy disables exist
  in `pages/Editor.jsx` and `pages/GitHubPage.jsx` — don't add more).
- `no-implicit-coercion` — no `!!x` or `+x` shortcuts.
- `react/jsx-no-useless-fragment`, `react/self-closing-comp` — clean JSX.
- `react/jsx-handler-names` — handler props are `onFoo`, handlers are `handleFoo`.
- `react-hooks/exhaustive-deps: warn` — don't silence by adding deps that cause
  loops; reach for `useCallback`/`useRef` first. There are a few `eslint-disable`
  lines in `GitHubPage.jsx` for this — they're load-bearing, leave them.

Run `npm run lint` before declaring done. CI will reject otherwise.

There is no Prettier config and no TypeScript. Match the surrounding file's
style: 2-space indent, single quotes in JS, double quotes in JSX attributes,
trailing semicolons.

### File header

Every source file in `cloudcodex/` opens with:

```javascript
/**
 * <One-line description of what this file does>
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
```

New files match this pattern. Update the year only if the file is genuinely new.

### Naming

- Files: `kebab-case.js` for backend, `PascalCase.jsx` for React components,
  `camelCase.js` for frontend utilities and hooks (e.g., `useCollab.js`).
- Functions and variables: `camelCase`.
- React components: `PascalCase`.
- Constants: `UPPER_SNAKE_CASE` (`BCRYPT_ROUNDS`, `PASSWORD_MIN_LENGTH`).
- API URLs: `/api/kebab-case`.

### Error handling

- Routes return JSON `{ success: false, message: "<human-readable>" }` on
  failure. Some legacy routes omit `success` — if you're touching one, normalize
  it; otherwise leave it.
- HTTP codes: 400 validation, 401 auth, 403 access denied, 404 not found, 409
  conflict (e.g., duplicate email), 413 payload too large, 500 server error.
- Wrap every async route handler in `asyncHandler(...)`.
- Mount `errorHandler` from `routes/helpers/shared.js` at the end of each
  router file.
- Don't introduce a logging library. `console.error` with the established
  format is the convention.
- Don't catch errors just to swallow them. If a handler can't recover, let
  `asyncHandler` forward to `errorHandler`.

### Security (non-negotiable)

- **All SQL is parameterized.** `c2_query('... WHERE id = ?', [id])`. Never
  template-interpolate user input into a query string.
- **All user-supplied HTML passes through `sanitizeHtml`** before it touches
  the DB.
- **All access checks use `ownership.js` helpers.** Never write your own
  permission SQL.
- **Never log secrets** (passwords, OAuth tokens, session tokens, 2FA codes,
  reset tokens, SMTP creds).
- **Email content with user input** sanitizes `\r\n` to prevent header
  injection (see `services/email.js`).
- **Bcrypt rounds = 12.** Don't lower for speed.
- **Rate limiters are deliberate.** `authLimiter` (20/15min) on auth routes,
  `searchLimiter` (60/15min) on user search. New auth-adjacent routes get one.

### Testing

- Framework: **Vitest + Supertest**. Backend routes have ~7700 lines of test
  coverage; the frontend currently does not.
- Tests mirror the source tree: `routes/foo.js` → `tests/routes/foo.test.js`.
- Use the helpers in `tests/helpers.js` (`mockAuthenticated`,
  `mockUnauthenticated`, `resetMocks`, `TEST_USER`, `ADMIN_USER`).
- `tests/setup.js` mocks the DB (`c2_query`), email, image processing, and
  filesystem globally — your tests inherit these.
- **Adding or modifying a backend route requires updating the matching test
  file.** New routes need new tests in the same shape as their neighbors.
- Frontend component tests are not currently expected, but if you add a hook
  or pure-JS utility under `src/`, add a Vitest test.

### Shippability checklist

Before claiming a change is done:

1. `npm run lint` — clean, no new warnings.
2. `npm test` — green.
3. New env vars added to `.env.example` with a comment.
4. New required dependencies added to `package.json` (and code-split in
   `vite.config.js` if they're heavy frontend libs — see `manualChunks`).
5. Any new SQL columns/tables added as a migration in `migrations/` AND as
   part of `init.sql`. Both must stay in sync.
6. Any new admin-visible feature documented in the relevant `docs/*.md`.
7. UI changes verified manually in the browser at the route they affect, on
   both desktop and mobile widths (mobile CSS is a recent investment area).
8. No `console.log` debug statements left in. No commented-out code.
9. No `TODO`/`FIXME` left in committed code without an issue link.

### What NOT to do

- Don't skip access control "just for an internal endpoint" — there are no
  internal endpoints, only public HTTP and the WebSocket.
- Don't bypass `sanitizeHtml` because "this input is trusted" — it isn't.
- Don't add a structured logging library, an APM agent, or a metrics service
  without discussing first. Plain `console.error` is the deliberate choice.
- Don't add a service worker, an external job queue, a Redis dependency, or a
  separate WebSocket server. The single-process architecture is load-bearing
  for self-hosting.
- Don't add Prettier or migrate to TypeScript without discussing first.
- Don't propose Elasticsearch/Meilisearch — MySQL FULLTEXT is the choice.
- Don't `git push --force` on `main`. Don't `--no-verify`.
- Don't ship code with `.only` or `.skip` left in tests.
- Don't write to `localStorage` directly from React — go through `userPrefs`.
- Don't store new secrets in code or in commit history. `.env` only.

## Where to look first when you don't know

- **What does this product do?** → `README.md`, `docs/architecture.md`, `docs/features.md`.
- **How is data shaped?** → `init.sql`, `docs/database.md`.
- **How does access control resolve?** → `docs/access-control.md`, `routes/helpers/ownership.js`.
- **Why does the editor work the way it does?** → `services/collab.js`, `src/pages/Editor.jsx`, `docs/services.md`.
- **What env vars exist?** → `.env.example`.
- **What are the API contracts?** → `docs/api/*.md` (per-area).
- **What's the security model?** → `docs/security.md`.

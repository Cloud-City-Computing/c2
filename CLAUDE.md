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
├── docs/                        ← human-facing architecture docs
│   └── maps/                    ← file:line-cited deep maps, READ THESE FIRST
├── .github/workflows/ci.yml     ← lint + test on push/PR to main
└── cloudcodex/                  ← the Node application
    ├── app.js                   ← Express app (middleware, route mounting)
    ├── server.js                ← entry point (verifies SMTP + admin, WS attach)
    ├── mysql_connect.js         ← DB pool, sessions, c2_query()
    ├── vite.config.js           ← code-splitting strategy (read before adding deps)
    ├── vitest.config.js         ← two projects + 26 per-glob coverage thresholds
    ├── eslint.config.js         ← strict flat config
    ├── routes/                  ← API endpoints
    │   ├── helpers/             ← shared.js, ownership.js, images.js,
    │   │                          activity.js, mentions.js, REUSE THESE
    │   ├── auth.js, documents.js, archives.js, workspaces.js, squads.js,
    │   ├── comments.js, search.js, favorites.js, admin.js,
    │   ├── oauth.js, github.js, avatars.js, doc-images.js, upload.js,
    │   ├── notifications.js, activity.js, watches.js
    ├── middleware/              ← auth.js (requireAuth, requireAdmin), permissions.js
    ├── services/                ← collab.js (Yjs WS), user-channel.js (inbox WS),
    │                              notifications.js, email.js, email-templates.js
    ├── src/                     ← React frontend
    │   ├── App.jsx              ← router + lazy-loaded pages
    │   ├── pages/               ← full-page components
    │   ├── components/          ← reusable UI (+ components/github/ pickers)
    │   ├── extensions/          ← custom Tiptap nodes (Mention, GitHub embeds)
    │   ├── hooks/               ← useCollab, usePresence, useClickOutside,
    │   │                          useGitHubStatus.jsx, useGitHubLink,
    │   │                          useNotificationChannel
    │   ├── lib/githubDiff.js    ← diff3 merge, imported by the BACKEND too
    │   ├── util.jsx             ← apiFetch + API wrappers — USE THIS for new calls
    │   ├── userPrefs.js         ← localStorage prefs + theme constants
    │   └── editorUtils.js       ← editor-specific helpers
    ├── public/                  ← uploaded avatars, document images
    └── tests/                   ← Vitest + Supertest, mirrors the source tree
```

## Deep maps: read before changing anything cross-cutting

`docs/maps/` holds `file:line`-cited maps of every subsystem. They exist so you
do not re-derive the wiring by re-reading the tree, and they carry the traps this
file only summarises. Start at [docs/maps/README.md](docs/maps/README.md).

| Map | Read it when |
|---|---|
| `request-lifecycle.md` | boot order, middleware stack, sessions, WS upgrades, error handling |
| `access-control.md` | **any permission work**, the 7-clause fragments and the four other permission systems |
| `documents-and-collab.md` | the editor, Yjs, dual-state storage, versions |
| `github-integration.md` | anything under `routes/github.js` |
| `notifications-and-activity.md` | notifications, activity log, watches, mentions |
| `data-model.md` | schema changes, migrations, the ACL columns |
| `frontend-architecture.md` | routing, chunks, hooks, `util.jsx`, prefs |
| `build-test-and-ops.md` | Docker, npm scripts, Vitest projects, coverage thresholds, CI |
| `open-questions.md` | **before trusting any single claim**, known dead paths and suspected defects |

`docs/*.md` remains the human-facing product documentation (features,
deployment, API contracts). `docs/maps/` is the mechanism layer.

## Application areas (what already exists)

Before writing new code in any of these areas, **read the existing files**.
Most "new feature" work is extension, not greenfield.

### Auth & accounts: `routes/auth.js`, `routes/oauth.js`, `middleware/auth.js`
Email+password login, signup via invite token, password reset, two-factor (email
OTP and TOTP with QR), session tokens (DB-backed, auto-refreshing), Google
Workspace SSO, GitHub OAuth (token AES-256-GCM encrypted at rest). Use
`requireAuth` and `requireAdmin` from `middleware/auth.js` on any new protected
route.

### Org hierarchy: `routes/workspaces.js`, `routes/squads.js`, `routes/archives.js`
Workspaces own squads; squads own archives; archives own logs. Squad members
have roles (member/admin/owner) and per-member permission flags
(read/write/create_log/create_archive/manage_members/delete_version/publish).
Squad invitations have a pending/accepted/declined lifecycle. **All access
checks go through `routes/helpers/ownership.js` — do not re-derive permission
SQL inline.** The **archive is the ACL boundary**; per-document permissions do
not exist. `docs/maps/access-control.md` has the full resolution table.

### Documents & editor: `routes/documents.js`, `src/pages/Editor.jsx`, `services/collab.js`
Logs (documents) have **dual-state storage**: `html_content` (human-readable,
written by REST saves and exports) and `ydoc_state` BLOB (binary CRDT state for
live sync restore), plus `markdown_content` for lossless GitHub round-tripping.
The Yjs WebSocket server in `services/collab.js` debounces saves on a 3-second
window, and that autosave writes **only** the blob. `html_content` updates on
an explicit save or publish, so search, export and GitHub push all read the
last explicitly-saved HTML. Any code path that writes `html_content` from
outside the editor **must set `ydoc_state = NULL`** or live editors will
resurrect the old content. Editor uses Tiptap 3 + ProseMirror with Lowlight
syntax highlighting, draw.io diagrams, resizable images, mentions, and GitHub
code/issue embeds. Full protocol in `docs/maps/documents-and-collab.md`.

### Notifications: `services/notifications.js`, `routes/notifications.js`, `services/user-channel.js`
One funnel for every user-facing alert. `createNotification()` self-suppresses
actor-equals-recipient, coalesces the same (recipient, type, resource) inside a
60-second window, persists, then fire-and-forgets a WebSocket push and an email.
Six types (`mention`, `comment_on_my_doc`, `watched_comment`, `watched_publish`,
`watched_log_update`, `squad_invite`) with per-user email preferences in
`users.notification_prefs`. The user-scoped WS (`/notifications-ws`) is
push-only and keyed by user, not by document.

### Activity & watches: `routes/helpers/activity.js`, `routes/activity.js`, `routes/watches.js`
`logActivity()` is fire-and-forget and **does three things**: writes the
`activity_log` row, auto-enrols the actor as a watcher, and fans notifications
out to every other watcher. Adding a `logActivity` call to a route therefore
starts sending people email. `log.update` events coalesce on a 5-minute window
(distinct from the notification funnel's 60 seconds). Watching an archive
cascades to its documents. Retention is 365 days, pruned in-process daily.

### Mentions: `routes/helpers/mentions.js`, `src/extensions/Mention.jsx`
`<span data-mention-user-id="N">` nodes, diffed old-vs-new HTML so only newly
added mentions notify. Mentions inside `<pre>`, `<code>`, `<script>`, `<style>`
are ignored, and every recipient is re-checked for read access before being
notified.

### Comments: `routes/comments.js`, `src/components/Comment*.jsx`
Text-anchored inline comments (selection_start/end), tags
(comment/suggestion/question/issue/note), open→resolved/dismissed status,
threaded replies, real-time WS broadcast via the collab service.

### Versions & publishing: `routes/documents.js` (`/document/:logId/publish`, `/versions/*`)
Named snapshots with release notes. Publish is permission-gated. Restore writes
back to current state. Version delete is permission-gated.

### Import / Export: `routes/upload.js`, `routes/documents.js` (`/export`)
Import: HTML, Markdown, plain text, PDF (`pdf-parse`), DOCX (`mammoth`).
Export: DOCX (`html-to-docx`), HTML, Markdown (`turndown`), plain text, PDF
(browser print). Image extraction/inlining handled by `routes/helpers/images.js`.

### Search & browse: `routes/search.js`
MySQL FULLTEXT index on `logs(title, plain_content)`. No external search
service. `/browse` returns recent + favorited documents for users with no
query. **Do not propose Elasticsearch/Meilisearch/etc. without a strong reason.**

### Favorites: `routes/favorites.js`
Per-user mark/unmark/list/check.

### GitHub integration: `routes/github.js`, `src/pages/GitHubPage.jsx`, `src/hooks/useGitHubStatus.jsx`
Live API proxy, ~45 endpoints, no webhooks and no background sync. Repo list,
branches, file tree, read/write/delete/rename contents, PRs, commits, file
search. Plus four later phases:
- **Bidirectional sync**: `github_links` tracks a merge base (`base_sha`) and a
  5-state `sync_status`. Pull does a local diff3 merge (`src/lib/githubDiff.js`)
  and 409s on conflict; push commits directly or opens a PR.
- **Live code embeds**: `/api/github/embed/code`, cached in a 500-entry LRU
  **keyed by user id** so private-repo content cannot leak across users.
- **PR-as-document**: a PR gets a virtual log in a hidden `system` archive so the
  normal comment routes work on it (see `docs/maps/open-questions.md` first).
- **Squad↔GitHub Team sync**: manual, one-directional, matched on
  `oauth_accounts.provider_username`.

`routes/github.js` **does not use the shared `errorHandler`**, it ships its own
so upstream GitHub status codes and messages reach the client. Don't "fix" that.
UI hides GitHub affordances when the user hasn't linked, use `useGitHubStatus`.

### Admin console: `routes/admin.js`, `src/pages/AdminPage.jsx`
Platform stats, workspace/user/invitation/squad management, live presence
telemetry, permission flag toggles. Admin user is auto-synced from `.env` on
startup (see `server.js`).

### User preferences: `src/userPrefs.js`
Editor mode (WYSIWYG vs Markdown), accent color, font size, layout density.
Stored in localStorage. New preferences go through `loadUserPrefs` /
`saveUserPrefs` and `applyPrefsToDOM` — don't write to localStorage directly.

## Critical architectural decisions (don't undo without discussing)

1. **Single Node process** runs Express, Vite (in dev), and **both** WebSocket
   servers (`/collab` and `/notifications-ws`). No external broker, no separate
   collab service. This is load-bearing: collab state is an in-memory `Y.Doc`
   per open document, so a second replica would maintain a second, divergent
   copy of the same log.
2. **Dual-state document storage** (`html_content` + `ydoc_state`, plus
   `markdown_content`). REST saves write `html_content`; live editing writes
   `ydoc_state`. They converge only on an explicit save or publish.
3. **MySQL FULLTEXT only** for search, over the generated `logs.plain_content`
   column. No external index.
4. **Invite-only signup**. The `users` table is never written without a valid
   invite token, an admin action, or an OAuth flow with a valid provider config.
5. **OAuth tokens encrypted at rest** with AES-256-GCM, key derived from
   `GITHUB_CLIENT_SECRET` via scrypt. Never log raw tokens. Rotating that secret
   invalidates every stored token, there is no key version and no re-encryption
   path.
6. **Layered access control** lives in `routes/helpers/ownership.js`. All
   read/write checks compose `readAccessWhere()`/`writeAccessWhere()` SQL
   fragments and pass `readAccessParams(user)`/`writeAccessParams(user)`. This
   resolves admin → user JSON → creator → workspace owner → squad role → squad
   JSON → workspace-wide flag in one query. Don't shortcut it.
   **The fragment and the params are coupled by position: always exactly 7
   params.** Adding a clause without adding its param shifts every later `?` in
   the whole query and silently returns wrong rows rather than erroring. Change
   one, change all four, and update `tests/helpers/ownership.test.js`.
7. **Per-router error handlers.** Each router ends with
   `router.use(errorHandler)`; `app.js` mounts no global handler, so a router
   that forgets it leaks Express's default HTML stack trace. `routes/github.js`
   deliberately uses its own instead.

## Gotchas that have already cost time

Each is expanded, with citations, in the map named after it.

- **The archive is the ACL boundary.** `logs.read_access` / `logs.write_access`
  exist in the schema, are written by one code path, and are read by **nothing**.
  Granting access by writing them will appear to work and grant nothing.
- **CRDT autosave does not write `html_content`.** A document edited only over
  the WebSocket is stale in search, in every export format, and on GitHub push
  until an explicit save.
- **External writers of `html_content` must null `ydoc_state`.** The GitHub pull
  paths and version restore do this; copy that pattern.
- **`init.sql` only runs on a fresh MySQL volume.** Docker skips
  `docker-entrypoint-initdb.d` on an initialised data dir. Schema changes need a
  `migrations/` file **and** an `init.sql` edit, applied by hand to existing dev
  databases. There is no migration runner and no applied-migrations table.
- **`make reset-db` is not a clean reset.** `init.sql`'s DROP list omits four
  tables (`github_links`, `activity_log`, `watches`, `notifications`) whose
  CREATEs lack `IF NOT EXISTS`, so it aborts partway on an existing database.
- **Coverage thresholds are per-glob and CI enforces them.** Adding an uncovered
  branch to a high-threshold file fails the build even when every test passes.
- **Backend tests queue `c2_query` mocks in call order.** Adding a query to a
  handler shifts the queue and breaks tests that were passing correctly. Check
  the mock ordering before assuming your change is wrong.
- **`src/lib/githubDiff.js` is imported by the backend.** It lives under `src/`
  but changing its exports breaks the server.
- **Widening a content column means widening three.** `logs.html_content`,
  the `plain_content` generated from it, and `versions.html_content` (publish
  copies the document into it) all have to move together, or the same error
  just relocates. All three are `MEDIUMTEXT` as of 2026-08-09; the app's 2 MiB
  ceiling is now the real one. See `docs/maps/open-questions.md` B2.

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
| Check archive read/write access in code    | `checkArchiveReadAccess` / `checkArchiveWriteAccess` in `shared.js` |
| Check ownership for a destructive action   | `isArchiveOwner` in `routes/helpers/ownership.js`         |
| Check publish permission                   | `canPublish` in `shared.js`                               |
| Require authentication on a route          | `requireAuth` in `middleware/auth.js`                     |
| Require admin on a route                   | `requireAdmin` in `middleware/auth.js`                    |
| Require a permission flag                  | `requirePermission(flag)` in `middleware/permissions.js`  |
| Run a SQL query                            | `c2_query(sql, params)` in `mysql_connect.js`             |
| Record an audit/activity event             | `logActivity` in `routes/helpers/activity.js`             |
| Alert a user (inbox + push + email)        | `createNotification` in `services/notifications.js`       |
| Notify on new @mentions in saved content   | `processMentionsOnSave` in `routes/helpers/mentions.js`   |
| Push a message to a user's open tabs       | `broadcastToUser` in `services/user-channel.js`           |
| Push a message to a document's live editors| `broadcastToDoc` in `services/collab.js`                  |
| Make an authenticated frontend API call    | `apiFetch(method, url, data)` in `src/util.jsx`           |
| Read/write user preferences                | `loadUserPrefs` / `saveUserPrefs` in `src/userPrefs.js`   |
| Subscribe to real-time doc updates         | `useCollab` in `src/hooks/useCollab.js`                   |
| Gate UI on GitHub being linked             | `useGitHubStatus` in `src/hooks/useGitHubStatus.jsx`      |
| Show presence avatars                      | `usePresence` + `<PresenceAvatars>`                       |
| Toast / confirm dialog                     | `<Toast>`, `<ConfirmDialog>` in `src/components/`         |
| Send an email                              | `sendEmail` in `services/email.js`                        |
| Build a notification email body            | `buildNotificationEmail` in `services/email-templates.js` |
| Extract / inline images for export         | `routes/helpers/images.js`                                |
| Three-way merge two markdown revisions     | `diff3Merge` in `src/lib/githubDiff.js`                   |

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

- Framework: **Vitest 4 + Supertest** for backend, **Vitest + jsdom +
  @testing-library/react** for frontend. The two suites run as separate
  Vitest **projects** (configured in `vitest.config.js`); a single
  `npm test` runs both.
- Tests mirror the source tree:
  - `routes/foo.js` → `tests/routes/foo.test.js`
  - `services/foo.js` → `tests/services/foo.test.js`
  - `routes/helpers/foo.js` → `tests/helpers/foo.test.js`
  - `src/foo.js` / `src/components/Foo.jsx` / `src/hooks/useFoo.js` → `tests/src/...`
- Use the helpers in `tests/helpers.js` (`mockAuthenticated`,
  `mockUnauthenticated`, `resetMocks`, `TEST_USER`, `TEST_USER_2`). There is no
  `ADMIN_USER`; admin tests pass
  `mockAuthenticated({ ...TEST_USER, is_admin: true })`.
- `tests/setup.js` mocks the DB (`c2_query`), email, and `sharp` globally for
  **backend** tests, your tests inherit these. Its `fs/promises` mock covers
  **only `mkdir` and `unlink`**; anything touching `stat`, `readFile` or
  `writeFile` (i.e. `routes/helpers/images.js`) must mock those itself.
  `tests/setup.frontend.js` provides jest-dom matchers and resets DOM /
  localStorage / sessionStorage between **frontend** tests.
- Because `c2_query` is a mock, most backend tests queue
  `mockResolvedValueOnce` calls **in the exact order the handler issues
  queries**. Adding a query to a handler shifts that queue and breaks tests that
  were passing for the right reason.
- Coverage runs via `npm run test:coverage` (uses `@vitest/coverage-v8`)
  and is enforced by per-glob thresholds in `vitest.config.js`. CI fails
  on threshold violations.
- **Adding or modifying a backend route, service, helper, or middleware
  requires updating the matching test file.** New code needs new tests
  in the same shape as its neighbors.
- **New or modified frontend hooks (`src/hooks/`), pure-JS utilities
  under `src/`, and reusable components in `src/components/` require
  matching tests.** Pages (`src/pages/`) remain out of scope by default —
  the giants like `Editor.jsx` and `GitHubPage.jsx` need a refactor that
  extracts logic into testable hooks before they're worth unit-testing.
- See `cloudcodex/tests/README.md` for testing patterns and examples.

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
7. Any change to architecture, data flow, a lifecycle, or a public surface
   reflected in the matching `docs/maps/*.md` **in the same PR**. A map that no
   longer matches the code is a bug. Anchor on names, not `:line`.
8. UI changes verified manually in the browser at the route they affect, on
   both desktop and mobile widths (mobile CSS is a recent investment area).
9. No `console.log` debug statements left in. No commented-out code.
10. No `TODO`/`FIXME` left in committed code without an issue link.

### What NOT to do

- Don't skip access control "just for an internal endpoint" — there are no
  internal endpoints, only public HTTP and the two WebSockets.
- Don't bypass `sanitizeHtml` because "this input is trusted" — it isn't.
- Don't hand-roll permission SQL, and don't add a per-row ACL column expecting
  it to work. Only `archives` is wired into `ownership.js`.
- Don't add a structured logging library, an APM agent, or a metrics service
  without discussing first. Plain `console.error` is the deliberate choice.
- Don't add a service worker, an external job queue, a Redis dependency, or a
  WebSocket server outside the app process. The single-process architecture is
  load-bearing for self-hosting: collab state is an in-memory `Y.Doc`.
- Don't replace the error handler in `routes/github.js` with the shared one
  it would flatten every GitHub 404 and rate-limit into an opaque 500.
- Don't add Prettier or migrate to TypeScript without discussing first.
- Don't propose Elasticsearch/Meilisearch — MySQL FULLTEXT is the choice.
- Don't `git push --force` on `main`. Don't `--no-verify`.
- Don't ship code with `.only` or `.skip` left in tests.
- Don't write to `localStorage` directly from React — go through `userPrefs`.
- Don't store new secrets in code or in commit history. `.env` only.

## Where to look first when you don't know

Pattern: **map for the mechanism, `docs/` for the product, source for the
truth.** The maps carry `file:line` citations so you land on the right line.

- **What does this product do?** → `README.md`, `docs/architecture.md`, `docs/features.md`.
- **How does anything actually work?** → `docs/maps/README.md`, then the map for the area.
- **How is data shaped?** → `docs/maps/data-model.md`, `init.sql`, `docs/database.md`.
- **How does access control resolve?** → `docs/maps/access-control.md`, `routes/helpers/ownership.js`, `docs/access-control.md`.
- **Why does the editor work the way it does?** → `docs/maps/documents-and-collab.md`, `services/collab.js`, `src/pages/Editor.jsx`.
- **Why is this GitHub route shaped like that?** → `docs/maps/github-integration.md`.
- **Why did that notification fire (or not)?** → `docs/maps/notifications-and-activity.md`.
- **Why is CI red when my tests pass?** → `docs/maps/build-test-and-ops.md` (per-glob coverage thresholds).
- **Is this a bug or is it meant to be like that?** → `docs/maps/open-questions.md`.
- **What env vars exist?** → `.env.example`.
- **What are the API contracts?** → `docs/api/*.md` (per-area).
- **What's the security model?** → `docs/security.md`.

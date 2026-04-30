```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   FRONTEND ARCHITECTURE                                                    ║
║   React 19 + Tiptap + Yjs, served from the same Node process as the API.   ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Frontend Architecture

Cloud Codex uses **React 19** with **Vite 7** as the build tool. The frontend
is served by the same Node process as the API via
[vite-express](https://github.com/szymmis/vite-express) — no separate frontend
server in development or production.

---

## Tech Stack

| Concern            | Library / Tool                          |
|--------------------|-----------------------------------------|
| UI framework       | React 19                                |
| Routing            | React Router v7                         |
| Rich text editor   | [Tiptap](https://tiptap.dev/) v3        |
| Real-time collab   | Yjs + `@tiptap/extension-collaboration` |
| Build tool         | Vite 7                                  |
| Serving (dev+prod) | vite-express                            |
| Code highlighting  | lowlight (via Tiptap extension)         |
| Markdown import    | marked                                  |
| Markdown export    | Turndown                                |

---

## Routing

Routes are defined in `src/App.jsx`. Heavy pages are **code-split and
lazy-loaded** to keep the initial bundle small (the editor page alone pulls
in Tiptap, Yjs, lowlight, etc.).

```
   /
   ├── /                                       HomePage
   ├── /reset-password                         ResetPasswordPage
   │
   ├── /editor/:logId                          Editor    (mobile-guarded)
   │
   ├── /archives                               ArchivesPage
   ├── /archives/:archiveId                    ArchivesPage
   ├── /archives/:archiveId/doc                ArchiveView
   ├── /archives/:archiveId/doc/:logId         ArchiveView
   │
   ├── /workspaces                             WorkspacesPage
   ├── /workspaces/:workspaceId                WorkspacesPage
   │
   ├── /github                                 GitHubPage
   ├── /github/:owner/:repo                    GitHubPage
   │
   ├── /admin                                  AdminPage
   │
   ├── /notifications                          NotificationsPage
   ├── /notifications/preferences              NotificationPreferences
   │
   ├── /activity                               WorkspaceActivity
   ├── /activity/workspace/:workspaceId        WorkspaceActivity
   │
   ├── /account                                AccountSettings
   ├── /settings                               → /account (redirect)
   │
   ├── /404                                    NotFound
   └── *                                       → /404
```

---

## Pages

### `HomePage`
The initial landing page. Shows the login form (`Login` component) when
unauthenticated, and the main dashboard (`ArchiveBrowser` + `SearchBox`)
when logged in.

### `ArchivesPage`
Displays the user's accessible archives. Selecting an archive shows its
document tree (`PageTree`). Documents can be created, deleted, and
rearranged here.

### `ArchiveView`
Read-only document viewer. Renders the document's `html_content` with
comment annotations overlaid (`CommentHighlights`). All commenting
functionality is accessible via the `CommentSidebar`.

### `Editor`
The full collaborative rich text editor. Integrates:
- **Tiptap** with the full extension set (collaboration, images, code
  blocks, tables, text alignment, links, underline)
- **WebSocket** to the collab service for real-time CRDT sync
- **`PublishModal`** triggered by the "Publish Version" button
- **`RemoteCursors`** rendering other users' cursor positions
- **`PresenceAvatars`** showing avatars of users currently in the document
- **`@Mention`** Tiptap node + autocomplete
- **`GitHubCodeEmbed`** / **`GitHubIssueEmbed`** Tiptap nodes
- **`GitHubSyncBanner`** when the doc is linked to a GitHub file
- Autosave via `POST /api/save-document` on debounce
- `ExportMenu` for Markdown / DOCX / PDF download

### `WorkspacesPage`
Manages the organizational hierarchy. Lets workspace owners create/delete
squads, manage squad members and permissions, and invite new users to squads.

### `GitHubPage`
Repository browser using the GitHub integration API. Supports navigating a
repo's file tree, reading files, branch and PR management, code/issue
embedding, and linking files to Cloud Codex documents for push/pull sync.

### `AdminPage`
System administration panel. Visible only to admins. Covers user management,
workspace management, invitation sending, permission flag toggles, and live
presence telemetry.

### `NotificationsPage`
The unified inbox. Lists notifications newest first with cursor pagination,
unread filter, and "mark all read". The page subscribes to
`/notifications-ws` via `useNotificationChannel` so new alerts appear live
without a refresh.

### `NotificationPreferences`
Per-type email opt-in/out. Loads `GET /api/notifications/preferences` and
saves with `PUT`. Defaults are merged in client-side so a brand-new user
sees the right initial state.

### `WorkspaceActivity`
Filterable activity stream for a workspace. Combines log/archive/comment/
version events; the server pre-filters by access, so all entries returned
are safe to show. Cursor pagination via the `before` parameter.

### `AccountSettings`
User profile editing (username, email, password), avatar upload, OAuth
connection status, and 2FA configuration.

### `ResetPasswordPage`
Token validation and new-password entry for the password-reset email flow.

---

## Hooks

| Hook                       | What it does                                            |
|----------------------------|---------------------------------------------------------|
| `useCollab`                | Wires a Tiptap editor to the `/collab/:logId` WebSocket; manages Yjs `Y.Doc`, awareness, remote cursors |
| `useNotificationChannel`   | Connects to `/notifications-ws`, surfaces unread count + push events for the bell + inbox |
| `useGitHubLink`            | Tracks pull/push/conflict status for a doc linked to a GitHub file |
| `useGitHubStatus`          | Whether the current user has an active GitHub OAuth token |
| `usePresence`              | Subscribes to live presence for a log (active editors with name/avatar/color) |
| `useClickOutside`          | Closes modals/dropdowns on click outside their referenced element |

---

## Key Components

### Editor primitives
| Component                  | Purpose                                                      |
|----------------------------|--------------------------------------------------------------|
| `CommentManager`           | Top-level state owner for inline comments on a doc           |
| `CommentSidebar`           | Sliding panel listing all comments for a document            |
| `CommentForm`              | Inline form for creating/editing comments and replies        |
| `CommentHighlights`        | Overlays color highlighting on selected text anchors         |
| `DrawioBlock`              | Tiptap node for embedded draw.io diagrams                    |
| `CodeBlockWithLanguage`    | Tiptap code block with language selector UI                  |
| `ResizableImage`           | Tiptap image node with drag-to-resize handles                |
| `Mention` (extension)      | `@mention` autocomplete + node renderer                      |
| `GitHubCodeEmbed` (ext)    | Pinned GitHub code-snippet embed                             |
| `GitHubIssueEmbed` (ext)   | Pinned GitHub issue embed                                    |

### Presence & collaboration
| Component                  | Purpose                                                      |
|----------------------------|--------------------------------------------------------------|
| `CollabPresence`           | Higher-order component wiring up the WebSocket and passing presence state to the editor |
| `PresenceAvatars`          | Row of avatar bubbles for currently connected editors        |
| `RemoteCursors`            | Renders Tiptap decorations showing where others are typing   |

### Navigation & browse
| Component                  | Purpose                                                      |
|----------------------------|--------------------------------------------------------------|
| `Std_Layout` (page-layout) | Main page wrapper (top nav + content area)                   |
| `ArchiveBrowser`           | Sidebar for browsing archives and their document trees       |
| `PageTree`                 | Recursive tree view of logs within an archive                |
| `ExploreBrowser`           | Browse mode (recent / favorited docs without a query)        |
| `SearchBox`                | Full-text search input with filter support                   |
| `SearchResultItem`         | A single search result card with snippet + highlighting      |

### GitHub UI
| Component                  | Purpose                                                      |
|----------------------------|--------------------------------------------------------------|
| `GitHubSyncBanner`         | Pull/push/conflict status indicator for a linked doc         |
| `GitHubMergeDialog`        | PR merge workflow UI backed by `github_pr_sessions`          |
| `CodeEmbedPickerModal`     | (`components/github/`) Pick a code snippet to embed          |
| `IssuePickerModal`         | (`components/github/`) Pick an issue to embed                |
| `CIStatusBadge`            | Renders Actions / check-run status for a SHA                 |

### Notifications & activity
| Component                  | Purpose                                                      |
|----------------------------|--------------------------------------------------------------|
| `NotificationBell`         | Top-bar bell with unread badge; opens a quick dropdown       |
| `NotificationItem`         | A single notification card (used in dropdown + inbox)        |
| `ActivityItem`             | A single activity-stream entry                               |

### Account, modals, utility
| Component                  | Purpose                                                      |
|----------------------------|--------------------------------------------------------------|
| `Login`                    | Login / signup form with invite token detection              |
| `WelcomeSetup`             | Post-signup wizard for first workspace/squad/archive         |
| `AccountMenu`              | Top-bar dropdown with account links and logout               |
| `AccountPanel`             | Account settings form sections                               |
| `PublishModal`             | Modal for adding a title/notes when publishing a version     |
| `ExportMenu`               | Dropdown offering Markdown / DOCX / PDF export               |
| `NewLogModal`              | Create-new-document dialog                                   |
| `ImageCropModal`           | Avatar crop tool using canvas                                |
| `ConfirmDialog`            | Generic confirmation modal for destructive actions           |
| `Toast`                    | Global notification toasts                                   |

---

## State Management

There is no global state management library (no Redux or Zustand). State is
managed locally inside components and pages, with data fetched directly via
`apiFetch()` calls (`src/util.jsx`) to the API. The Tiptap editor maintains
its own synchronized document state via Yjs.

User preferences (theme, layout, editor mode) are persisted to
`localStorage` via `src/userPrefs.js` — never written to localStorage
directly from components.

---

## Authentication Flow (Frontend)

```
  page load
     │
     ▼
  read sessionToken from localStorage ?
     │
     ├── yes ──► GET /api/get-user (Authorization: Bearer …)
     │             ├── 200 ──► authenticated, render dashboard
     │             └── 401 ──► drop token, render Login
     │
     └── no  ──► render Login

  on login / signup ──► save token to localStorage
                       store user state, route to dashboard
                       attach token to every subsequent apiFetch() call
```

---

## Code-Splitting

`vite.config.js` configures `manualChunks` to split heavy frontend libs into
vendor chunks loaded only on the pages that need them:

| Chunk                | Contents                                          | Loaded on                |
|----------------------|---------------------------------------------------|--------------------------|
| `vendor-react`       | React, React-DOM, React-Router                    | every page               |
| `vendor-tiptap`      | Tiptap + ProseMirror modules                      | Editor, ArchiveView      |
| `vendor-yjs`         | Yjs, y-protocols                                  | collab pages             |
| `vendor-highlight`   | lowlight + highlight.js languages                 | editor / read view       |
| `vendor-markup`      | marked, turndown, dompurify                       | editor / import-export   |

---

## Build & Development

```bash
cd cloudcodex

# Development (API + Vite HMR together)
npm run dev

# Production build (generates dist/ for vite-express to serve)
npm run build
npm run start

# Tests
npm test
npm run test:coverage
```

The Vitest config (`vitest.config.js`) defines two projects — a Node
backend project for routes/middleware/services and a jsdom frontend
project for `src/` components, hooks, and utilities. A single `npm test`
runs both. See [testing.md](./testing.md) for details.

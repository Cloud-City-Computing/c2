# Frontend Architecture

Cloud Codex uses **React 19** with **Vite** as the build tool. The frontend is served by the same Node.js process as the API via [vite-express](https://github.com/szymmis/vite-express) — no separate frontend server is needed in development or production.

---

## Tech Stack

| Concern            | Library / Tool                     |
|--------------------|------------------------------------|
| UI framework       | React 19                           |
| Routing            | React Router v7                    |
| Rich text editor   | [Tiptap](https://tiptap.dev/) v3   |
| Real-time collab   | Yjs + `@tiptap/extension-collaboration` |
| Build tool         | Vite 7                             |
| Serving (dev+prod) | vite-express                       |
| Code highlighting  | lowlight (via Tiptap extension)    |
| Markdown import    | marked                             |
| Markdown export    | Turndown                           |

---

## Routing

Routes are defined in `src/App.jsx`. Heavy pages are **code-split and lazy-loaded** to keep the initial bundle small (the editor page alone pulls in Tiptap, Yjs, lowlight, etc.).

| Path                                  | Component          | Description                          |
|---------------------------------------|--------------------|--------------------------------------|
| `/`                                   | `HomePage`         | Landing / login / dashboard          |
| `/reset-password`                     | `ResetPasswordPage`| Password reset form                  |
| `/archives`                           | `ArchivesPage`     | Browse and manage archives           |
| `/archives/:archiveId`                | `ArchivesPage`     | Archive selected state               |
| `/archives/:archiveId/doc/:logId`     | `ArchiveView`      | Document viewer (read mode)          |
| `/editor/:logId`                      | `Editor`           | Full-screen collaborative editor     |
| `/workspaces`                         | `WorkspacesPage`   | Workspace/squad management           |
| `/workspaces/:workspaceId`            | `WorkspacesPage`   |                                      |
| `/github`                             | `GitHubPage`       | GitHub repo browser                  |
| `/github/:owner/:repo`                | `GitHubPage`       |                                      |
| `/admin`                              | `AdminPage`        | Admin panel                          |
| `/account`                            | `AccountSettings`  | User profile and preferences         |

---

## Pages

### `HomePage`

The initial landing page. Shows the login form (`Login` component) when unauthenticated, and the main dashboard (`ArchiveBrowser` + `SearchBox`) when logged in.

### `ArchivesPage`

Displays the user's accessible archives. Selecting an archive shows its document tree (`PageTree` component). Documents can be created, deleted, and rearranged here.

### `ArchiveView`

Read-only document viewer. Renders the document's `html_content` with comment annotations overlaid (`CommentHighlights`). All commenting functionality is accessible here via the `CommentSidebar`.

### `Editor`

The full collaborative rich text editor. Integrates:
- **Tiptap** editor with the full extension set (collaboration, images, code blocks, tables, text alignment, links, underline)
- **WebSocket** connection to the collab service for real-time CRDT sync
- **`PublishModal`** — triggered by the "Publish Version" button
- **`RemoteCursors`** — renders other users' cursor positions
- **`PresenceAvatars`** — shows avatars of users currently in the document
- Autosave logic (calls `POST /api/save-document` on debounce)
- `ExportMenu` for Markdown and DOCX download

### `WorkspacesPage`

Manages the organizational hierarchy. Lets workspace owners create/delete squads, manage squad members and permissions, and invite new users to squads.

### `GitHubPage`

Repository browser using the GitHub integration API. Supports navigating a repo's file tree, reading files, and linking a file to a Cloud Codex document for push/pull sync.

### `AdminPage`

System administration panel. Visible only to admins. Covers user management, workspace management, invitation sending, and live presence telemetry.

### `AccountSettings`

User profile editing (username, email, password), avatar upload, OAuth connection status, and 2FA configuration.

---

## Key Components

| Component            | Purpose                                                          |
|----------------------|------------------------------------------------------------------|
| `Login`              | Login / signup form with invite token detection                  |
| `ArchiveBrowser`     | Sidebar/panel for browsing archives and their document trees     |
| `PageTree`           | Recursive tree view of logs within an archive                    |
| `SearchBox`          | Full-text search input with filter support                       |
| `SearchResultItem`   | A single search result card with match snippet and highlighting  |
| `ExploreBrowser`     | Browse mode (recent/favorited documents without a search query)  |
| `CommentSidebar`     | Sliding panel listing all comments for a document                |
| `CommentForm`        | Inline form for creating/editing comments                        |
| `CommentHighlights`  | Overlays color highlighting on selected text anchors in the document view |
| `CollabPresence`     | Higher-order component wiring up the WebSocket and passing presence state to the editor |
| `PresenceAvatars`    | Row of avatar bubbles for currently connected editors            |
| `RemoteCursors`      | Renders Tiptap decorations showing where other users' cursors are |
| `PublishModal`       | Modal form for adding a title/notes when publishing a version    |
| `ExportMenu`         | Dropdown offering Markdown and DOCX export                       |
| `WelcomeSetup`       | Shown to new users to guide them through creating their first archive |
| `AccountMenu`        | Top-bar dropdown with account links and logout                   |
| `AccountPanel`       | Account settings form sections                                   |
| `ImageCropModal`     | Avatar crop tool using canvas                                    |
| `Toast`              | Global notification toasts                                       |
| `ConfirmDialog`      | Generic confirmation modal for destructive actions               |
| `DrawioBlock`        | Tiptap node extension for embedded draw.io diagrams              |
| `CodeBlockWithLanguage` | Tiptap code block with language selector UI                   |
| `ResizableImage`     | Tiptap image node with drag-to-resize handles                    |

---

## State Management

There is no global state management library (no Redux or Zustand). State is managed locally inside components and pages, with data fetched directly via `fetch()` calls to the API. The Tiptap editor maintains its own synchronized document state via Yjs.

User preferences (theme, etc.) are persisted to `localStorage` via `src/userPrefs.js`.

---

## Authentication Flow (Frontend)

1. On load, the app checks `localStorage` for a saved session token.
2. If found, `GET /api/me` is called to validate it against the server.
3. If valid, the user is considered authenticated and routed to the dashboard.
4. If invalid or absent, the login screen is shown.
5. On login/signup, the returned token is saved to `localStorage` and the user state is updated.
6. The token is included in all subsequent API requests as `Authorization: Bearer <token>`.

---

## Build & Development

```bash
cd cloudcodex

# Development (API + Vite HMR together)
npm run dev

# Production build (generates dist/ for Vite serving)
npm run build
npm run start

# Tests
npm test
npm run test:coverage
```

The Vite config (`vite.config.js`) configures the React plugin and any build aliases. The vitest config (`vitest.config.js`) sets up the test environment with a custom setup file (`tests/setup.js`).

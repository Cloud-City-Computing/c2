# Frontend Architecture Map

React 19 + React Router 7, served by `vite-express` from the same Node process
that serves the API. No SSR, no state library, no CSS framework. Roughly 73 JSX
files plus a single 8844-line `src/index.css`.

---

## 1. Routing and code splitting

`src/main.jsx` mounts, `src/App.jsx` routes. Only `HomePage` is imported
eagerly; **eleven pages are `lazy()`-loaded** behind one
`<Suspense fallback={<PageLoader />}>`, and the whole thing sits inside a
single `<ErrorBoundary>`.

**`ErrorBoundary` (`src/components/ErrorBoundary.jsx`) is the only one in the
app,** wrapping `Suspense` in `App.jsx`. Before it existed, any render throw
unmounted the React root and left a blank page with no message and no way back
except a manual reload; that is what turned the editor teardown race into a
total outage (`open-questions.md` B11) and what would have made a null
workspace owner take down the admin console. It renders a message plus "Reload
the page" and "Try again", and logs with the project's
`[timestamp] Unhandled render error:` format.

Note what it cannot do: React error boundaries never see errors from event
handlers, async callbacks, or `setTimeout`. It is a floor under render errors,
not a general catch-all.

| Route | Page | Notes |
|---|---|---|
| `/` | HomePage | eager |
| `/reset-password` | ResetPasswordPage | |
| `/editor/:logId` | Editor | wrapped in `MobileEditorGuard` |
| `/account`, `/settings` → `/account` | AccountSettings | `/settings` is a redirect |
| `/archives`, `/archives/:archiveId` | ArchivesPage | |
| `/archives/:archiveId/doc/:logId`, `/archives/:archiveId/doc` | ArchiveView | |
| `/workspaces`, `/workspaces/:workspaceId` | WorkspacesPage | |
| `/github`, `/github/:owner/:repo` | GitHubPage | |
| `/admin` | AdminPage | |
| `/notifications`, `/notifications/preferences` | NotificationsPage, NotificationPreferences | |
| `/activity`, `/activity/workspace/:workspaceId` | WorkspaceActivity | |
| `/404`, `*` | NotFound | catch-all redirects to `/404` |

`MobileEditorGuard` (`App.jsx:43-47`) checks
`window.matchMedia('(max-width: 768px)')` **once at render** and redirects to
`/`. It does not subscribe to the media query, so resizing a desktop window
below 768px does not evict an open editor. On mobile, documents are read-only
through `ArchiveView`.

There is no route-level auth guard. Pages check auth themselves, and the API
returns 401 regardless.

### Vite `manualChunks` (`vite.config.js:15-38`)

Five named vendor chunks, split by what a page actually needs:

```
vendor-react      react, react-dom, react-router      every page
vendor-tiptap     @tiptap/*, prosemirror              Editor, ArchiveView
vendor-highlight  lowlight, highlight.js              editor code blocks
vendor-yjs        yjs, y-protocols, lib0              collab pages
vendor-markup     marked, turndown, dompurify         import/export paths
```

**Before adding a heavy frontend dependency, add it here**, or it lands in the
default chunk and every page pays for it. Anything not matched falls through to
Rollup's default chunking.

## 2. The API layer: `src/util.jsx`

647 lines, and the single place any component should talk to the server from.

`apiFetch(method, url, data)` (`util.jsx:28-52`) reads the session token from
the cookie via `getSessionTokenFromCookie()` (`util.jsx:621`), sets
`Authorization: Bearer`, JSON-encodes the body for non-GET, and on a non-2xx
throws an `Error` carrying `.status` and `.body`. `getErrorMessage(err)`
(`util.jsx:102`) is the standard way to render that.

`serverReq` (`util.jsx:62`) is the legacy predecessor. It does **not** attach
auth. Do not use it in new code; it exists for the handful of pre-auth calls.

Below the two primitives, `util.jsx` is a flat catalogue of ~130 named wrappers
grouped by area: workspaces (`:117`), archive repos (`:124`), GitHub link and
sync (`:134`), PR and issue (`:145`), CI and releases (`:166`), squads
(`:183`), permissions (`:191`), members (`:199`), invitations (`:206`), admin
(`:218`), search and browse (`:241`), watches (`:265`), activity (`:275`),
notifications (`:291`), favorites (`:307`), comments (`:315`), archives
(`:332`), logs (`:346`), documents and versions (`:356`).

**Add new API calls here as a named export**, next to their neighbours, rather
than calling `fetch` from a component. Two paths bypass `apiFetch` deliberately
because they are not JSON: `uploadDocument` (`util.jsx:380`, multipart) and
`exportDocument` (`util.jsx:416`, blob download).

The tail of the file (`util.jsx:503-640`) is imperative DOM helpers predating
the React migration: `showModal`, `showModalDimmer`, `destroyModal`,
`showDropdownMenu`, plus session-storage wrappers. They cache React roots in a
module-level `Map` (`util.jsx:17`) to avoid double-rooting the same node. New UI
should use React components (`ConfirmDialog`, `Toast`) instead.

## 3. Hooks (`src/hooks/`)

| Hook | Purpose |
|---|---|
| `useCollab.js` | the `/collab` WebSocket and the shared `Y.Doc`; returns connection state, presence, cursors, and five senders |
| `usePresence.js` | polls `/api/presence` for who is in which document, for browse/archive views |
| `useNotificationChannel.js` | the `/notifications-ws` socket, feeding `NotificationBell` |
| `useGitHubStatus.jsx` | whether the user has linked GitHub; gates every GitHub affordance |
| `useGitHubLink.js` | per-document link and sync state, drives `GitHubSyncBanner` |
| `useClickOutside.js` | dismiss-on-outside-click for menus and popovers |
| `useFirstRun.js` | fetches `GET /api/first-run` once per mount, exposes `{ firstRun, loading, complete }` |

`useCollab` is the intricate one. It memoises the `Y.Doc` so it survives
re-renders (`useCollab.js:48`), keeps the latest callbacks in refs so the socket
effect does not re-run when a parent re-renders (`useCollab.js:39-45`), queues
outbound updates until the server's sync completes and flushes them afterwards
(`useCollab.js:82`, `useCollab.js:125-128`), and auto-reconnects on close.
`sendPublish` returns a promise resolved by the server's `published` frame with
a 10-second timeout (`useCollab.js:252-283`).

`useGitHubStatus` is a `.jsx` file, not `.js`, because it exports a context
provider alongside the hook.

`useFirstRun` dismisses locally before the completion request resolves:
`complete()` sets local state to null immediately, then fires
`POST /api/first-run/complete` and swallows a failure, so a network error
never leaves the welcome stuck on screen (worst case it reappears once on
the next load). A fetch failure on mount leaves `firstRun` `null`, which
renders nothing, on purpose: onboarding must never be able to gate the rest
of the application.

## 4. Components

`src/components/` holds 32 reusable components plus a `github/` subfolder for
the picker modals. The reusable primitives worth knowing before you build a new
one:

- `<Toast>` and `toastError()` for transient feedback, `<ConfirmDialog>` for
  destructive confirmation. **`no-alert` is an ESLint error**
  (`eslint.config.js:45`); there are two legacy disables in `Editor.jsx` and
  `GitHubPage.jsx` and no more should be added.
- `<PresenceAvatars>` pairs with `usePresence`.
- `<PageTree>` renders the `logs.parent_id` tree.
- `<SearchBox>` / `<SearchResultItem>`, `<NotificationBell>` /
  `<NotificationItem>`, `<ActivityItem>`, `<CIStatusBadge>`. **`SearchResultItem`
  has no callers**: search results reach the user through `ExploreCard`, so it
  is dead code (see `open-questions.md` B13).
- **A document's title is a real `<Link>` or `<button>` in every list view**
  (`ExploreCard`, `LogTreeItem`, `PageTree`'s `TreeItem`), while the row or card
  around it keeps its own `onClick` for the mouse. The title stops propagation
  so one activation is not counted twice. Adding a new list of documents means
  carrying that pattern, not a bare `<div onClick>`: see `open-questions.md`
  B13 for why.
- Two inner components are exported purely so they can be unit-tested without
  mounting their data-fetching parent: `ExploreCard` and `Pagination` from
  `ExploreBrowser.jsx`, and `LogTreeItem` from `ArchiveBrowser.jsx`.
- Comment UI is four components: `CommentManager` (orchestration),
  `CommentSidebar`, `CommentForm`, `CommentHighlights` (in-document marks).
- `RemoteCursors.jsx` exports `RichTextCursors` and `MarkdownCursors`, two
  renderers over the same collab cursor data.

`src/page_layouts/Std_Layout.jsx` is the shell (nav, sidebar, content slot) that
every page composes. Its authenticated branch renders `<FirstRunGate />`
ahead of `children`, which is the mount point that finally makes the welcome
reachable for the admin, who is synced from `.env` at boot rather than
signing up through an invitation and so never passed through the old
imperative call in `Login.jsx`.

`FirstRunGate` holds no copy of its own: it calls `useFirstRun`, renders
nothing while loading or once `needsOnboarding` is false, and otherwise wraps
`WelcomeSetup` in the shared modal-dimmer markup. `WelcomeSetup` is
payload-driven, not imperative: it takes the `firstRun` object
(`{ isAdmin, squad, archive, log, pendingSquadInvites }`) as a prop and
`onFinish` as a callback, and renders one of two branches depending on
whether the user already has a squad or archive to point at (teaches the
workspace/squad/archive/log hierarchy by naming what they already have) or
has neither (points at `pendingSquadInvites` if any exist, otherwise tells
them to ask an admin). It creates nothing itself, unlike the deleted
`POST /api/setup` flow it replaces.

`src/extensions/` holds the three custom Tiptap nodes: `Mention.jsx` (which also
exports `MentionPicker`), `GitHubCodeEmbed.jsx`, `GitHubIssueEmbed.jsx`.
Editor-specific node views that are still components live in
`src/components/`: `CodeBlockWithLanguage`, `DrawioBlock`, `ResizableImage`.

`src/lib/githubDiff.js` is the odd one out: a pure module under `src/` that the
**backend** imports (`routes/github.js:24`) for `diff3Merge`. Changing its
exports breaks the server, not just the client.

## 5. Preferences

`src/userPrefs.js`. One localStorage key, `c2-user-prefs`
(`userPrefs.js:12`). Three exported option maps that are the single source of
truth: `ACCENT_COLORS` (8 colours, each with value/light/dark/hover),
`FONT_SIZES` (sm/md/lg), `DENSITIES` (compact/comfortable/spacious).

`applyPrefsToDOM(prefs)` (`userPrefs.js:58-91`) writes CSS custom properties on
`document.documentElement` (`--brand-blue*`, `--editor-font-size`,
`--density-scale`) and a `data-sidebar-default` attribute on `body`. Crucially
it **removes** each property when the preference is unset rather than writing a
default, so the stylesheet's own defaults win.

`getPreferredEditorMode()` (`userPrefs.js:96`) returns `'markdown'` or
`'richtext'`, defaulting to rich text.

**Never write to `localStorage` directly from a component.** Go through
`loadUserPrefs` / `saveUserPrefs` / `applyPrefsToDOM`. A new preference means
adding its option map here, handling it in `applyPrefsToDOM`, and extending
`tests/src/userPrefs.test.js`, which carries a 95% line threshold
(`vitest.config.js:114`).

## 6. Styling

One file: `src/index.css`, 8844 lines. No CSS modules, no preprocessor, no
utility framework. Theming works entirely through CSS custom properties set by
`applyPrefsToDOM`, which is why preferences apply instantly without a re-render.

Mobile is a recent investment area; UI changes should be checked at both
desktop and mobile widths.

## 7. Lint rules that shape the code

`eslint.config.js` is the source of truth. The ones that most often bite:

- `no-console` warns, `console.error` allowed (`eslint.config.js:43`). Never
  ship `console.log`.
- `no-alert` errors (`:45`).
- `no-implicit-coercion` errors (`:46`), so no `!!x` and no `+x`. Use
  `Boolean(x)` and `Number(x)`. This is why the backend writes
  `Boolean(user.is_admin)` in `ownership.js:43`.
- `react/jsx-no-useless-fragment` and `react/self-closing-comp` error (`:53-54`).
- `react/jsx-handler-names` warns (`:56`): handler props are `onFoo`, handler
  functions are `handleFoo`.
- `react-hooks/exhaustive-deps` warns (`:66`). Do not silence it by adding deps
  that cause render loops; reach for `useCallback` or a ref first. The
  `eslint-disable` lines in `GitHubPage.jsx` are load-bearing, leave them.

No Prettier, no TypeScript. Match the surrounding file: 2-space indent, single
quotes in JS, double quotes in JSX attributes, trailing semicolons.

## 8. Testing the frontend

The `frontend` Vitest project runs jsdom + Testing Library over
`tests/src/**` (`vitest.config.js:38-49`). In scope and required by
`CLAUDE.md`: `src/hooks/`, pure-JS utilities under `src/`, and reusable
components in `src/components/`.

Out of scope by default: `src/pages/`. `Editor.jsx` (1516 lines) and
`GitHubPage.jsx` (2631 lines) need logic extracted into testable hooks before
unit-testing them is worth it. That extraction is the natural next refactor and
would also let their coverage thresholds be raised.

---

## Related

- [documents-and-collab.md](documents-and-collab.md) for the editor and
  `useCollab` in depth.
- [github-integration.md](github-integration.md) for the GitHub UI surface.
- [build-test-and-ops.md](build-test-and-ops.md) for the Vitest project split
  and thresholds.

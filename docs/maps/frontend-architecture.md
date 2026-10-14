# Frontend Architecture Map

React 19 + React Router 7, served by `vite-express` from the same Node process
that serves the API. No SSR, no state library, no CSS framework. Roughly 73 JSX
files plus a single 9070-line `src/index.css`, on top of the vendored design
primitives (section 6).

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
| `/editor/:logId` | Editor | wrapped in `MobileEditorGuard`; the page wraps its `EditorView` in `Std_Layout`, which `ArchiveView` also embeds it in |
| `/account`, `/settings` → `/account` | AccountSettings | `/settings` is a redirect |
| `/archives`, `/archives/:archiveId` | ArchivesPage | |
| `/archives/:archiveId/doc/:logId`, `/archives/:archiveId/doc` | ArchiveView | |
| `/workspaces`, `/workspaces/:workspaceId` | WorkspacesPage | |
| `/github`, `/github/:owner/:repo` | GitHubPage | |
| `/admin` | AdminPage | |
| `/notifications`, `/notifications/preferences` | NotificationsPage, NotificationPreferences | |
| `/activity`, `/activity/workspace/:workspaceId` | WorkspaceActivity | |
| `/404`, `*` | NotFoundPage | catch-all redirects to `/404`; a standalone card (`src/pages/NotFoundPage.jsx`) |

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

727 lines, and the single place any component should talk to the server from.

`apiFetch(method, url, data)` (`util.jsx:28-52`) reads the session token from
the cookie via `getSessionTokenFromCookie()` (`util.jsx:661`), sets
`Authorization: Bearer`, JSON-encodes the body for non-GET, and on a non-2xx
throws an `Error` carrying `.status` and `.body`. `getErrorMessage(err)`
(`util.jsx:102`) is the standard way to render that. A 401 `Invalid or expired session` on a request that
carried a cookie is the one dead-session refusal: apiFetch forgets the cached user and announces it on the
window (`src/lib/session-ended.js`, `c2:session-ended`), and `Std_Layout` runs the signed-out front door
(section 3c) at once, the same as a cookie-less visit. Other 401s stay with their caller.

`setSessionCookie(token)` (`util.jsx:676`) is the one client-side writer of the
session cookie: `__Host-sessionToken` with `secure` on an https page,
`sessionToken` without it on plain http (a browser keeps neither a `__Host-`
nor a `Secure` cookie there), both `path=/`, seven-day `max-age`,
`samesite=strict`, never a `Domain`. Sign-in (`Login.jsx`, all three success
paths) and the account panel's session rotation both call it, so a token
rotated after an email or password change lives exactly as long as a fresh
sign-in's. Write the cookie any other way and the two drift.
`clearSessionCookie()` (`util.jsx:688`) expires both names, and sign-out
(`src/lib/sign-out.js`, `signOut()`, moved from the account panel in W6-CDX-40) goes through it.

`getSessionTokenFromCookie()` prefers the prefixed name and, on an https page,
does not read a lone legacy `sessionToken` at all, since another host could
have planted it. `upgradeLegacySessionCookie()` (`util.jsx:706`) moves a real
one across: `main.jsx` awaits it before the first render, it asks
`POST /api/validate-session` with `legacyCookie: true`, and it rewrites the
token under the prefixed name only on a yes. It gives up after 5 seconds, so a
silent server cannot hold the first render, and remembers a refusal for the
tab. Every cookie name is matched exactly by `readCookie` (`util.jsx:645`),
which strips only ASCII space and tab, never Unicode whitespace (W6-CDX-3;
[request-lifecycle.md](request-lifecycle.md) section 3, "The session cookie").

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
because they are not JSON: `uploadDocument` (`util.jsx:379`, multipart) and
`exportDocument` (`util.jsx:415`, blob download).

`exportDocument(..., 'pdf')` is the exception inside the exception: it opens an
`about:blank` window, writes the sanitized document into it, and **prints it
from the opener** (`printWindow.print()` on the window's `load`, and `close()` on
its `afterprint`). It must not write a `<script>` into that window: an
`about:blank` popup inherits the opener's Content-Security-Policy, and in
production that policy is `script-src 'self'` (`request-lifecycle.md` section
2), so an inline script there never runs and no print dialog opens. The
listeners go on after `document.close()`, because `document.write()` on the new
window clears any added before it.

The tail of the file (`util.jsx:514-621`) is imperative DOM helpers predating
the React migration: `showModal`, `showModalDimmer`, `destroyModal`,
`showDropdownMenu`, plus session-storage wrappers. They cache React roots in a
module-level `Map` (`util.jsx:17`) to avoid double-rooting the same node. New UI
should use React components (`ConfirmDialog`, `Toast`) instead.

**Every dialog is a dialog (W6-CDX-24).** `showModal` (`util.jsx:570`) renders
into `#modal-root` and hands the wrapper to `openDialog` (`src/lib/dialog.js`),
which sets `role="dialog"` and `aria-modal="true"`, names the dialog from its
first heading (or the `labelledBy` option), moves focus to the first control that
is not the close button, traps Tab, closes on Escape, and makes `#root` inert.
`destroyModal` (`util.jsx:544`) closes it and returns focus to the opener of the
first modal of the stack, which `showModal` claims before the content renders so
an `autoFocus` inside it cannot become the opener. A dialog that replaces another
keeps the one overlay and the one claim. The contract is four plain modules:
`src/lib/focus-trap.js` (`FOCUSABLE`, `trapTab`), `src/lib/overlay.js` (the
inert-and-no-scroll counter), `src/lib/focus-claim.js` (the opener; a detached
opener falls back to the first control in `#root`), and `src/lib/dialog.js`
(`openDialog`, `closeDialog`, one keydown listener for the page's life). Dialogs
form a stack: only the top one is trapped and receives Escape, each holds its own
overlay count so an inner close leaves the root inert for the outer, and Escape
inside a dialog is ignored when it is composing, keyCode 229, or already
`defaultPrevented` by a control in the dialog. A GitHub modal's Escape goes
through the same guards as its button (a discard prompt, or nothing while in flight).

A dialog that renders in the page instead (the GitHub modals in `GitHubPage.jsx`,
`ImageCropModal`, the `FirstRunGate` welcome) uses `useDialog`
(`src/hooks/useDialog.js`) and is **portalled to `document.body`**: `#root` is
inert while any dialog is open, so a dialog left inside it would be inert too.
`FirstRunGate` has no close control, so Escape does not dismiss it; Get started
is its exit. `tests/design/dialogs.test.js` scans every file under `src/` for a
dialog wrapper without its role, and for a close control that is not a button
named Close. `tests/src/components/dialog-contract.test.jsx` drives each dialog
from the keyboard: open, Tab wrap, Escape, and focus back to the opener.

## 3. Hooks (`src/hooks/`)

| Hook | Purpose |
|---|---|
| `useCollab.js` | the `/collab` WebSocket and the shared `Y.Doc`; returns connection state, presence, cursors, and five senders |
| `usePresence.js` | polls `/api/presence` for who is in which document, for browse/archive views |
| `useNotificationChannel.js` | the `/notifications-ws` socket, feeding the Notifications nav item's unread count in `Sidebar.jsx` |
| `src/lib/sign-in-target.js` | the kept deep link under `c2-sign-in-target`; `getStorage()` returns null when sessionStorage throws, which every caller treats as refused (fail closed) |
| `useSignedOutTarget.js` | the signed-out deep-link decision (W6-CDX-8, W6-CDX-26). `useSignedOutTarget()` (`:176`) asks `/api/oauth/providers` only, then `resolveSignedOut` (`:105`) returns `bounced`, `login` or `landing`. The pure rule is `decideSignedOut` (`:53`); every target goes through `safeReturnTo` (`services/return-to.js`), the one validator the server uses |
| `useGitHubStatus.jsx` | whether the user has linked GitHub; gates every GitHub affordance. The provider asks `GET /api/github/status` only while `enabled`, and reads `false` while not, `null` from enabling until the answer |
| `useGitHubLink.js` | per-document link and sync state, drives `GitHubSyncBanner`; with `{ enabled: false }` it asks nothing and reports no link |
| `useClickOutside.js` | dismiss-on-outside-click for menus and popovers |
| `useFirstRun.js` | fetches `GET /api/first-run` once per mount, exposes `{ firstRun, loading, complete }` |

`useCollab` is the intricate one. It memoises the `Y.Doc` so it survives
re-renders (`useCollab.js:49`), keeps the latest callbacks in refs so the socket
effect does not re-run when a parent re-renders (`useCollab.js:40-46`), queues
outbound updates until the server's sync completes and flushes them afterwards
(`useCollab.js:83`, `useCollab.js:126-129`), and auto-reconnects on close.
`sendPublish` returns a promise resolved by the server's `published` frame with
a 10-second timeout (`useCollab.js:253-284`).

`useGitHubStatus` is a `.jsx` file, not `.js`, because it exports a context
provider alongside the hook.

**The layout and the editor do not ask a GitHub route that would refuse.** The
status route (`routes/oauth.js`) is behind `requireAuth`, a 401 signed out, and
every route in `routes/github.js` is behind `requireGitHub` as well, a 403 with
no account linked. Both used to ask anyway: every signed-out landing page logged
a 401 and every document view by an unlinked user a 403. `Std_Layout` now mounts
`GitHubStatusProvider` inside itself with `enabled={Boolean(user)}`, so nothing
is asked until its auth check finds a user (a stale session cookie included),
and the editor passes `{ enabled: connected === true }` to `useGitHubLink`. The
server's gates are unchanged; the client only stopped asking. The provider holds
`null` from enabling until its answer, so the sidebar, which hides its GitHub
link on `false`, does not flash it away for linked users.
`tests/src/page_layouts/Std_Layout.test.jsx` pins the signed-out and
stale-cookie cases.

`useFirstRun` dismisses locally before the completion request resolves:
`complete()` sets local state to null immediately, then fires
`POST /api/first-run/complete` and swallows a failure, so a network error
never leaves the welcome stuck on screen (worst case it reappears once on
the next load). A fetch failure on mount leaves `firstRun` `null`, which
renders nothing, on purpose: onboarding must never be able to gate the rest
of the application.

## 3c. The signed-out front door (W6-CDX-26)

A signed-out visitor's deep link has three outcomes, decided by `decideSignedOut`
(`src/hooks/useSignedOutTarget.js:53`). The `/404` page always answers `landing`, and never asks
the server. Where OIDC is the only sign-in (`isOidcOnly`, `:36`), the link bounces once per tab to `/api/auth/oidc/start?returnTo=`. The marker is
`sessionStorage["c2-oidc-bounce"]`, cleared on a successful sign-in (`clearOidcBounce`, called from
`Std_Layout.jsx` `checkAuth`). An `oauth_error` return renders the landing. Where no OIDC is offered,
the validated target is kept under `c2-sign-in-target` (`src/lib/sign-in-target.js`) and the caller
opens the Login modal. That also covers OIDC offered beside local login, so a deep link
never redirects to `/`. Dismissing the modal (`destroyModal`, `util.jsx`) forgets the kept target; `Login.jsx` `finishSignIn` sends a successful sign-in to the kept target, or reloads. A `bounced` result needs no other work.

A session that the server ends while the tab is open (a sign-out in the other product) is caught by the first
refused request: `noteRefusal` (`util.jsx`) ends the session only when the cookie still holds the refused token, and
announces `c2:session-ended`. `Std_Layout` then checks the unsaved-changes registry (`src/lib/unsaved-changes.js`,
written by the editor). With nothing unsaved it clears its signed-in state and runs the same front door. With unsaved
content it does not navigate: a blocking notice (`SessionNotice`) offers sign-in in a new tab, a copy of the text, and
"I have signed in", which re-checks the cookie. The editor's dirty state reaches the registry only after this tab's
user has given input since the last save (`userTouchedRef`), so the initial population does not count. A socket
the server closes as signed out (4004 "Signed out", `useCollab`) stops reconnecting and ends the session the same way.
The raw uploads, the export and the avatar go through `sessionFetch` and `noteRefusal` too. Parallel refusals on one
page run it once, and the once-per-tab marker stops a second bounce. A page load that validates before its own document 401s still clears the marker (checkAuth), so a server
that validated and then refused the document would bounce again per round trip; the shared validator makes that
unreachable today. The dead-session message is one constant (`services/session-messages.js`) that the server and
the client both import.

The target is `safeReturnTo(pathname + search + hash)` on the client too (the fragment is carried because a browser never sends it), so an encoded path (a `%`
anywhere in the path) falls back to `/` and the bounce still happens, 

The bare `/` (decided by Kyle, 2026-10-11) bounces to the sign-in only where OIDC is the only sign-in
(OIDC-only: `isOidcOnly`). It goes to `/api/auth/oidc/start?returnTo=%2F`, under the same once-per-tab marker.
It does not bounce when the marker is set, when an `oauth_error` came back, or when the query carries
`?signedOut=1` (the sign-out landing must show its message). A local-sign-in instance, or one with no
OIDC, keeps its sign-in screen on `/`, so self-hosters are not stranded. a sibling deployment's bounce flag
is a separate flag in the Command repo, and this change does not touch it.

- **The landing after a sign-out.** `?signedOut=1` on `/` shows the sign-in landing, with its Sign in button
  and no sentence (`NoLoginMessage` in `Std_Layout.jsx`). The sidebar footer's sign-out (`src/lib/sign-out.js`) sends a local sign-out to
  `/?signedOut=1` (the OIDC path sends the issuer's end-session URL, which returns there too).
- **The OIDC button's name.** `GET /api/oauth/providers` names the button `OIDC_PROVIDER_NAME` when it
  is set, else `SSO` (`oidcButtonName`, `routes/oauth.js:188`).
- **The Login modal.** With OIDC offered beside local login, the SSO link sits above the local form, as an
  `btn-oauth` link. Its markup is pinned by the snapshot in `tests/src/components/__snapshots__/Login-front-door.test.jsx.snap`.

## 4. Components

`src/components/` holds 34 reusable components plus a `github/` subfolder for
the picker modals. The reusable primitives worth knowing before you build a new
one:

- `<Toast>` and `toastError()` for transient feedback, `<ConfirmDialog>` for
  destructive confirmation. The Toast is the shared toast primitive
  (W6-CDX-23). Its dismiss is a real `<button class="toast__dismiss" aria-label="Dismiss
  notification">`, so Tab reaches it and Enter or Space dismisses; the toast body
  is not clickable. Each toast is its own live region: `role="alert"` for an error,
  `role="status"` for success and info (`Toast.jsx`, the `role` on the toast div),
  and the container carries no `aria-live`, so one announcement is made, not two.
  A toast holds (its timers pause) while the pointer is on it or focus is inside
  it, and resumes with the time it had left; a dismiss that drops focus sends it
  back to where focus came from, or to the container. These are pinned in
  `tests/src/components/Toast.test.jsx` with fake timers. The toast CSS is on tokens
  at `src/index.css` (the `.toast` block, after `Toast Notifications`). The stack sits bottom right
  (`.toast-container`, W6-CDX-39). A `showToast` before the container's effect has registered is queued
  and drained on mount (X2), and `toastError` takes a string or an error, with an optional fallback second
  argument (X3); the admin revoke, permission and member saves pass the error itself, so a refusal keeps its
  "Permission denied" prefix. **`no-alert` is an ESLint error**
  (`eslint.config.js:45`); there are two legacy disables in `Editor.jsx` and
  `GitHubPage.jsx` and no more should be added.
- `<Menu>` (`src/components/Menu.jsx`, W6-CDX-39) is the one menu primitive: a `button` trigger with
  `aria-haspopup="menu"` and `aria-expanded`, named "label: visible choice" (WCAG 2.5.3), and a `role="menu"` popup of
  `role="menuitemradio"` buttons with `aria-checked` (every Menu is single-choice). The popup is portalled into its own
  `#menu-root` (never `#dropdown-root`, which `showDropdownMenu` hides and clears), or into the aria-modal dialog the trigger
  sits in, so the dialog's focus trap and the accessibility tree reach it. It follows the trigger on scroll (capture phase)
  and resize. Arrow keys wrap, Home and End jump, a letter jumps to the next match, Escape and Tab close it and return focus to
  the trigger; an outside press closes it. No scrim. The Explore sort and the invite dialog's squad and role use it; the export
  and GitHub sync menus take its look (colour only) and keep their own markup. Tests: `tests/src/components/Menu.test.jsx`,
  `tests/src/pages/invite-menu-focus.test.jsx`.
- `<Menu mode="actions">` (W6-CDX-41) is the **More actions** menu on a list row: an icon trigger named by `label`, no choice
  shown, `role="menuitem"` items with no `aria-checked`, and an item flagged `danger` takes the danger text (never a solid
  button). It end-aligns its popup under the trigger (`translateX(-100%)`), so it cannot run off a phone. The archive list
  is its one caller (Go to squad, Rename, Manage access, Delete). Tests: `tests/src/components/Menu.actions.test.jsx`.
- `<EmptyState>` (`src/components/EmptyState.jsx`, W6-CDX-41) is the one empty state: a Poppins title, one line and an
  optional action, in `.empty-state`. Home, an empty document tree, the archive list, Notifications and Activity render it.
- `<DocumentHeader>` (`src/components/DocumentHeader.jsx`, W6-CDX-41) is the document page header, built on `<PageHeader>`
  above the editor canvas and mounted by `Editor.jsx`. It shows the author's name (never the email), the title (the page h1,
  renamed in place in edit mode), star and watch as icon buttons with `aria-pressed`, Edit as the read-mode primary, and the
  GitHub link. The editor's own toolbar below it is unchanged in structure; its emoji became stroke icons.
  `tests/src/components/DocumentHeader.test.jsx` pins it.
- `<Avatar>` (`src/components/Avatar.jsx`, W6-CDX-39) draws a photo or the initial on one of the package's
  `--avatar-1..8` tints; the tint is `avatarTint(id)` in `src/lib/avatar-tint.js`, a stable hash of the actor's id
  (`user_id`, `actor_id`), so two users with one name keep their own tints.
- `src/lib/destructive-copy.js` (W6-CDX-39) holds the title and message of each destructive `ConfirmDialog`; each sentence
  names what is lost and what stays, checked against the FK actions in `init.sql` and the route's delete.
- `src/components/icons.jsx` is the stroke icon set (15 px, `currentColor`, decorative): the menu chevron, the toast's
  status marks, the favourite star, the Account warning, the comment count, Login's marks, and (W6-CDX-41) the More actions
  dots, the document toolbar's pencil, eye, save, package, list, history and tray. Emoji still stand in the admin console
  (W6-CDX-42).
- `.btn-icon` (W6-CDX-39) is the 30 px icon button with a 44 px hit area; the dialog close buttons, the toast dismiss and the
  search clear carry it. `.chip` is the pill at the 12 px floor; `.tabs` and `.tabs__tab` are the one tab row.
- `src/lib/inbox-cache.js` keeps the signed-in user's unread count, recent list and archives for the page's life, so the
  sidebar, which remounts on every navigation, shows them at once. Sign-out clears it. `subscribeInboxFrames`
  (`useNotificationChannel.js`) is how a page hears the live channel; the Notifications list reloads on it.
- `<PresenceAvatars>` pairs with `usePresence`.
- `<PageTree>` renders the `logs.parent_id` tree (its heading is "Documents"; the archive's name is in the page header
  above the grid when no document is open, and in the document header's crumb when one is).
- `<WebhooksPanel>` is the admin console's Webhooks panel (W6-CDX-15). Its confirmations go through
  `<ConfirmDialog>`, and it renders a subscription's secret only in its one-time reveal box.
- The shell (W6-CDX-40): `<Sidebar>` (`src/components/Sidebar.jsx`) is the one navigation column; `<SearchPalette>`
  is its "Search or jump to" trigger and the Ctrl K dialog (documents from `/api/search`, archives by name, portalled
  into `#palette-root`, registered with `openDialog` so Escape and Tab are the stack's; Ctrl K is a no-op while another
  modal is open); `<AccountFooter>` is the avatar, the name's non-modal menu and the sign-out icon button;
  `/workspaces` renders the Workspaces page for every instance; `<PageHeader>` is the page title, meta, primary
  action, toolbar slot and tab row, and the header's `<AppearanceControl>` (the Appearance popover) after them on every page (W6-CDX-44); `<ProductMark>` is the page glyph on the accent tile (K10). `<NotificationItem>`,
  `<ActivityItem>`, `<CIStatusBadge>`. **`SearchResultItem`
  has no callers**: search results reach the user through `ExploreCard`, so it
  is dead code (see `open-questions.md` B13).
- **A document's title is a real `<Link>` or `<button>` in every list view**
  (`ExploreCard`, `LogTreeItem`, `PageTree`'s `TreeItem`, `SearchBox`'s
  dropdown), while the row or card around it keeps its own `onClick` for the
  mouse. The title stops propagation so one activation is not counted twice.
  Adding a new list of documents means carrying that pattern, not a bare
  `<div onClick>`: see `open-questions.md` B13 for why.
- **The palette and the account menu are the overlays to keep in step.** `SearchPalette` is a modal dialog: it
  takes focus on open, keeps Tab inside itself, closes on Escape from anywhere and returns focus to its trigger.
  `AccountFooter`'s menu is non-modal (no scrim): it closes on an outside press, on Tab out and on Escape, which
  returns focus to the name. Neither uses `Menu.jsx`, whose items are single-choice radios; the footer's are actions.
- Some inner components are exported purely so they can be unit-tested without
  mounting their data-fetching parent: `ExploreCard` and `Pagination` from
  `ExploreBrowser.jsx`, and `LogTreeItem` plus `ManageArchiveAccessModal` from
  `ArchiveBrowser.jsx`. W6-CDX-24 added the dialogs inside `AdminPage.jsx`,
  `WorkspacesPage.jsx`, `ArchiveBrowser.jsx`, `SearchResultItem.jsx` and
  `GitHubPage.jsx`, so each one's close control is keyboard-tested.
- **`ManageArchiveAccessModal` lists the grants it can revoke.** It is modal
  content rendered through `showModal`, which owns a single slot, so its
  destructive confirmation swaps `<ConfirmDialog>` in for the panel rather than
  stacking a second modal on top of it; Cancel returns with the panel's state
  intact. The Revoke control is on each explicit grant from
  `GET /api/archives/:id/access`, never on an inherited squad-membership row.
  See `access-control.md` for why the user search cannot be the source.
  `inheritedAccessSource()` in the same file reads `owner_squad_members`,
  `granted_squad_user_ids` and `read_workspace` / `write_workspace` out of that
  response to spot a grant another access clause also covers. Such a row keeps
  its control, since the ACL entry is real, but is labelled **Remove Grant**
  with an `also inherited from ...` note, and its confirmation and toast say the
  grant was removed rather than that access was revoked.
- Comment UI is four components: `CommentManager` (orchestration),
  `CommentSidebar`, `CommentForm`, `CommentHighlights` (in-document marks).
- `RemoteCursors.jsx` exports `RichTextCursors` and `MarkdownCursors`, two
  renderers over the same collab cursor data.

`src/page_layouts/Std_Layout.jsx` is the shell (the sidebar beside the content slot) that
every page composes, and the home of `GitHubStatusProvider` (section 3); the sidebar
(`src/components/Sidebar.jsx`) reads the status from it. There is no top bar, no bottom tab bar
and no footer (W6-CDX-40): on a phone (at most 599 px) the sidebar is the two-row top strip in
`index.css`. Because `children` render
only once the auth check has found a user, the standalone editor route wraps
`EditorView` in it rather than the other way round, which puts the view's hooks
inside the provider exactly as `ArchiveView`'s embedded editor already was. Its
authenticated branch renders `<FirstRunGate />` ahead of `children`, which is the mount point that finally makes the welcome
reachable for the admin, who is synced from `.env` at boot rather than
signing up through an invitation and so never passed through the old
imperative call in `Login.jsx`.

`FirstRunGate` holds no copy of its own: it calls `useFirstRun`, renders
nothing while loading or once `needsOnboarding` is false, and otherwise portals
`WelcomeSetup` to `document.body` as a dialog (`role="dialog"`, opened with
`openDialog`) inside the shared modal-dimmer markup. `WelcomeSetup` is
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

Two stores, one per concern, and the seam between them.

**The theme and accent preference, W6-CDX-44, host-only since CDX-SA-2.** `src/lib/appearance-prefs.js` is the one
module that reads, writes, clears, migrates and keeps open pages in step for `cc_suite_theme` and `cc_suite_accent`.
The cookie names are kept from the shared-cookie era, so a stored choice still reads back. The preference is per
host: no cookie is shared across a parent domain, and the record of the shared contract is retired (its open items
are carried in `docs/maps/open-questions.md`, section H).

- Reads (`resolveTheme` `:73`, `resolveAccent` `:94`, `storedThemeChoice` `:68`): the first valid cookie entry, then
  localStorage, then (accent only) the legacy `c2-user-prefs.accentColor` mapped through `successorOf`, then the system
  (theme: `prefers-color-scheme`, dark when no `matchMedia`) or the package's default ramp (accent: unset).
- Writes (`setTheme` `:167`, `clearTheme` `:175`, `setAccent` `:182`, `clearAccent` `:191`) happen at once. The
  value-bearing cookie (`writeChoice` `:113`) is host-only (`Path=/; Max-Age=34560000; SameSite=Lax`, `Secure` on
  https, never a `Domain`). Then `expireOnParents` (`:124`) expires the name on each parent domain of the host,
  nearest first (`parentDomains` `:102`: `a.b.example.test` gives `b.example.test` and `example.test`, never the
  public suffix; an address or `localhost` has none). Then localStorage. The page and the stores change together,
  and `subscribe` listeners hear the change.
- Keeping pages in step: `applyPreferences` (`:200`) re-reads both, and mirrors a cookie value into localStorage (the
  cookie wins). `watch` (`:224`) runs it at boot, on `visibilitychange` to visible, and on a `storage` event for either
  key. `main.jsx:26-27` calls `watch()` and `migrateLegacy()`.
- Migration: `migrateLegacy` (`appearance-prefs.js:250`) moves `c2-user-prefs.accentColor` into the contract once, writes
  it before deleting the legacy key, and needs no server answer.
- There is no preference domain: `SUITE_PREFERENCE_DOMAIN` is a removed variable (`env-contract.js`), and no client
  code asks the server for a domain.

**The pre-paint script, W6-CDX-44.** `index.html:20-57` is an inline script in the head, after
`<meta name="color-scheme">` (`:11`), that applies the theme (`data-theme`, the meta's content) and the accent
(`--cx-accent-h` and an empty `data-accent`) before first paint, with the same precedence as `appearance-prefs.js`. Its
SHA-256 is `THEME_BOOT_HASH` in `theme-boot-hash.js`, which `app.js:312` puts in `script-src`. Edit the script and
the constant together: `tests/theme-boot-hash.test.js` checks `index.html` and the built `dist/index.html` byte for
byte, and `tests/src/theme-boot.test.js` runs the script's own text against each precedence case.

**`src/userPrefs.js`: the editor preferences.** One localStorage key, `c2-user-prefs` (`userPrefs.js:17`), now
holding the font size and the preferred editor. `ACCENT_COLORS` (`:51`) is a view over `ACCENTS` in
`src/tokens/accents.js`, the one data file for the eight hues and the contract's steps; `FONT_SIZES` (`:55`).
`loadUserPrefs()` (`:24`) maps a renamed accent key through `LEGACY_ACCENT` and drops a density or sidebar default.
`applyPrefsToDOM(prefs)` (`:66`) writes `--editor-font-size` only; it never touches the accent (W6-CDX-44 moved that
to `appearance-prefs.js`), and it removes the property when the preference is unset. `codex.css` derives the four steps
per theme under `[data-theme][data-accent]` from `--cx-accent-h`.

**The header's Appearance popover and the Account section.** `AppearanceControl`
(`src/components/AppearanceControl.jsx`) is a native "Appearance" button in every `PageHeader`'s action row, after
the primary and the toolbar (`PageHeader.jsx`). It opens a non-modal panel portalled to the body: a Theme group and an
accent group, the same groups as the Account page. Its focus contract: the checked Theme option takes
focus on open, `trapTab` (`src/lib/focus-trap.js`) keeps Tab inside, Escape and an outside press return focus to the
toggle. `AppearanceOptions.jsx` holds `ThemeOptions` (System, shown as "System" and named "Match system"; Light; Dark)
and `AccentOptions` (eight swatches and Default). Each group subscribes to `appearance-prefs.js` itself, so the popover and
`UserPreferencesPanel` (`src/components/AccountMenu.jsx`) cannot disagree. Their saves in that panel merge into the
stored prefs, so a legacy key not yet migrated survives.

## 6. Styling

Four stylesheets, imported by `src/main.jsx` in this order, which is
load-bearing:

1. `vendor/cloud-city-design/core.css`, the suite's 61 literal primitives on
   `:root` (accent and semantic ramps, type scale, spacing, radii, motion, the
   z-scale). It opens with its Apache-2.0 notice; Vite keeps it at the head of
   the built stylesheet only because it is imported first and
   `vite.config.js` sets `esbuild.legalComments: 'inline'` (Vite's default
   strips it).
2. `vendor/cloud-city-design/fonts.css`, `@font-face` for Inter and Poppins
   with relative URLs, so Vite fingerprints the six `.woff2` files into
   `dist/assets/`. Never `public/`, which the `app_public` volume shadows.
   Nothing sets either family yet, so no font is fetched.
3. `src/codex.css`, Codex's bindings: every name `--cx-` prefixed, in three
   blocks. A bare `[data-theme]` holds what both themes share (`--cx-white`, the
   Google colours, the layout sizes and the transition); `[data-theme='dark']` and
   `[data-theme='light']` hold the rest, each with its `color-scheme` (W6-CDX-43
   added the light block). `index.html` sets the attribute on `<html>` to dark as the no-script
   default; the pre-paint script (section 5) sets the stored or system theme before first paint (W6-CDX-44). Two `[data-theme][data-accent]`
   blocks derive the picked accent's steps from `--cx-accent-h`. The deferred
   families' literals are `--cx-deferred-*` bindings, one per literal, and
   `--cx-code-wash` and `--cx-syntax-*` carry the code block (W6-CDX-43, colour
   only; `tests/design/geometry-fingerprint.test.js` pins their geometry). The dark values are restated from the theme table in
   `tests/design/theme.json`, and this file must
   equal it (W6-CDX-38). Three surfaces and the selection wash (`--cx-surface-0`
   to `-2`, `--cx-select-wash`; the fourth and fifth steps retired with the hover
   fills), three text levels, the accent (`--accent-400`), its hover and fill, the
   status colours on the bright step, the card hairline and the control's strong
   hairline (`--cx-border-strong`), the scrim and the focus ring, the drop-shadow
   inks, and the layout sizes and transition. Core's radii apply: Codex no longer
   declares its own. Since W6-CDX-28 it also
   holds the translucent tints (`--cx-tint-*`, measured over every surface by
   `tints.test.js`), the bright text steps a label on a tint steps up to, and the
   popover shadow. W6-CDX-29 adds the admin, settings and notification washes at
   their exact alphas (`--cx-tint-accent-faint` to `-edge`, `-success-quiet`, `-danger-quiet`,
   `-slate`, `-neutral`), a solid `--cx-white` for labels and marks on dark fills, and
   `--cx-ring-light` for a swatch's hover ring. A label on a tint that sank below 4.5:1 steps to
   `--cx-accent-hover` or a bright step, as W6-CDX-28 did.
4. `src/index.css`, about 9,200 lines, the whole app. No CSS modules, no
   preprocessor, no utility framework. Its one focus ring is the global
   `:focus-visible` rule (`index.css:5758`, the bare selector after the `.gh-sync-menu :focus-visible` rule), on `--cx-focus-ring`; no source under
   `src/` removes an outline, and `painted.test.js` pins both. A container that clips
   (`.editor-container`, `.markdown-editor__textarea-wrapper`, `.sidebar`,
   `.gh-browser__sidebar`, `.gh-modal`, `.gh-merge-dialog__pane`, `.gh-sync-menu`) draws its controls' rings
   inside the control (`outline-offset: -2px`), since a ring outside a flush control
   is cut off by the clip; text fields sit at `outline-offset: 0` against their border. Its `:root` block (`index.css:12`) is
   the **legacy-alias bridge** (W6-CDX-22): the 22 legacy names every rule
   reads (W6-CDX-38 retired the two hover names and the three radii), plus five undeclared names that carried the heaviest literal
   fallbacks (`--bg-secondary`, `--bg-tertiary`, `--border`, `--color-accent`,
   `--accent-color`). Each points at one `var()` into `codex.css` or `core.css`
   and holds no literal, pinned by `tests/design/bridge.test.js`. Rules that
   paint white labels on an accent or danger background read the dark step
   (`--brand-blue-hover`, `--color-danger-hover`), not the pale text step.
   The accent-fill labels paint `--cx-on-accent` (a dark ink), since white on
   the pale fill measures 2.7 to 3.1:1. The danger fill is `--cx-danger-fill` (the
   bright step) with the same ink, and its hover is an inset ring on that fill
   (W6-CDX-38). Avatar initials sit
   on `--brand-blue-dark`, which is `--cx-accent-dark` and follows the picker.

**One name overlaps.** `index.css` redeclares `--brand-blue`, which `core.css`
also declares. W6-CDX-22 had a second group, the three radii, which W6-CDX-38
removed: the bridge no longer declares them, so core's 6, 10 and 14 px apply.
`tests/design/codex-css.test.js` pins the set so it can only shrink.
This is a recorded exception, decided in W6-CDX-22: the bridge keeps the names
so no rule or test changes, and `--brand-blue` now points at `--cx-accent`.
**One name changed meaning:** `--font-mono`, which two GitHub-page rules read
with a fallback, now resolves to core's monospace stack.

Theming works through CSS custom properties set by `applyPrefsToDOM` on the
root element, which is why preferences apply instantly without a re-render.
The design gate (`tests/design/`, see
[build-test-and-ops.md](build-test-and-ops.md) section 5) holds `src/` to an
exemption ledger of literal colours, accent fill shades in text positions and
suppressed outlines that can only shrink, and fails on any `var()` without a
fallback that names nothing.

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
`tests/src/**` (`vitest.config.js`, the `frontend` project). In scope and required by
`CLAUDE.md`: `src/hooks/`, pure-JS utilities under `src/`, and reusable
components in `src/components/`.

Out of scope by default: `src/pages/`. `Editor.jsx` (1332 lines) and
`GitHubPage.jsx` (2652 lines) need logic extracted into testable components and
hooks before unit-testing them is worth it. That extraction is **track E2, now
in progress**: `src/components/editor/` holds the pieces already pulled out of
`Editor.jsx` (`ReadOnlyContent`, `VersionHistory`), and the markdown/sanitize
helpers moved to `src/editorUtils.js`. Anything extracted out of a page is in
scope and needs tests, which is the point of moving it.

`src/editorUtils.js` also owns `marked.setOptions({ breaks, gfm })`, which
belongs beside `markdownToHtml` rather than in a page now that the parsing
function is independently importable. `marked` is a module singleton, so a
second module setting different options would win globally; `GitHubPage.jsx`
sets the same two and is therefore harmless. This was never a live bug: while
`markdownToHtml` lived in `Editor.jsx`, ESM guaranteed that file's
`setOptions` ran before anything could call it.

---

## Related

- [documents-and-collab.md](documents-and-collab.md) for the editor and
  `useCollab` in depth.
- [github-integration.md](github-integration.md) for the GitHub UI surface.
- [build-test-and-ops.md](build-test-and-ops.md) for the Vitest project split
  and thresholds.

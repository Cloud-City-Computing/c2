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
(`AccountPanel.jsx`) goes through it.

`getSessionTokenFromCookie()` prefers the prefixed name and, on an https page,
does not read a lone legacy `sessionToken` at all, since a sibling host could
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
| `useNotificationChannel.js` | the `/notifications-ws` socket, feeding `NotificationBell` |
| `useSuite.js` | suite mode: `GET /api/suite` once per page load, and `GET /api/suite/links` only for a signed-in user while suite mode is on. Any failure reads as off. `__resetSuiteCache` is the test seam |
| `useSuiteLinks(signedIn)` (`src/hooks/useSuite.js:80`) | the same two requests for a page outside the layout's user state (the editor), made only when `signedIn` (a signed-out viewer makes no request): `{ commandWorkspaceUrl }` in suite mode, `null` otherwise or on any failure |
| `src/lib/sign-in-target.js` | the kept deep link under `c2-sign-in-target`; `getStorage()` returns null when sessionStorage throws, which every caller treats as refused (fail closed) |
| `useSignedOutTarget.js` | the signed-out deep-link decision (W6-CDX-8, W6-CDX-26). `useSignedOutTarget()` (`:164`) asks `/api/oauth/providers` and `suiteEnabled()`, then `resolveSignedOut` (`:107`) returns `bounced`, `login` or `landing`. The pure rule is `decideSignedOut` (`:54`); every target goes through `safeReturnTo` (`services/return-to.js`), the one validator the server uses |
| `useGitHubStatus.jsx` | whether the user has linked GitHub; gates every GitHub affordance. The provider asks `GET /api/github/status` only while `enabled`, and reads `false` while not, `null` from enabling until the answer |
| `useGitHubLink.js` | per-document link and sync state, drives `GitHubSyncBanner`; with `{ enabled: false }` it asks nothing and reports no link |
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

## 3b. Suite mode (W6-CDX-25)

Suite mode is off unless the server reads `SUITE_COMMAND_WORKSPACE_URL` (`services/suite.js:17`,
`readSuiteConfig`). Boot calls it once and exits 1 with its sentence on a refusal (`server.js:199`).
`routes/suite.js` mounts `GET /api/suite` (public, `enabled` and `name` only) and
`GET /api/suite/links` (`requireAuth`, 404 when off), registered in `app.js` beside the other
`/api` routers. In the client, `useSuite(user)` (`src/hooks/useSuite.js:40`) feeds
`StdLayout` (`Std_Layout.jsx:263`), which passes `suite` to `TopBar` (`Std_Layout.jsx:170`).
`TopBar` renders `SuiteCluster` in place of the plain brand link only when the user is signed in
and suite mode is on with a URL; otherwise the brand slot is the old markup, which
`tests/src/page_layouts/top-bar.test.jsx` snapshots. `SuiteCluster`
(`src/components/SuiteCluster.jsx:35`) is a non-modal disclosure, not `role="menu"`: this product
(`aria-current="true"`), Cloud Command, a separator, All workspaces (`/?switch=1`, Cloud Command's
choice). Its panel is absolutely positioned under the toggle inside `.cc-suite`, unclipped
because `.topbar` does not clip. Open state resets on every history entry (`location.key`).

`SuiteDocLink` (`src/components/SuiteDocLink.jsx:18`, W6-CDX-27) is the link out to Cloud
Command's Linked tasks page for a document (W6-CMD-25), `<workspace URL>/docs/<archiveId>/<logId>`,
built by `suiteDocHref` (`src/lib/suite-doc-href.js:27`, kept out of the component file so the
fast-refresh lint rule holds). It renders nothing outside suite mode, before the
archive id is known, for a signed-out viewer, when the URL is not http(s), or when an id is not a
positive int4. The archive id is passed only once the loaded document's id is the route's log id. It
is mounted once in the document meta line of `Editor.jsx:1153`; the class `.suite-doc-link` is
in `src/index.css`, and its colour is measured in `tests/design/painted.test.js`.

## 3c. The signed-out front door (W6-CDX-26)

A signed-out visitor's deep link has three outcomes, decided by `decideSignedOut`
(`src/hooks/useSignedOutTarget.js:54`). The `/404` page always answers `landing`, and never asks
the server. Where OIDC is offered and is the only sign-in (`isOidcOnly`, `:37`), or suite mode is on,
the link bounces once per tab to `/api/auth/oidc/start?returnTo=`. The marker is
`sessionStorage["c2-oidc-bounce"]`, cleared on a successful sign-in (`clearOidcBounce`, called from
`Std_Layout.jsx` `checkAuth`). An `oauth_error` return renders the landing. Where no OIDC is offered,
the validated target is kept under `c2-sign-in-target` (`src/lib/sign-in-target.js`) and the caller
opens the Login modal. That also covers OIDC offered beside local login outside suite mode, so a deep link
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
anywhere in the path) falls back to `/` and the bounce still happens, as Cloud Command does.

The bare `/` (decided by Kyle, 2026-10-11) bounces to the sign-in only where OIDC is the only sign-in
(hosted: `isOidcOnly`). It goes to `/api/auth/oidc/start?returnTo=%2F`, under the same once-per-tab marker.
It does not bounce when the marker is set, when an `oauth_error` came back, or when the query carries
`?signedOut=1` (the sign-out landing must show its message). A local-sign-in instance, or one with no
OIDC, keeps its sign-in screen on `/`, so self-hosters are not stranded. Command's `BOUNCE_BARE_ROOT`
is a separate flag in the Command repo, and this change does not touch it.

- **The landing after a sign-out.** `?signedOut=1` on `/` shows "You're signed out of <name>." in
  suite mode only (`NoLoginMessage`, `Std_Layout.jsx:247`; the name is `useSuite`'s, never a literal).
  Outside suite mode the landing is unchanged. `AccountPanel.jsx` sends a local sign-out to
  `/?signedOut=1` (the OIDC path sends the issuer's end-session URL, which returns there too).
- **The OIDC button's name.** `GET /api/oauth/providers` names the button `OIDC_PROVIDER_NAME` when it
  is set, else the suite's name in suite mode, else `SSO` (`oidcButtonName`, `routes/oauth.js:190`).
- **The Login modal in suite mode.** `Login.jsx` reads `useSuite(null)`. With OIDC offered, the SSO
  link is `btn-primary` and leads the modal, and the local submit is `btn-ghost`. Suite off, the markup
  is the snapshot in `tests/src/components/__snapshots__/Login-front-door.test.jsx.snap`.

## 4. Components

`src/components/` holds 34 reusable components plus a `github/` subfolder for
the picker modals. The reusable primitives worth knowing before you build a new
one:

- `<Toast>` and `toastError()` for transient feedback, `<ConfirmDialog>` for
  destructive confirmation. The Toast is the suite's shared toast primitive
  (W6-CDX-23, Kyle's D-V): Codex's is the reference and Cloud Command matches
  it. Its dismiss is a real `<button class="toast__dismiss" aria-label="Dismiss
  notification">`, so Tab reaches it and Enter or Space dismisses; the toast body
  is not clickable. Each toast is its own live region: `role="alert"` for an error,
  `role="status"` for success and info (`Toast.jsx`, the `role` on the toast div),
  and the container carries no `aria-live`, so one announcement is made, not two.
  A toast holds (its timers pause) while the pointer is on it or focus is inside
  it, and resumes with the time it had left; a dismiss that drops focus sends it
  back to where focus came from, or to the container. These are pinned in
  `tests/src/components/Toast.test.jsx` with fake timers. The toast CSS is on tokens
  at `src/index.css` (the `.toast` block, after `Toast Notifications`). **`no-alert` is an ESLint error**
  (`eslint.config.js:45`); there are two legacy disables in `Editor.jsx` and
  `GitHubPage.jsx` and no more should be added.
- `<PresenceAvatars>` pairs with `usePresence`.
- `<PageTree>` renders the `logs.parent_id` tree.
- `<WebhooksPanel>` is the admin console's Webhooks panel (W6-CDX-15). Its confirmations go through
  `<ConfirmDialog>`, and it renders a subscription's secret only in its one-time reveal box.
- `<SearchBox>` / `<SearchResultItem>`, `<NotificationBell>` /
  `<NotificationItem>`, `<ActivityItem>`, `<CIStatusBadge>`. **`SearchResultItem`
  has no callers**: search results reach the user through `ExploreCard`, so it
  is dead code (see `open-questions.md` B13).
- **A document's title is a real `<Link>` or `<button>` in every list view**
  (`ExploreCard`, `LogTreeItem`, `PageTree`'s `TreeItem`, `SearchBox`'s
  dropdown), while the row or card around it keeps its own `onClick` for the
  mouse. The title stops propagation so one activation is not counted twice.
  Adding a new list of documents means carrying that pattern, not a bare
  `<div onClick>`: see `open-questions.md` B13 for why.
- **`SearchBox`'s dropdown is the fiddly one.** Its results are links, so it
  cannot dismiss on the input's blur; it closes when focus leaves the container
  (`relatedTarget` containment) or on Escape, and the results container
  `preventDefault`s `mousedown` because Firefox and Safari do not focus a link
  on click. Removing that one line silently breaks mouse users on those
  browsers and no jsdom test can see it.
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

`src/page_layouts/Std_Layout.jsx` is the shell (nav, sidebar, content slot) that
every page composes, and the home of `GitHubStatusProvider` (section 3); its
`Sidebar` and `MobileNav` read the status from it. Because `children` render
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

`src/userPrefs.js`. One localStorage key, `c2-user-prefs`
(`userPrefs.js:16`). Three exported option maps that are the single source of
truth: `ACCENT_COLORS` (8 colours, each with value/hover/fill, a view over
`ACCENTS` in `src/tokens/accents.js`, the one data file for the picker's hues),
`FONT_SIZES` (sm/md/lg), `DENSITIES` (compact/comfortable/spacious).

`loadUserPrefs()` (`userPrefs.js:23`) maps a renamed accent key through
`LEGACY_ACCENT` (rose to Nova, amber to Solar, emerald to Aurora, violet to
Nebula; the placeholder keys coral, apricot, jade and iris map to the same names) and drops an accent key this build does not offer, so the default
palette applies.

`applyPrefsToDOM(prefs)` (`userPrefs.js:67`) writes `--cx-accent`,
`--cx-accent-hover`, `--cx-accent-fill` and `--cx-accent-dark` on
`document.documentElement` (the index.css bridge points `--brand-blue*` at
them), `--editor-font-size`, `--density-scale`, and a
`data-sidebar-default` attribute on `body`. Crucially it **removes** each
property when the preference is unset rather than writing a default, so the
stylesheet's own defaults win.

`getPreferredEditorMode()` (`userPrefs.js:105`) returns `'markdown'` or
`'richtext'`, defaulting to rich text.

**Never write to `localStorage` directly from a component.** Go through
`loadUserPrefs` / `saveUserPrefs` / `applyPrefsToDOM`. A new preference means
adding its option map here, handling it in `applyPrefsToDOM`, and extending
`tests/src/userPrefs.test.js`, which carries a 95% line threshold
(`vitest.config.js`, the `src/userPrefs.js` entry).

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
3. `src/codex.css`, Codex's bindings: every name `--cx-` prefixed, all under
   `[data-theme='dark']`, which `index.html` sets on `<html>` (Codex is dark
   only through Wave 6). Five surfaces, three text levels, the accent
   (`--accent-300`), its hover and fill, the status colours on the pale step,
   the border, the scrim, the focus ring, Codex's radii (4, 8, 12 px), its
   drop-shadow inks, and its layout sizes and transition. Since W6-CDX-28 it also
   holds the translucent tints (`--cx-tint-*`, measured over every surface by
   `tints.test.js`), the bright text steps a label on a tint steps up to, and the
   popover shadow. W6-CDX-29 adds the admin, settings and notification washes at
   their exact alphas (`--cx-tint-accent-faint` to `-edge`, `-success-quiet`, `-danger-quiet`,
   `-slate`, `-neutral`), a solid `--cx-white` for labels and marks on dark fills, and
   `--cx-ring-light` for a swatch's hover ring. A label on a tint that sank below 4.5:1 steps to
   `--cx-accent-hover` or a bright step, as W6-CDX-28 did.
4. `src/index.css`, about 9,200 lines, the whole app. No CSS modules, no
   preprocessor, no utility framework. Its one focus ring is the global
   `:focus-visible` rule (`index.css:5422`), on `--cx-focus-ring`; no source under
   `src/` removes an outline, and `painted.test.js` pins both. A container that clips
   (`.editor-container`, `.markdown-editor__textarea-wrapper`, `.sidebar`,
   `.gh-browser__sidebar`, `.gh-modal`, `.gh-merge-dialog__pane`, `.gh-sync-menu`) draws its controls' rings
   inside the control (`outline-offset: -2px`), since a ring outside a flush control
   is cut off by the clip; text fields sit at `outline-offset: 0` against their border. Its `:root` block (`index.css:12`) is
   the **legacy-alias bridge** (W6-CDX-22): the 27 legacy names every rule
   reads, plus five undeclared names that carried the heaviest literal
   fallbacks (`--bg-secondary`, `--bg-tertiary`, `--border`, `--color-accent`,
   `--accent-color`). Each points at one `var()` into `codex.css` or `core.css`
   and holds no literal, pinned by `tests/design/bridge.test.js`. Rules that
   paint white labels on an accent or danger background read the dark step
   (`--brand-blue-hover`, `--color-danger-hover`), not the pale text step.
   The accent-fill labels paint `--cx-on-accent` (a dark ink), since white on
   the pale fill measures 2.7 to 3.1:1; the danger labels sit on
   `--cx-danger-fill` (rest) and `--cx-danger-fill-hover`. Avatar initials sit
   on `--brand-blue-dark`, which is `--cx-accent-dark` and follows the picker.

**Four names overlap.** `index.css` redeclares `--brand-blue` and
`--radius-sm`, `-md`, `-lg`, which `core.css` also declares; loaded later on
the same selector, Codex's values win (radii 4, 8, 12 px against core's 6, 10,
14). `tests/design/codex-css.test.js` pins the set so it can only shrink.
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

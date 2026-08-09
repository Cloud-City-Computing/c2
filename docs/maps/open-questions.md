# Open Questions & Suspected Defects

Read this before trusting any single claim in the other maps as gospel.

Most of this was found by **reading the source**, not by running the app
against a live database; each item states what was verified and what was not.
The distinction matters: a static read can prove that no code queries a column,
but it cannot prove what a user sees. B8 through B10 are the exception: they
were found by running the app against a real database in a real browser, and
are marked as such.

Nothing here has been fixed. This is a findings list, not a changelog.

---

## A. Dead code paths, verified by exhaustive grep

These are the highest-confidence items. Each was checked by grepping the whole
`cloudcodex/` tree (excluding `node_modules`) for every reference.

### A1. `logs.read_access` and `logs.write_access` are write-only

- **Written by:** `routes/github.js:1653` (insert) and `github.js:1669-1679`
  (`JSON_ARRAY_APPEND` on PR-session open).
- **Read by:** nothing. `checkLogReadAccess` / `checkLogWriteAccess`
  (`routes/helpers/shared.js:56-84`) join `logs` to `archives` and apply the
  access fragment against the **archive** alias.
- **Verified:** grep for `read_access` across `routes/`, `services/`,
  `middleware/` returns only `archives`-scoped reads plus the github.js writes.
- **Not verified:** runtime behaviour.

Same story for `versions.read_access` (`init.sql:316`): declared, never read,
never written.

### A2. `github_embed_refs` has no writer

`GET /api/logs/by-github-ref` (`github.js:1900-1921`) reads the table.
`migrations/p1_github_embeds.sql` and `init.sql:253-267` create it. There is no
`INSERT INTO github_embed_refs` anywhere in the repo.

**Consequence:** the "which documents reference this file / issue / PR"
back-link always returns an empty list. The endpoint's test
(`tests/routes/github.test.js:1818`) passes because `c2_query` is mocked, so the
suite cannot catch this class of gap.

**Open question:** was the writer planned for a later phase, or lost? The
embed nodes (`src/extensions/GitHubCodeEmbed.jsx`,
`GitHubIssueEmbed.jsx`) are the obvious place to record a ref on save.

### A3. `squad_permissions` is enforced by nothing

Read and written only by `GET`/`PUT /api/squads/:id/permissions`
(`routes/squads.js:218`, `squads.js:255-271`). `requirePermission`
(`middleware/permissions.js:40-111`) consults the global `permissions` table and
then `squad_members.can_create_*`, never `squad_permissions`.

**Consequence:** a workspace owner can toggle squad-level create permissions
through the API and the UI, the value persists, and no behaviour changes.

**Open question:** should `requirePermission` gain a `squad_permissions` step
between the global check and the per-member check, or should the table and its
two routes be removed?

## B. Suspected functional defects

Higher-value, lower-certainty. Each needs a runtime check to confirm.

### B1. PR-as-document sessions are probably admin-only

`getOrCreatePrSession` (`github.js:1636-1682`) grants the caller access by
appending their id to the virtual log's `read_access`/`write_access`. Per **A1**
those columns are inert.

The parent archive is `__c2_github_pr_sessions__` (`github.js:1604`), created
with `squad_id NULL`, `created_by NULL`, and every ACL column empty
(`github.js:1618-1626`). Walk the seven clauses of `readAccessWhere` against
that row for a non-admin user:

| Clause | Result |
|---|---|
| 1. `is_admin` | false |
| 2. `JSON_CONTAINS(p.read_access, uid)` | archive ACL is `JSON_ARRAY()`, false |
| 3. `p.created_by = uid` | `created_by` is NULL, false |
| 4. workspace owner via squad | `squad_id` is NULL, subquery empty, false |
| 5. squad member | `squad_id` NULL, false |
| 6. `read_access_squads` | empty array, false |
| 7. `read_access_workspace` | FALSE |

So `checkLogReadAccess` should return `undefined`, and every
`/api/logs/:logId/comments` call on a PR-session log should 403 for non-admins,
as should the `/collab` WebSocket (`collab.js:299-303`).

**Verified:** the clause-by-clause reading above, and that the comment routes
gate on `checkLogReadAccess` (`comments.js:33`, `:98`, `:122`, `:329`, `:374`,
`:436`, `:461`).
**Not verified:** actual runtime behaviour with a real database and a non-admin
user.

**If confirmed**, the minimal fixes are either (a) grant on the archive rather
than the log, or (b) teach the log-level checks to also honour
`logs.read_access`, which would resolve **A1** at the same time.

### B2. `html_content TEXT` caps documents at 64 KiB

`logs.html_content` is `TEXT` (`init.sql:234`), i.e. 65,535 bytes. The
application's own ceiling is 2 MiB (`documents.js:22`, `collab.js:44`), and
`markdown_content` is `MEDIUMTEXT`.

**Consequence:** the app accepts a 500 KiB document, passes its own size check,
and hands MySQL a value the column cannot hold. Under MySQL 8's default
`STRICT_TRANS_TABLES` that is an error, not a silent truncation, so the save
fails with a 500 from `errorHandler`; without strict mode it truncates and the
document is corrupted.

**Not verified:** actual `sql_mode` on the shipped MySQL 8 image, and whether
any real document has hit the ceiling.

**Suggested fix:** `ALTER TABLE logs MODIFY html_content MEDIUMTEXT` in both a
migration and `init.sql`, matching `markdown_content`.

### B4. GitHub link CRUD does not check document access

`GET`, `PUT` and `DELETE /api/github/link/:logId` (`github.js:924`, `947`,
`975`) validate the id and act. They inherit `requireAuth` and `requireGitHub`
from `github.js:125` but never call `loadLinkAndLog` or any `check*Access`
helper.

**Consequence, as read:** any authenticated user with GitHub linked can read
which repo and path *any* document is bound to, repoint that binding, or delete
it. The four sync routes (`/status`, `/pull`, `/push`, `/resolve`) do gate
properly through `loadLinkAndLog` (`github.js:993-1009`), so content cannot be
exfiltrated this way, but metadata disclosure and denial-of-service on someone
else's link both look reachable.

**Not verified:** runtime.

### B5. GitHub team sync silently truncates above 100 members

`github.js:2103` and `github.js:2181` fetch team members with `per_page=100` and
no pagination loop.

**Consequence:** a team with more than 100 members yields a partial `ghLogins`
set. The preview under-reports, and the sync's removal pass
(`github.js:2230-2243`) deletes every current member whose login fell outside
the first page.

**Not verified:** no team of that size has been tested.

**Suggested fix:** paginate, or refuse to run the removal pass when the response
is a full page.

### B6. `title` is the only WS message not gated on write access

`collab.js:503` handles `{type:'title'}` with no `canWrite` check, unlike
`cursor`, `save`, `publish` and `comment`. A read-only participant can rename
the document, and the rename is broadcast and logged as `log.rename` activity.

**Verified:** by reading the five handler branches.
**Not verified:** whether the client ever exposes the affordance to a read-only
user (it likely does not, which would make this defence-in-depth rather than a
live hole).

### B7. Squad-invite emails bypass notification preferences

`DEFAULT_EMAIL_PREFS` includes `email_squad_invite: true`
(`services/notifications.js:33`), but `services/email-templates.js:59` defines
builders for only five types, not including `squad_invite`. So
`deliverEmail` bails at `services/notifications.js:170` and the funnel sends nothing.

The email is sent anyway, by a direct `sendEmail` call in
`routes/squads.js:399`, which does not consult
`users.notification_prefs`.

**Consequence:** turning off "email me about squad invites" in the preferences
UI has no effect.

### B8. `server.js` hardcoded port 3000 and reported success on a failed bind (FIXED)

`server.js` baked the port in and logged
`CloudCodex API Server is running on http://localhost:3000` from
`ViteExpress.listen`'s callback, on the assumption that reaching the callback
meant the bind had succeeded.

**Verified at runtime:** on a machine where another project already owned port
3000, the app never listened, yet still printed the success line, and requests
to `localhost:3000` were answered by the *other* application with no
indication anything was wrong.

**The root cause is Express 5, and it generalises well beyond this file.**
`express/lib/application.js` aliases the listen callback onto the socket's
error event:

```js
if (typeof args[args.length - 1] === 'function') {
  var done = args[args.length - 1] = once(args[args.length - 1])
  server.once('error', done)
}
```

So `app.listen(port, cb)` runs `cb` on a **failed** bind as well as a
successful one, with `server.listening === false`. Express 4 had no such
aliasing, so this arrived with the framework upgrade, not with `vite-express`.
The reusable rule: **in Express 5, listen's callback is not evidence of a
bind; `server.listening` is.**

**Fixed:** `PORT` is honoured (documented in `.env.example`, blank means the
3000 default, an out-of-range or non-numeric value exits rather than silently
falling back), the success line is guarded on `server.listening` and reports
the port actually bound (so `PORT=0` reads correctly), and an `'error'`
handler names the port and exits non-zero. Both paths were verified against
the running app: a busy port prints `Port N is already in use` with no success
line and exits 1, and a free custom port serves normally.

**Why the callback and not the `'listening'` event**, which is the other
honest signal: `vite-express` registers its own `'listening'` listener first
and injects the Vite middleware asynchronously, so `'listening'` fires roughly
**twelve seconds before the dev server can serve a page** (measured: 200 at
t=11.6s, `Cannot GET /` before that). Announcing there would trade a lie about
binding for a lie about readiness. The callback runs after injection.

**Docker:** `docker-compose-prod.yml` publishes `"${PORT:-3000}:${PORT:-3000}"`
so setting `PORT` moves the published mapping with it. Note that a port
conflict on a Docker host is a *host*-side collision that `PORT` alone cannot
resolve; it surfaces as Compose's own "port is already allocated".

**Still true, and worth knowing:** `APP_URL` is independent of `PORT`.
Changing the port without updating `APP_URL` produces invitation and
password-reset links pointing at the old one.

### B9. `make reset-db` and `docker compose down -v` do not reset the dev database

`docker-compose.yaml`'s `database` service mounts `./db-data/:/var/lib/mysql/`,
a **bind mount**, not a named Docker volume. `docker compose down -v` only
removes volumes Compose manages; a bind mount is host-owned and untouched, so
`-v` silently does nothing here. `make reset-db` (`Makefile`) does not touch
the volume at all either, it pipes `init.sql` then `seed.sql` through the
MySQL client against the already-running container, which drops and
recreates the tables it lists but never revisits the data directory or
anything `init.sql` doesn't already know about.

**Verified at runtime**: `db-data/` content survives both `make reset-db`
and `docker compose down -v` up. Getting a genuinely fresh database (the
`docker-entrypoint-initdb.d` path documented in
[data-model.md](data-model.md)'s Trap 1) needs `db-data/` emptied by hand,
and its contents are owned by uid 999 (the MySQL image's internal user), so a
plain host-side `rm -rf db-data/*` needs either `sudo` or a throwaway
container run as that uid to remove it.

**Consequence:** every "start from a clean database" instruction anywhere in
this repo that says `docker compose down -v` is wrong about what it does.

### B10. The squad `<select>` in the admin invite modal is unstyled

`AdminPage.jsx`'s invite-user modal renders a `<select>` for the optional
squad picker next to a text `<input>` for the email address. The input picks
up the app's dark theme; the `<select>` renders with default browser chrome
(white background, black text), visibly inconsistent right next to it.

**Verified by looking at the running app.** Cosmetic only, no functional
impact, but jarring enough to be worth a styled `<select>` (or a themed
listbox component) rather than the browser default.

### B11. Navigating away from the editor blanks the whole app (FIXED)

**Reproduced twice, in two independent browser sessions, against the built
production image.** Open any document, click `✏️ Edit`, then click any sidebar
nav link. React throws

```
NotFoundError: Failed to execute 'removeChild' on 'Node':
The node to be removed is not a child of this node.
```

and the DOM collapses from ~275 nodes to ~25. The page renders **completely
blank** and stays blank until a manual reload; the route changes in the URL
bar but nothing mounts.

Confirmed it is the editor unmounting, not any particular destination: one
session went editor to `/admin`, the other editor to `/`, with byte-identical
stack traces. Both were in edit mode with a live collab session open.

The shape is the familiar ProseMirror-and-React teardown race, where
ProseMirror removes DOM that React still believes it owns, so React's own
removal fails. It is fatal rather than merely noisy because **there is no
ErrorBoundary anywhere in `cloudcodex/src/`**, so one throw during unmount
takes down the entire root. That missing boundary is the same gap flagged for
the null-owner crash in the workspace `owner_id` review.

**Root cause.** `RichTextEditor` in `Editor.jsx` portalled the cursor and
comment-highlight overlays into `.tiptap`'s **`parentElement`**, the node
`EditorContent` renders and whose children ProseMirror manages. An effect even
reached in and set `position: relative` on it. React and ProseMirror therefore
both mutated the same parent, and on teardown ProseMirror emptied it before
React removed the portal children, so React's `removeChild` found a node that
was no longer its child.

**Both halves are fixed.**

1. **No more portals.** The overlays now render as ordinary siblings of
   `EditorContent` inside `div.tiptap-overlay-host`, an element React owns
   outright, which carries the `position: relative` in CSS rather than through a
   DOM mutation. `RichTextCursors` and `RichTextHighlights` take an optional
   `containerRef` so their coordinates are measured against that same host,
   keeping the geometry identical (they previously measured against
   `editor.view.dom.parentElement`, which was also the portal target).
2. **An `ErrorBoundary` now wraps the app** (`src/components/ErrorBoundary.jsx`,
   mounted in `App.jsx`). It was the absence of any boundary that promoted an
   unmount race into a total outage, and it would have done the same for the
   null-owner admin crash. Covered by `tests/src/components/ErrorBoundary.test.jsx`.

**Verified against the built production image**, not the dev server: opened a
document, clicked Edit, clicked a sidebar link. Before, the DOM collapsed from
~275 nodes to ~25 with the `removeChild` exception; after, it navigates with
**274 nodes and zero console errors**, and the destination page renders. The
editor's own layout and the comment highlight positions are unchanged, checked
by comparing captures either side of the change.

Tested one destination (editor to `/`) after the fix. The original bug
reproduced identically to two different destinations and the cause is
destination-independent, so this was not re-run for every route.

### B12. Production CORS rejected the app's own browser (FIXED)

`app.js` used `cors({ origin: fn })`, whose callback receives only the origin
string and never the request, so it could not recognise a same-origin call.
Browsers send an `Origin` header on same-origin POST/PUT/DELETE, so with
`NODE_ENV=production` (forced by both `npm run start` and the Docker image) and
`CORS_ORIGIN` unset (what `.env.example` ships), every write request from the
app's own UI was rejected and answered **500**. Login was impossible through
the documented self-hosting path.

It survived because `curl` sends no `Origin` header, so every manual API check
passed, and because `tests/app.test.js` had **no CORS test at all** despite its
file header claiming to verify "CORS scoping". The suite also runs as
`NODE_ENV=test`, which never reaches the rejecting branch.

Fixed by switching to the request-taking form of `cors()` and comparing the
`Origin` host against `req.headers.host`, plus `APP_URL`'s host for installs
behind a proxy that does not rewrite `Host` (nginx's default `proxy_pass` does
not). See `request-lifecycle.md` for the resolution order and for why this must
not use `req.hostname`. Regression cover is the `CORS` describe block in
`tests/app.test.js`; the two same-origin cases were confirmed to fail against
the old implementation before the fix was kept, both by the author and
independently during adversarial review.

Still true and not addressed: a genuinely disallowed cross-origin request
produces a **500 with an HTML body** rather than a 403, because the rejection
throws before any router and `app.js` mounts no global error handler.

### B13. Document titles are not reachable by keyboard anywhere

On the browse grid, the archives page and the editor's page tree, a document's
title is a click-only element. The accessibility tree for those pages exposes
the surrounding controls (favourite `☆`, comment count, delete `×`, "+ New
Log") but **no actionable node for the document itself**, so the only way to
open a document from any list is a mouse click.

Found while driving the app over CDP for the README screenshots: navigating to
a document required going through the first-run welcome modal, whose "Start
here" link is a real `<a>`, because no list view offered one.

Not investigated: whether the rows are focusable with a `tabIndex` and a key
handler that the accessibility tree simply does not advertise, which would
still be a naming problem, or whether they are plain `<div onClick>`, which
would make them unreachable outright.

## C. Design tensions, not defects

### C1. `canWrite` is evaluated once per collab connection

`collab.js:305`, at session setup. Revoking write access does not take effect
until the user reconnects. Deliberate (re-checking per message would be a query
per keystroke), but worth stating.

### C2. One session row per user

`generateSessionToken` (`mysql_connect.js:109-144`) reuses the existing row, so
signing in on a second device returns the first device's token and `POST
/api/logout` signs out everywhere. The schema does not enforce the one-row
assumption with a unique key on `user_id`.

### C3. Rotating `GITHUB_CLIENT_SECRET` invalidates every stored token

The AES key derives from it via scrypt (`oauth.js:56`). There is no key version
and no re-encryption path; every user must re-link. Fine for a self-hosted
product, worth documenting in the ops runbook.

### C4. Watch rows outlive their resources

`watches` has a FK on `user_id` only (`init.sql:390`); `resource_id` is
polymorphic and unconstrained. Deleting a document orphans its watches. Harmless
(`routes/helpers/activity.js:180-184` bails when the log is gone) but unbounded.

### C5. Watcher fan-out is a sequential await loop

`routes/helpers/activity.js:197-211`, one `createNotification` per watcher, inside a
fire-and-forget promise. Fine at current scale; a heavily-watched archive would
make it slow.

### C6. The `conflict` sync status is unreachable

`github_links.sync_status` is `ENUM('clean','remote_ahead','local_ahead',
'diverged','conflict')` (`init.sql:294`) but `classifySync`
(`github.js:1066-1072`) returns only the first four. Conflicts are expressed as
a 409 response instead. Either the enum value is vestigial or a state was
planned and never wired.

## D. Stale claims in the root `CLAUDE.md`

Corrected in this pass, listed here so the drift pattern is visible:

- **Subsystems missing entirely** from the "Application areas" section:
  notifications, activity log, watches, mentions, GitHub bidirectional sync,
  live code embeds, PR-as-document, squad-to-GitHub-Team sync. Eight of the 25
  tables and roughly a third of the routes were undocumented.
- **`tests/helpers.js` has no `ADMIN_USER`**, contrary to the testing section.
  It exports `TEST_USER`, `TEST_USER_2`, `mockAuthenticated`,
  `mockUnauthenticated`, `resetMocks`.
- **`tests/setup.js` mocks `fs/promises` only partially**, `mkdir` and `unlink`.
  The doc's "filesystem globally" reads as more complete than it is.
- **`useGitHubStatus` is `.jsx`, not `.js`.**
- **The comment "no external job queue"** is accurate in spirit, but
  `server.js:73-89` does run an in-process daily prune, which is a scheduled job
  by another name.

## E. Things not investigated

Honest gaps in this pass, so nobody mistakes silence for a clean bill:

- `src/pages/` beyond routing and the editor's extension stack. `AdminPage.jsx`
  (842 lines), `WorkspacesPage.jsx` (673), `ArchiveBrowser.jsx` (1159) and
  `ExploreBrowser.jsx` (430) were not read line by line.
- `src/index.css`, 8844 lines, not read.
- `seed.sql`, 67 KB of sample data, not audited.
- `routes/avatars.js`, `routes/doc-images.js`, `routes/favorites.js` were read
  only at the route-signature level.
- The `docs/api/*.md` contracts were not diffed against the actual handlers.
  That is the obvious next pass and would likely surface more drift.
- No runtime verification of anything **in this pass**. No app was started, no
  browser opened, no query run against a live database. The test suite was run
  (57 files, 1128 tests, green) but it mocks the database, so it validates
  handler logic and not schema interaction. A later pass (the first-run
  experience work) did run the app against a real database and a real browser
  and produced B8 through B10 above; the rest of this document is still
  static-read-only.

# Open Questions & Suspected Defects

Read this before trusting any single claim in the other maps as gospel.

Most of this was found by **reading the source**, not by running the app
against a live database; each item states what was verified and what was not.
The distinction matters: a static read can prove that no code queries a column,
but it cannot prove what a user sees. B8 through B10 are the exception: they
were found by running the app against a real database in a real browser, and
are marked as such.

This is a findings list, not a changelog. Items that have since been fixed are
marked `(FIXED)` in their heading and kept, because the reasoning that found
them is worth more than the closure.

---

## A. Dead code paths, verified by exhaustive grep

These are the highest-confidence items. Each was checked by grepping the whole
`cloudcodex/` tree (excluding `node_modules`) for every reference.

### A1. `logs.read_access` and `logs.write_access` are write-only

- **Written by:** the PR-session log insert (`routes/github.js:1698`), and
  only as an empty `JSON_ARRAY()`. Until 2026-08-09 the PR-session open also
  `JSON_ARRAY_APPEND`ed the caller's id here, which is what made that feature
  admin-only (B1); the grant now lands on a per-PR archive instead.
- **Read by:** nothing. `checkLogReadAccess` / `checkLogWriteAccess`
  (`routes/helpers/shared.js:56-84`) join `logs` to `archives` and apply the
  access fragment against the **archive** alias.
- **Verified:** grep for `read_access` across `routes/`, `services/`,
  `middleware/` returns only `archives`-scoped reads plus the github.js writes.
- **Not verified:** runtime behaviour.

Same story for `versions.read_access` (`init.sql:316`): declared, never read,
never written.

### A2. `github_embed_refs` has no writer

`GET /api/logs/by-github-ref` (`github.js:1956-1977`) reads the table.
`migrations/p1_github_embeds.sql` and `init.sql:253-267` create it. There is no
`INSERT INTO github_embed_refs` anywhere in the repo.

**Consequence:** the "which documents reference this file / issue / PR"
back-link always returns an empty list. The endpoint's test
(`tests/routes/github.test.js:1818`) passes because `c2_query` is mocked, so the
suite cannot catch this class of gap.

**Open question:** was the writer planned for a later phase, or lost? The
embed nodes (`src/extensions/GitHubCodeEmbed.jsx`,
`GitHubIssueEmbed.jsx`) are the obvious place to record a ref on save.

### A3. `squad_permissions` was enforced by nothing (REMOVED)

Read and written only by `GET`/`PUT /api/squads/:id/permissions`.
`requirePermission` consults the global `permissions` table and then
`squad_members.can_create_*`, never `squad_permissions`. A workspace owner
could toggle squad-level create permissions through the API, the value
persisted, and no behaviour changed.

**Removed 2026-08-09** rather than enforced (Kyle's call): `squad_members`
already carries per-member `can_create_log` / `can_create_archive` flags that
*are* enforced, so this was a second, redundant answer to the same question,
in the repo's most trap-laden subsystem.

Gone: the table (`migrations/drop_squad_permissions.sql` plus the `CREATE` in
`init.sql`, with the `DROP` line kept so `reset-db` still cleans older
databases), both routes, the six tests that covered them, and the two
`util.jsx` wrappers, `fetchSquadPermissions` / `updateSquadPermissions`, which
turned out to have no callers anywhere in `src/`.

## B. Suspected functional defects

Higher-value, lower-certainty. Each needs a runtime check to confirm.

### B1. PR-as-document sessions were admin-only (FIXED)

**Confirmed at runtime**, 2026-08-09, by replicating `getOrCreatePrSession`'s
exact inserts and grant: `logs.read_access` came back `[19]` and that user
still got **403** on `GET` and `POST /api/logs/:logId/comments`, while an admin
got 200. The reading below was correct in every particular.

**A second defect, found while fixing it and not recorded here before:**
`GET .../pulls/:number/session` made **no GitHub call at all**. It took
`owner`, `repo` and `number` from the URL and created a session. That was
harmless only because the grant did nothing; making the grant real without
fixing this would have let any authenticated user with any GitHub account open
a session on a private repo's PR and read the Codex-side discussion. The route
now fetches the PR through the caller's token first.

**Fixed** by option (a) of the two below, per Kyle's call on 2026-08-09: one
hidden archive **per PR** (`__c2_github_pr_sessions__:owner/repo#N`) with the
grant appended to that archive's `read_access`/`write_access`. Per-PR rather
than one shared archive because the archive is the ACL boundary, so a shared
one would have made any session grant access to every other PR's session.
Sessions created earlier are moved into their per-PR archive on next open.
Verified live: the granted user now reads (200) and comments (201), two users
holding different PR sessions each get 403 on the other's, and the admin
control still passes. **A1 is unchanged: `logs.read_access` is still dead**,
and this fix deliberately routes around it rather than reviving it.

Original finding below.

### B1 (original reading). PR-as-document sessions are probably admin-only

`getOrCreatePrSession` granted the caller access by
appending their id to the virtual log's `read_access`/`write_access`. Per **A1**
those columns are inert.

The parent archive was a single `__c2_github_pr_sessions__`, created with
`squad_id NULL`, `created_by NULL`, and every ACL column empty. Walk the seven clauses of `readAccessWhere` against
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

### B2. `html_content TEXT` capped documents at 64 KiB (FIXED)

`logs.html_content` was `TEXT`, i.e. 65,535 bytes, against an application
ceiling of 2 MiB (`documents.js:22`, `collab.js:44`).

**Confirmed at runtime**, 2026-08-09. `sql_mode` on the shipped image (MySQL
8.4.8) does include `STRICT_TRANS_TABLES`, so this is an error, not truncation.
Saving through the real `POST /api/save-document`:

| HTML size | Before |
|---|---|
| 40 KiB | 200, stored |
| 70 KiB | **500** "An internal server error occurred", nothing stored |
| 300 KiB | **500**, nothing stored |

The user's edit is simply lost, behind a generic 500 that names nothing.

**Two columns the original note missed**, both found by looking rather than
reasoning:

- `plain_content` is `STORED GENERATED` from `html_content`, and it was `TEXT`
  too. Stripping tags from prose barely shrinks it (40,993 bytes of HTML gave
  40,986 of text), so widening `html_content` alone would have moved the same
  failure one column sideways.
- `versions.html_content` was `TEXT`, and publish copies the document into it,
  so a widened `logs` would have pushed the same 500 from save to publish.

**Fixed** in `migrations/widen_log_content.sql` plus `init.sql` (both, per the
no-migration-runner rule): all three columns are now `MEDIUMTEXT`. Verified
live after applying it: 40, 70 and 300 KiB all save 200, a 300 KiB publish
returns 200 with `versions.html_content` holding all 307,213 bytes, and the
`ft_logs_search` FULLTEXT index survived the `MODIFY` and still matches.

### B4. GitHub link CRUD did not check document access (FIXED)

`GET`, `PUT` and `DELETE /api/github/link/:logId` validated the id and acted.
They inherit `requireAuth` and `requireGitHub` from the router, but called
neither `loadLinkAndLog` nor any `check*Access` helper.

**Confirmed at runtime**, 2026-08-09, against a real database with two users
sharing no squad and a document the attacker provably could not read (`GET
/api/document` returned 404, and the gated `/status` route returned 404 for the
same log in the same run):

| Route | Before | Effect |
|---|---|---|
| `GET /github/link/:logId` | **200** | returned the private repo, branch and path the document is bound to |
| `PUT /github/link/:logId` | **200** | repointed the binding to an attacker-chosen repo and path; `linked_by` stayed the victim's id, so the audit trail still named them |
| `DELETE /github/link/:logId` | **200** | row gone |

**This map previously said "content cannot be exfiltrated this way". That was
wrong.** `/push` reads `repo_owner`, `repo_name`, `file_path` and `branch`
straight off the `github_links` row and takes only a commit message from the
caller. So an unauthorised `PUT` redirects the *victim's own next push*, which
commits their document content into the attacker's repo using the victim's
token. The four sync routes gating correctly is not sufficient when an
unguarded route decides where they point.

Deleting the row is not merely annoying either: it discards `base_sha`, the
merge base every later conflict check depends on.

**Fixed** by gating `GET` on `checkLogReadAccess` and `PUT`/`DELETE` on
`checkLogWriteAccess` (write, not read, precisely because `PUT` chooses a push
target). All three now 403, verified live on the same fixtures and covered by
three tests that were each confirmed to fail against the unfixed route.

### B5. GitHub team sync silently truncates above 100 members

Both team-sync routes fetched team members with a single `per_page=100`
call and no pagination loop.

**FIXED 2026-08-09.** Both call sites now go through `fetchTeamMemberLogins`,
which follows pagination to a 20-page (2,000 member) cap and reports whether
the listing is `complete`. When it is not, the removal pass is skipped
entirely and `members_complete: false` is returned, because a login on an
unfetched page is indistinguishable from one that left the team. Covered by
two tests: one proves page 2 is read, one proves a truncated listing deletes
nobody. Original finding below.

**Consequence:** a team with more than 100 members yields a partial `ghLogins`
set. The preview under-reports, and the sync's removal pass
then deleted every current member whose login fell outside
the first page.

**Not verified:** no team of that size has been tested.

**Suggested fix:** paginate, or refuse to run the removal pass when the response
is a full page.

### B6. `title` was the only WS message not gated on write access (FIXED)

The `{type:'title'}` handler in `collab.js` had no `canWrite` check, unlike
`cursor`, `save`, `publish` and `comment`.

**Confirmed at runtime**, 2026-08-09, with a squad member holding
`can_read = TRUE, can_write = FALSE`. The server itself sent
`sync { canWrite: false }`, correctly ignored a `save` in the same session, and
then honoured the rename: the title became "PWNED BY A READ-ONLY USER",
`updated_by` was set to the read-only user, and one `log.rename` row landed in
`activity_log`.

**This was a live hole, not defence-in-depth.** The earlier note wondered
whether the client exposes the affordance; that question does not matter, since
the message is reachable from any WebSocket client. And the activity row is the
sharper end of it: `logActivity` auto-enrols the actor as a watcher and emails
every other watcher, so a read-only user could rename a document *and* send
mail about it to everyone watching.

**Fixed** by adding `canWrite` to the branch condition. Re-verified on the same
fixtures: title unchanged, `updated_by` still NULL, zero `log.rename` rows. The
collab suite had no read-only coverage at all, which is why this survived; it
now has a `readOnlyClient` helper and a test that fails against the unfixed
service.

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

**FIXED 2026-08-09**, minimally: the direct send now calls `getPrefs()` and
honours `email_squad_invite`. The invitation itself, and the inbox
notification, are unaffected.

The larger option was to give `squad_invite` a builder in
`email-templates.js` and let the funnel own the send, which is what the rest
of the notification types do. It was not taken here: the route deliberately
sends its own mail and passes `emailData: null` so the funnel does not send a
second copy, and rerouting it would change the send's timing and content for
a defect whose whole substance was "the toggle does nothing". Worth revisiting
if a second such bypass appears.

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
(`github.js:1085-1091`) returns only the first four. Conflicts are expressed as
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

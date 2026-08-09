# GitHub Integration Map

`routes/github.js` is 2263 lines and about 45 endpoints, the largest single file
in the backend. It grew in four labelled phases (`P0` sync, `P1` embeds,
`P2` PR-as-document, `P3` CI and team sync) whose section banners are still in
the file, and it is the most volatile file in the repo, so anchor on route paths
and function names rather than line numbers.

The core stance: **live API proxy, no webhooks, no background sync, no mirror.**
Every GitHub read is a request made in the user's name with the user's token at
the moment they ask.

---

## 1. Auth and the `req.gh` helper

Tokens are stored encrypted in `oauth_accounts.encrypted_token`. The crypto
lives in `routes/oauth.js:48-81`:

- AES-256-GCM, 12-byte IV, 16-byte auth tag.
- The key is `scryptSync(GITHUB_CLIENT_SECRET, 'cloudcodex-oauth-token', 32)`
  (`oauth.js:56`). **Rotating `GITHUB_CLIENT_SECRET` renders every stored token
  undecryptable**; there is no key-version field and no re-encryption path.
  Every user has to re-link.
- Stored as `ivHex:tagHex:ciphertextHex` (`oauth.js:67`).
- `encryptToken`/`decryptToken` return `null` when the secret is unset, which is
  how the app degrades gracefully with GitHub unconfigured.

`requireGitHub` (`github.js:111-122`) decrypts the caller's token, 403s with a
"link your GitHub account" message when absent, and attaches
`req.gh(path, options)`, a closure over `githubFetch` that also forwards
`req.user.id`.

`router.use('/github', requireAuth, asyncHandler(requireGitHub))`
(`github.js:125`) applies that to every `/api/github/*` route. Note the two
routes that live **outside** the `/github` prefix,
`/api/logs/by-github-ref` (`github.js:1919`) and the two
`/api/squads/:squadId/github-team/*` routes (`github.js:2104`,
`github.js:2182`), which therefore attach `requireAuth` and `requireGitHub`
individually.

### Token revocation detection

`githubFetch` (`github.js:70-104`) inspects failures. On a 401, or a 403 whose
message mentions credentials, it fire-and-forgets
`UPDATE oauth_accounts SET token_status = 'revoked'` (`github.js:88-95`). The
message check matters: GitHub also returns 403 for rate limits and missing
scopes, and flipping the status on those would produce spurious "re-link your
account" prompts. The frontend reads this through
`GET /api/github/status` (`oauth.js:567`) and the `useGitHubStatus` hook, which
is what hides GitHub UI affordances for unlinked users.

### This router does NOT use the shared error handler

`github.js:2273-2280` installs its own terminal handler that forwards
`err.status` when it is a plausible 4xx/5xx and prefers `err.ghBody.message`,
so GitHub's own wording reaches the client. `githubFetch` is what attaches
`.status` and `.ghBody` (`github.js:97-100`).

**Do not replace this with `errorHandler` from `shared.js`.** That handler
hardcodes 500, so every "file not found on that branch" and every rate-limit
response would become an opaque server error.

## 2. Document to file linking

`github_links` (`init.sql:283-302`) is `UNIQUE (log_id)`, so a document links to
at most one file. Columns that carry the sync state: `file_sha` (last observed
remote blob sha), `base_sha` (the merge base), `last_pulled_at`,
`last_pushed_at`, `sync_status`.

Three plain CRUD routes: `GET`, `PUT`, `DELETE /api/github/link/:logId`
(`github.js:927`, `958`, `990`). The `PUT` is an upsert keyed on the unique
`log_id`, setting `base_sha = file_sha` at link time.

**All three check log access**: `GET` needs read, `PUT` and `DELETE` need
**write**, because the row `PUT` writes is where `/push` reads its target repo,
branch and path from. Until 2026-08-09 they checked nothing at all beyond
`requireAuth` plus `requireGitHub`, which is B4 in
[open-questions.md](open-questions.md) and was live-confirmed before the fix.
The four sync routes below go through `loadLinkAndLog`
(`github.js:1012-1028`), which applies the same fragments.

### The sync state machine

`classifySync({ remoteSha, baseSha, localChanged })` (`github.js:1085-1091`):

```
remoteChanged = remoteSha && baseSha && remoteSha !== baseSha
localChanged  = log.updated_at > max(last_pulled_at, last_pushed_at)

  !remote && !local  ->  clean
   remote && !local  ->  remote_ahead
  !remote &&  local  ->  local_ahead
   remote &&  local  ->  diverged
```

The schema's `sync_status` enum also has `conflict` (`init.sql:294`), which
`classifySync` never returns; it exists for a manual-resolution state that the
current code expresses as a 409 response instead.

Two heuristics to know about:

- **`localChanged` is deliberately conservative** (`github.js:1113-1121`). It
  compares `logs.updated_at` against the last sync, and `updated_at` is bumped
  by CRDT autosaves too, so idle-but-open documents drift to `local_ahead`. The
  code notes this: a false positive only offers a Pull the user does not need.
- **A link that has never been pulled or pushed reports `localChanged = false`**
  (`lastSyncTs === 0` short-circuit, `github.js:1121`).

`GET /api/github/link/:logId/status` (`github.js:1098`) also *persists* what it
observed into `file_sha` and `sync_status` as a fire-and-forget write
(`github.js:1128-1133`), so sidebars and banners can read cached state without
re-hitting GitHub.

### Pull (`github.js:1158`)

Three strategies, validated against an allow-list (`github.js:1165`):

| Strategy | Behaviour |
|---|---|
| `overwrite_local` | remote markdown rendered to HTML, written over the doc, `ydoc_state = NULL`, both shas advanced, `sync_status = 'clean'` |
| `merge` | fetch the base blob by `base_sha`, run `diff3Merge(local, base, remote)`; conflict yields **409** with `conflicts`, `merged_with_markers`, `ours`, `theirs`; success writes the merged doc |
| `preview` | identical merge computation, returns `merged_markdown`, writes nothing |

`diff3Merge` is local, in `src/lib/githubDiff.js:122` (an LCS-based three-way
merge, no external dependency). It is one of the few backend modules imported
from `src/`.

Every write path here nulls `ydoc_state` (`github.js:1184`, `1226`, `1408`) so
live editors re-initialise their CRDT from the new HTML. That is mandatory for
any external content writer; see
[documents-and-collab.md](documents-and-collab.md).

All three write paths also call `broadcastToDoc(logId, {type:'github-pulled'})`
(`github.js:1193`, `1235`, `1417`) to tell open editors.

### Push (`github.js:1247`)

`branch_strategy: 'direct'` commits straight to the linked branch using
`base_sha` as the parent. `'pr'` first creates `codex/<slug>-<base36 time>` off
the linked branch (`github.js:1280-1294`), pushes there, then opens a PR.

On a GitHub 409 or 422, meaning the remote moved between the status check and
the push, it flips `sync_status = 'diverged'` and returns 409 with a
"pull first" message (`github.js:1317-1332`).

Sha bookkeeping differs by strategy (`github.js:1351-1365`): a direct push
advances both `file_sha` and `base_sha`; a PR push advances only `base_sha`,
because the linked branch on disk is unchanged.

The content pushed is `localMarkdown(row)` (`github.js:1035-1043`), which
**prefers `markdown_content` over `html_content`**. A document edited in
rich-text mode sets `markdown_content` to `null`, at which point the HTML is
round-tripped through turndown; a document with a stale `markdown_content`
pushes the stale markdown.

### Resolve (`github.js:1384`)

Persists a user-merged markdown after a conflict. Guards on the client's
`base_sha` matching the stored one (409 if the base moved underneath), writes
the doc, and sets `sync_status = 'local_ahead'`, since the user still has to
push.

## 3. Live code embeds (P1)

`GET /api/github/embed/code` (`github.js:1466`) serves the Tiptap
`GitHubCodeEmbed` node. It fetches the file, optionally slices a line range, and
returns content plus a `language` guess from `EXT_TO_LANG`
(`github.js:1424-1438`).

The response is cached in a module-level LRU capped at 500 entries
(`github.js:1444-1459`), **keyed by `${req.user.id}:${owner}:${repo}:${ref}:${path}`**
(`github.js:1475`). The user id in the key is the point: private-repo content
must never leak across users through a shared cache. Any change to that key
must keep the user id.

The cache stores the *full* file and slices per request, so two embeds of
different ranges in the same file cost one fetch.

There is a second, separate TTL cache for CI and release reads,
`ciCache`, 60 seconds, 200 entries (`github.js:1944-1967`).

### The dead back-link table

`github_embed_refs` (`init.sql:253-267`, created by
`migrations/p1_github_embeds.sql`) is intended to answer "which documents embed
this file / issue / PR". `GET /api/logs/by-github-ref` (`github.js:1919`) reads
it, correctly gated by the read fragment.

**Nothing writes it.** There is no `INSERT INTO github_embed_refs` anywhere in
the repo. The endpoint therefore always returns an empty list in practice, and
its test (`tests/routes/github.test.js:1818`) passes because the DB is mocked.
Recorded in [open-questions.md](open-questions.md).

## 4. Archive as repo (P1)

`archive_repos` (`init.sql:213-228`) binds an archive to a repo, with a
`docs_path` prefix (default `docs`) and `auto_link_imports`. Managed through
`GET`/`POST`/`DELETE /api/archives/:archiveId/repos` (`archives.js:556`, `589`,
`638`), all gated by `isArchiveOwner`.

`bulkImportArchiveRepo` (`github.js:1521-1616`) backs **both**
`POST .../import` and `POST .../refresh` (`github.js:1618-1619`); they are the
same handler. It walks the tree recursively, keeps only markdown blobs under the
prefix (`listMarkdownFilesUnder`, `github.js:1523-1535`), skips paths already
linked, and creates a log plus a `github_links` row per new file. It yields to
the event loop between chunks with `await new Promise(r => setImmediate(r))`
(`github.js:1612`) so a large repo does not block the single process.

Because already-linked files are reported as `skipped` rather than re-fetched,
`/refresh` is a no-op on a fully-synced archive: it imports newly-added files
only, and does not pull content changes into existing docs.

## 5. PR as document (P2)

The cleverest and most fragile part. A pull request gets a **virtual log** so
the existing comment routes and collab WebSocket work on it unchanged.

`ensureSystemArchive` (`github.js:1631-1647`) find-or-creates a single global
archive named `__c2_github_pr_sessions__` with `system = TRUE`, `squad_id NULL`,
`created_by NULL`, and every ACL empty. `archives.system` exists precisely so
this row can be filtered out of normal archive listings.

`getOrCreatePrSession` (`github.js:1655-1701`) then creates a log in it, records
a `github_pr_sessions` row (unique on owner+repo+pr_number), and appends the
caller's id to the **log's** `read_access` and `write_access` JSON arrays
(`github.js:1688-1698`).

**That last step grants nothing.** As established in
[access-control.md](access-control.md), `checkLogReadAccess` resolves against
the parent *archive*, and `logs.read_access` is read by no query in the codebase.
The system archive has empty ACLs, a NULL creator, and no squad, so only
`is_admin` satisfies the fragment. The comment routes on a PR-session log should
therefore 403 for every non-admin. This is flagged in
[open-questions.md](open-questions.md) as a suspected defect, not runtime
verified.

The rest of the PR surface (`github.js:1724-1819`) proxies review comments,
review submission, and issue search straight through, with no local mirror.

## 6. Squad to GitHub Team sync (P3)

`squads.github_org` / `github_team_slug` / `team_sync_at`
(`init.sql:129-131`, unique on the org+slug pair) bind a squad to a GitHub Team.

`GET /api/squads/:squadId/github-team/preview` (`github.js:2104`) and
`POST .../sync` (`github.js:2182`), both behind `userCanManageSquad`.

Identity matching is `LOWER(oauth_accounts.provider_username)` against the
GitHub login (`github.js:2156`, `github.js:2227`), so **a Codex user who has not
linked GitHub is invisible to sync** and appears in the `unmatched` list.

Adds insert with `role='member', can_read=TRUE, can_write=FALSE` and
`ON DUPLICATE KEY UPDATE can_read = TRUE` (`github.js:2237-2239`). Removals skip
anyone with `role = 'owner'` (`github.js:2251-2256`) so a bootstrapping admin
cannot lock themselves out.

Sync is **manual and one-directional**: GitHub is the source, Codex is the
target, and nothing runs it on a schedule. `team_sync_at` records the last run.
Membership fetch goes through `fetchTeamMemberLogins`, which follows
pagination to a 20-page (2,000 member) cap and returns
`{ logins, complete }`. **A truncated listing disables removals**, in both the
preview and the sync, and surfaces as `members_complete: false` in the
response: a login on a page that was never fetched looks exactly like a member
who left, and the removal pass deletes them. Until 2026-08-09 the fetch was a
single `per_page=100` call with no loop, so a team over 100 members silently
under-reported and the sync deleted the overflow (B5 in
[open-questions.md](open-questions.md)).

## 7. Frontend surface

`src/pages/GitHubPage.jsx` (2631 lines) is the repo browser. It carries the
repo's only load-bearing `eslint-disable` lines for `react-hooks/exhaustive-deps`
and a legacy `no-alert` disable; both are deliberate, leave them.

The API wrappers all live in `src/util.jsx:132-180`. `useGitHubStatus.jsx` gates
UI on whether the user has linked an account; `useGitHubLink.js` drives the
per-document sync banner (`GitHubSyncBanner.jsx`) and merge dialog
(`GitHubMergeDialog.jsx`). Picker modals live under `src/components/github/`.

---

## Related

- [access-control.md](access-control.md) for why the PR-session ACL write is
  inert.
- [documents-and-collab.md](documents-and-collab.md) for the `ydoc_state = NULL`
  contract every writer here obeys.
- [data-model.md](data-model.md) for the five GitHub tables.

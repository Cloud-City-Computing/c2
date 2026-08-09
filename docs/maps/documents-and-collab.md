# Documents & Collaborative Editing Map

The dual-state storage model, the Yjs WebSocket protocol, and every path that
can write a document's content. This is the subsystem where "it looked right in
the editor" and "it is right in the database" most easily diverge.

---

## 1. Dual-state storage

A `logs` row carries **three** representations of the same document, plus one
generated column:

| Column | Type | Written by | Read by |
|---|---|---|---|
| `html_content` | `TEXT` | REST save, publish, restore, explicit WS save, GitHub pull | everything: rendering, export, search (via generated column), GitHub push |
| `markdown_content` | `MEDIUMTEXT` | REST save when the client sends it, WS save, GitHub pull/resolve/import | GitHub push (`github.js:1035-1043`), markdown-mode editing |
| `ydoc_state` | `LONGBLOB` | collab autosave and explicit save (`collab.js:114-118`) | collab session restore only (`collab.js:69-76`) |
| `plain_content` | generated `STORED` | MySQL, from `html_content` (`init.sql:237`) | the FULLTEXT index |

`plain_content` is `REGEXP_REPLACE(html_content, '<[^>]+>', '')`, computed by
MySQL on every write of `html_content`. It is the *only* thing search matches on
besides the title, which means **a document edited only over the CRDT is not
searchable until an explicit save writes `html_content`.**

### The invariant, and where it breaks

The intended invariant is that `html_content` and `ydoc_state` describe the same
document. It is maintained by convention, not enforced. The debounced autosave
is explicit about this (`collab.js:106-108`):

> HTML is NOT updated here. Clients send HTML during explicit save/publish.

So a 3-second-debounce autosave writes **only** the blob. Between autosave and
the next explicit save, `html_content` is stale, and every consumer of
`html_content` sees the older document: search, all four export formats,
GitHub push, and the version snapshot taken by REST publish
(`documents.js:196`, which reads `pg.html_content` straight from the row).

**`markdown_content` semantics:** `undefined` leaves the column untouched, an
explicit `null` clears it, a string replaces it (`documents.js:113-124`,
`collab.js:453`). Rich-text-mode saves send `null` to signal "HTML is now the
canonical source"; markdown-mode saves send the raw markdown. `localMarkdown()`
in the GitHub path (`github.js:1035-1043`) prefers `markdown_content` when
non-empty and otherwise round-trips the HTML through turndown, so a stale
`markdown_content` silently wins over fresher HTML on push.

### Every writer of document content

| Path | Writes | Clears `ydoc_state`? |
|---|---|---|
| `POST /api/save-document` (`documents.js:77`) | `html_content`, optionally `markdown_content` | no |
| `POST /api/document/:logId/publish` (`documents.js:155`) | `version`, `versions` row from existing `html_content` | no |
| `POST .../versions/:versionId/restore` (`documents.js:404`) | `html_content`, `version`, new `versions` row | **yes**, `NULL` (`documents.js:437`) |
| WS `{type:'save'}` (`collab.js:437-501`) | `html_content` if changed, `markdown_content`, `ydoc_state` | no |
| WS `{type:'publish'}` (`collab.js:531-604`) | `html_content`, `ydoc_state`, `version`, `versions` row | no |
| WS `{type:'title'}` (`collab.js:506-529`) | `title` only | no |
| collab autosave (`collab.js:110-123`) | `ydoc_state` only | no |
| GitHub pull / resolve / overwrite (`github.js:1183-1192`, `1225-1234`, `1407-1416`) | `html_content`, `markdown_content` | **yes**, `NULL` |
| GitHub bulk import (`github.js:1597-1606`) | new `logs` row | n/a |
| First-boot seed (`bootstrapInstance`, `routes/admin.js`) | new `logs` row, the welcome document | n/a |

Clearing `ydoc_state` to `NULL` is the deliberate mechanism for "the HTML just
changed underneath the CRDT": on next connect the Y.Doc starts empty and the
first client's Tiptap `Collaboration` extension re-initialises it from the
REST-loaded HTML (`collab.js:77-79`). Any external writer of `html_content`
**must** null the blob or live editors will keep resurrecting the old content.
`POST /api/save-document` notably does not, which is correct only because it is
the editor's own save path.

## 2. The collab WebSocket

`services/collab.js`. One `Map` of `logId -> entry` (`collab.js:36`), where an
entry is `{ doc, conns, saveTimer, cleanupTimer, lastSavedHtml, logId }`
(`collab.js:59-66`).

### Constants (`collab.js:41-47`)

```
SAVE_DEBOUNCE_MS         3000     autosave debounce after any Y.Doc mutation
CLEANUP_DELAY_MS        30000     drop the in-memory doc this long after the last close
MAX_MESSAGE_SIZE      5 MiB       ws maxPayload
MAX_HTML_SIZE         2 MiB       largest HTML accepted in a save/publish message
MAX_CONNECTIONS_PER_USER  10      across all documents, tracked in userConnectionCounts
RATE_LIMIT_WINDOW_MS     1000     per-connection
RATE_LIMIT_MAX_MESSAGES    60     per window, applies to binary and text alike
```

### Session setup

`setupDocSession` (`collab.js:316-650`) runs after auth succeeds:

1. `getOrCreateDoc(logId)` (`collab.js:55-103`) loads `ydoc_state` and applies it
   to a fresh `Y.Doc`, and caches `html_content` into `entry.lastSavedHtml`.
2. Cancels any pending cleanup timer (`collab.js:327-330`).
3. Assigns a cursor colour round-robin from a 10-entry palette
   (`collab.js:173-183`). `colorIndex` is a module global, so colours are
   assigned per-connection in arrival order, never per-user.
4. Sends **sync step 1** then **sync step 2** immediately
   (`collab.js:344-354`). Step 2 is proactive so a joining client gets content
   without a round trip.
5. Sends a JSON `{type:'sync', canWrite, user}` frame carrying permissions and
   identity. **No HTML travels over this frame**, despite the older protocol
   comment at `collab.js:191` saying it does. The doc arrives as binary CRDT
   state.
6. Broadcasts awareness to everyone.

`canWrite` is computed once at connect time (`collab.js:305`) and never
re-checked. Revoking someone's write access does not take effect until they
reconnect.

### Message taxonomy

Binary frames are Yjs sync protocol; text frames are JSON. The JSON `type` is
allow-listed to exactly five values (`collab.js:408-410`):

| Type | Gate | Effect |
|---|---|---|
| `cursor` | `canWrite` | position is validated and coerced to safe integers (`collab.js:414-425`), then broadcast to others |
| `save` | `canWrite` | immediate save, see below |
| `publish` | `canWrite` | permission-checked snapshot, see below |
| `comment` | `canWrite` | relays only ids, never content (`collab.js:609-623`); the actual CRUD is REST |
| `title` | `canWrite` | updates `logs.title`, broadcasts, and logs `log.rename` |

All five are gated the same way. `title` was the exception until 2026-08-09
(B6 in `open-questions.md`): a read-only participant could rename the document,
and the `log.rename` activity that followed also mailed every watcher.

`comment` broadcasts are id-only by design: the receiving
client refetches over REST, which keeps the WS from becoming a second
authorisation surface for comment content.

Binary frames are dropped outright for read-only clients (`collab.js:383`).
Updates are echoed to every peer except the origin, using the sender's `ws` as
the Yjs transaction origin (`collab.js:88-99`, `collab.js:389`), which is what
prevents an echo loop.

### Save (`collab.js:437-501`)

Cancels the debounce, encodes the CRDT state, sanitises the client HTML through
`sanitizeHtml` then `extractImagesFromHtml`, and writes. It only writes
`html_content` when the HTML actually changed against `entry.lastSavedHtml`
(`collab.js:456`); otherwise it writes the blob alone. On an HTML change it then
runs `processMentionsOnSave` and `logActivity('log.update')`
(`collab.js:478-496`).

### Publish (`collab.js:531-604`)

Loads the log's squad context, calls the shared `canPublish`
(`collab.js:547`), bumps `logs.version`, writes HTML plus blob plus version,
inserts the `versions` row, fires mentions and `log.publish` activity, then
broadcasts `{type:'published', version, title}` to **all** connections including
the publisher. Title is capped at 255 chars, notes at 5000
(`collab.js:533-534`).

### Lifecycle and teardown

On close (`collab.js:626-641`): drop the connection, decrement the per-user
count, rebroadcast awareness, and if this was the last connection schedule both
a final save and cleanup. Cleanup after 30s destroys the `Y.Doc` and removes the
map entry, but only if no one reconnected (`collab.js:128-137`).

**All of this is per-process, in-memory.** Restarting the server drops every
in-memory doc; state survives only through `ydoc_state`, which is at most 3
seconds stale. This is the load-bearing reason the single-process architecture
is not negotiable: a second replica would maintain a second, divergent `Y.Doc`
for the same log.

### The REST side-channel

`broadcastToDoc(logId, message)` (`collab.js:660-668`) lets REST handlers push
arbitrary JSON to live editors without going through Yjs. Its only current
callers are the GitHub pull and resolve routes, which emit
`{type:'github-pulled', ...}` (`github.js:1193`, `1235`, `1417`). It returns
`false` when no one has the doc open.

Three read-only accessors feed the admin and presence surfaces:
`getActiveDocCount` (`collab.js:673`), `getActiveUsers(logId)`
(`collab.js:680`), `getAllPresence()` (`collab.js:693`).

## 3. Versions

`versions` rows are snapshots of `html_content` with an optional title and
release notes (`init.sql:304-319`). Four operations:

- **Publish** bumps `logs.version` and inserts a row. Two entry points, REST
  (`documents.js:155`) and WS (`collab.js:531`), sharing `canPublish`.
- **List / fetch** (`documents.js:328`, `documents.js:364`) behind read access.
- **Restore** (`documents.js:404`) writes the old HTML back as a *new* version,
  so history is append-only and nothing is lost. It nulls `ydoc_state`.
- **Delete** (`documents.js:472`) allows admin or the version's own author
  first, then falls back to `squad_members.can_delete_version` or squad
  `role = 'owner'`.

The publish route also accepts `create_github_release`, `target_repo`, and
`tag_name` (`documents.js:161`), tying a version to a GitHub Release through
`versions.github_release_id` / `github_tag_name` / `github_target_repo`.

## 4. The editor

`src/pages/Editor.jsx` (1516 lines) is the client. The Tiptap extension stack
is assembled at `Editor.jsx:424-445`:

`StarterKit` with `codeBlock`, `underline` and `undoRedo` disabled
(`Editor.jsx:425`, undo/redo because the `Collaboration` extension supplies its
own CRDT-aware history), plus `ResizableImage`, `Placeholder`, `Underline`,
`TextAlign`, `Link`, the four table extensions, `CodeBlockWithLanguage`
(lowlight), `DrawioBlock`, `GitHubCodeEmbed`, `GitHubIssueEmbed`, `Mention`,
and `Collaboration.configure({ document: ydoc })`.

Initial content is deliberately empty (`Editor.jsx:445-446`); the
`Collaboration` extension populates the editor from the shared Y.Doc. Its
`onUpdate` fires for **both** local and remote changes (`Editor.jsx:476-479`),
which is why state updates there are deferred rather than applied inline.

`useCollab(logId, onRemoteUpdate, onRemoteComment, onPublished, onRemoteTitle)`
(`src/hooks/useCollab.js:30`) owns the socket: it memoises the `Y.Doc`
(`useCollab.js:48`), connects to `${proto}//${host}/collab?logId=${logId}`
(`useCollab.js:70-71`), sets `binaryType = 'arraybuffer'`, sends the auth frame
on open (`useCollab.js:102`), queues local updates until the server's sync step
completes and flushes them afterwards (`useCollab.js:82`, `useCollab.js:125-128`),
and auto-reconnects on close. It exposes `sendCursor`, `sendSave`, `sendPublish`,
`sendTitle`, `sendCommentEvent`. `sendPublish` waits for the `published` frame
with a 10-second timeout (`useCollab.js:257`).

Mobile visitors are redirected away from `/editor/:logId` entirely by
`MobileEditorGuard` (`src/App.jsx:43-47`); on mobile, documents are view-only
through the archive view.

---

## Related

- [access-control.md](access-control.md) for what `canWrite` at
  `collab.js:305` actually resolves.
- [notifications-and-activity.md](notifications-and-activity.md) for
  `processMentionsOnSave` and `logActivity`, called from every save path here.
- [github-integration.md](github-integration.md) for the pull/push paths that
  write `html_content` from outside the editor.

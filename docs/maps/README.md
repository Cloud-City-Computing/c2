# Cloud Codex architecture maps

Dense, `file:line`-cited deep maps of the Cloud Codex codebase, written for an
agent (or a human) about to change something and needing the real wiring rather
than the marketing shape of it.

**These are not the same thing as `docs/*.md`.** That tree is the human-facing
product documentation: what the features are, how to deploy, what the API
contracts look like. This tree is the mechanism layer: which function actually
decides, which column is actually read, which invariant will actually bite. When
the two disagree, the maps are the ones citing lines, but both can rot, so
verify before trusting either.

| Map | When you need it |
|---|---|
| [request-lifecycle.md](request-lifecycle.md) | Boot order, the middleware stack in mount order, how `requireAuth` resolves a session, the two WebSocket upgrade paths, the per-router error-handler pattern, rate limiters. |
| [access-control.md](access-control.md) | **Read before touching any permission code.** The 7-clause `readAccessWhere`/`writeAccessWhere` fragments, their fixed param arity, the four *other* permission systems that exist alongside them, and why `logs.read_access` is a write-only column. |
| [documents-and-collab.md](documents-and-collab.md) | Dual-state storage (`html_content` vs `ydoc_state`), the Yjs binary sync protocol, the JSON side-channel message taxonomy, the debounce/cleanup timers, save vs publish, presence. |
| [github-integration.md](github-integration.md) | Token encryption and the `req.gh` helper, the 5-state sync machine, pull/push/resolve with diff3, live code embeds, PR-as-document sessions, squad to GitHub-Team sync, and the error handler this router does *not* share. |
| [notifications-and-activity.md](notifications-and-activity.md) | The activity taxonomy, auto-watch rules, watcher fan-out, the notification funnel with its two independent coalescing windows, email preference resolution, the user-scoped WebSocket. |
| [data-model.md](data-model.md) | All 25 tables, the ACL column families, the generated `plain_content` column that powers FULLTEXT, cascade behaviour, and the `init.sql` vs `migrations/` contract. |
| [frontend-architecture.md](frontend-architecture.md) | Route table and lazy-chunk boundaries, the `util.jsx` API layer, the six hooks, the Tiptap extension stack, preference plumbing, and the Vite `manualChunks` strategy. |
| [build-test-and-ops.md](build-test-and-ops.md) | The dual-root quirk, npm scripts, the Docker topologies, `start.sh`, the Vitest two-project setup and every per-glob coverage threshold, CI. |
| [open-questions.md](open-questions.md) | **Read before trusting a single citation as gospel.** What is unverified, what looks like a defect, what the root `CLAUDE.md` says that the code does not. |

## How to use these

Pick the map for the area, read its section, then go to the cited line. The
durable anchor is always the **named function, route, constant, or column**,
never the `:line`, which drifts. Every map's citations were checked against the
source at the time of writing; the volatile files are `routes/github.js` (2263
lines and the most actively extended), `src/pages/Editor.jsx`, and
`src/pages/GitHubPage.jsx`.

When a finding grows past a line or two, it belongs in the right map here rather
than in the root `CLAUDE.md`, which is meant to stay an orientation surface.

## The five things most likely to bite you

Each is expanded in the map named after it.

1. **Access checks resolve against the *archive*, never the log.** `logs.read_access`
   and `logs.write_access` exist, are written by one code path, and are read by
   nothing. See [access-control.md](access-control.md).
2. **`html_content` and `ydoc_state` are two independent stores** that only
   converge on an explicit save or publish. A CRDT autosave writes the blob and
   not the HTML, so search, export, and GitHub push can all trail live content.
   See [documents-and-collab.md](documents-and-collab.md).
3. **`routes/github.js` does not use the shared `errorHandler`.** It ships its
   own terminal handler that forwards upstream GitHub status codes and messages.
   Adding `errorHandler` there would flatten every 404 into a 500.
   See [github-integration.md](github-integration.md).
4. **`init.sql` only ever runs on a fresh MySQL volume.** Docker mounts it into
   `docker-entrypoint-initdb.d`, which is skipped when the data directory is
   already populated. Schema changes need both a `migrations/` file and an
   `init.sql` edit, and existing dev databases need the migration applied by
   hand. See [data-model.md](data-model.md).
5. **Coverage thresholds are per-glob and CI runs them.** Adding an untested
   branch to a well-covered file can fail the build even when every test passes.
   See [build-test-and-ops.md](build-test-and-ops.md).

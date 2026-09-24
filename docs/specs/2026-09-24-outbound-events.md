# Outbound events track: Cloud Codex emits, and Cloud Command is one subscriber

Agreed 2026-09-24. Every `file:line` claim below was re-derived against `origin/main` `91493a6`.
Every PR in this track re-derives the anchors it touches at the then-current `main` before
editing.

- **Track:** Wave 6 suite, outbound events. Sessions W6-CDX-12 to W6-CDX-16. This document is
  W6-CDX-11. The live-MySQL test project, W6-CDX-10, is a precondition; it is specified in
  [`2026-09-24-suite-identity.md`](2026-09-24-suite-identity.md) and runs first.
- **Plan:** [`../plans/2026-09-24-outbound-events.md`](../plans/2026-09-24-outbound-events.md)
- **Requested by:** Kyle, in the 2026-09-24 decisions recorded in the Cloud Command ADR
  `wave-6-is-one-sign-in-events-and-a-shared-shell.md` (a private repository; what binds this
  spec is restated here).

## Why this spec exists

Kyle's decision for Wave 6: **Cloud Codex emits events that Cloud Command consumes, so a change to
a document is reflected on the tasks that link it.** Today Cloud Command caches each linked
document's title and archive, and refreshes a title only when the cached one is blank. A renamed
document keeps its old title on every task forever, and a deleted document keeps a chip that
looks live. Only Cloud Codex knows either happened.

What Cloud Command does with the events is Kyle's decision D-P (2026-09-24, second round), stated
here because it is why `log.delete`, `archive.delete` and the actor are in v1: a deleted linked
document stays on its task as a struck "Deleted in Codex" chip with an Unlink action, rather than
disappearing, and linked-document activity shows on the task, on its saga and in the workspace's
Activity feed. None of that changes the contract below; it is all the receiver's.

The capability is built as **a general, open-source outbound webhook subsystem**, off by default,
with Cloud Command as one subscriber. An install with no subscription writes nothing new and
sends nothing. The contract never names the suite, so any self-hoster can point it at their own
receiver.

Every Command workspace maps to exactly one Codex instance, and Command mints the id that names
that instance and the secret that signs its events. Nothing here needs Codex to know that id: it
travels inside the receiver URL the operator configures, and the per-instance secret
authenticates the body.

## Current behaviour, the starting point

**The funnel exists.** `logActivity` (`cloudcodex/routes/helpers/activity.js:50-56`) is
fire-and-forget. `doLogActivity` resolves the workspace when the caller did not pass one
(`activity.js:62-68`), coalesces `log.update` per user per document over 5 minutes
(`activity.js:70-82`), inserts the `activity_log` row (`activity.js:85-90`), then auto-watches
and fans out to watchers (`activity.js:91-92`). There are 22 call sites and 19 distinct actions.
Adding a call site starts emailing watchers only for the actions in `WATCH_NOTIFICATION_TYPE`
and `AUTO_WATCH_RULES` (`activity.js:24-36`).

**Where each document change happens, and what it records today:**

| Change | Path | Activity today |
|---|---|---|
| Rename | `PUT /api/document/:logId/title` (`routes/documents.js:283-322`), capped at 255 (`:293`) | `log.rename` |
| Rename | the collab `title` message (`services/collab.js:506-529`) | `log.rename` |
| Rename or re-parent | `PUT /api/archives/:archiveId/logs/:logId` (`routes/archives.js:529-570`) | **none**, and no length cap |
| Delete one document | `DELETE /api/archives/:archiveId/logs/:logId` (`archives.js:576-606`) | `log.delete` |
| Delete an archive | `DELETE /api/archives/:id` (`archives.js:192-211`) | **none reaches the table** |
| Save | `POST /api/save-document` (`documents.js:138`), the collab explicit save (`collab.js:488-494`) | `log.update` |
| Publish | `documents.js:261`, `collab.js:587-593` | `log.publish` |
| Restore a version | `documents.js:457` | `log.restore` |
| CRDT autosave | `collab.js:110-122` writes only `ydoc_state` | none |
| GitHub pull | `routes/github.js:1200`, `:1242`, `:1424` rewrite `html_content` | none |

Three of those are gaps at the source, not webhook questions:

- **`archive.delete` is never recorded.** The route deletes the row (`archives.js:201`) and then
  calls `logActivity` without a workspace (`archives.js:203-208`); `resolveScope` finds nothing
  and `doLogActivity` returns early (`activity.js:62-66`).
- **The tree route renames and moves silently.** `ActivityItem.jsx:27` already renders `log.move`,
  but nothing emits it.
- **A stale comment.** `collab.js:503-505` says a rename "emails every other watcher". It does
  not: `log.rename` is in neither `WATCH_NOTIFICATION_TYPE` nor `AUTO_WATCH_RULES`.

**What does not change a link's truth.** Deleting one document promotes its children rather than
deleting them (`logs.parent_id ... ON DELETE SET NULL`, `init.sql:283`), so the route comment
"cascades children" (`archives.js:574`) is wrong. An archive delete cascades to every document
in it (`init.sql:282`). Squad and workspace deletes only detach archives
(`archives.squad_id ... ON DELETE SET NULL`, `init.sql:243`), so no document stops existing. No
user can move a document to another archive: the only `UPDATE logs SET archive_id` sites
(`github.js:1713`, `:1746`) move PR-session logs between hidden system archives, which search and
browse exclude.

**No outbound anything.** `git grep webhook` finds only statements that there are none
(`CLAUDE.md:18-19`, `docs/maps/github-integration.md`). The only in-process scheduled work is the
activity prune (`server.js:132-150`).

## Decisions this spec records

1. **The hook is one call inside `doLogActivity`**, right after the `activity_log` insert, in its
   own `try`/`catch`, before auto-watch and fan-out. Neither side's failure can break the other,
   and a coalesced `log.update` is never emitted.
2. **Public event types are Cloud Codex's own action strings**, so there is no second vocabulary.
   v1 emits an allowlist of eight: `log.update`, `log.publish`, `log.restore`, `log.rename`,
   `log.move`, `log.delete`, `archive.rename`, `archive.delete`. The contract is additive, and a
   receiver ignores types it does not know.
3. **Delivery state lives in MySQL, worked by an in-process interval** started from `server.js`,
   never from `app.js`. That respects CLAUDE.md's rules against an external job queue and a second
   process. The worker takes a database lease with an owner token, because Codex has no instance
   lock yet (the hosting track adds one).
4. **At-least-once, in order, per subscription.** One request in flight per subscription, in
   sequence order. A failing head event pauses that subscriber only, on a 10-second doubling
   backoff capped at one hour. An event is dead-lettered only on a `422` or at 72 hours of age; a
   `410` disables the subscription.
5. **The signature is Cloud Command's GitHub scheme, byte for byte**:
   `X-Codex-Signature-256: sha256=<lowercase hex>`, HMAC-SHA256 over the exact body bytes, keyed by
   the secret string's UTF-8 bytes. A committed test-vector file pins it in both repositories.
6. **Every retry sends the same bytes.** The serialized body is stored once and resent verbatim.
7. **The suite subscription is declared in env** (`WEBHOOK_URL`, `WEBHOOK_SECRET`, optional
   `WEBHOOK_WORKSPACE_ID`), reconciled at boot, with its secret read from env and never stored.
   That is also the shape a future provisioner injects. An admin API adds general subscriptions;
   their secrets are write-only and only a fingerprint is ever returned.
8. **An SSRF guard** refuses loopback, link-local (including `169.254.169.254`) and private targets
   unless `WEBHOOK_ALLOW_PRIVATE_TARGETS` is set, checks at creation and again at send time, never
   follows a redirect, and refuses link-local whatever the flag says.
9. **The actor is the Codex user id and name only**, with no email. When the identity track lands
   `user_identities`, the envelope may gain `actor.iss` and `actor.sub` as an additive change.
10. **Reconciliation exists** because capture happens after the mutation and is not awaited, so a
    crash between the two loses an event. It is one extra machine route, narrowed by workspace.

## The contract: envelope v1

```json
{
  "schema": "codex.event.v1",
  "id": "5b0e3c0e-8f0e-4a8c-9b7e-2c1d0f6a9e11",
  "sequence": 1042,
  "type": "log.rename",
  "occurred_at": "2026-09-24T15:04:05.123Z",
  "workspace_id": 3,
  "actor": { "id": 42, "name": "kyle" },
  "data": { "log_id": 113, "archive_id": 29, "title": "Release checklist" }
}
```

| Field | Bounds |
|---|---|
| `schema` | exactly `codex.event.v1` |
| `id` | a UUID v4 minted by Codex; **the idempotency key** |
| `sequence` | the outbox row's `BIGINT` id, strictly increasing per instance |
| `type` | one of the eight allowlisted actions |
| `occurred_at` | ISO 8601 UTC, millisecond precision, the Codex clock |
| `workspace_id` | the Codex workspace integer; a receiver stores it and **never lets it decide a tenant** |
| `actor` | `{ id, name }`; `name` is at most 32 characters (`init.sql:49`) |
| `data` | per type, below. `title` and `name` are sent as stored: both columns are `TEXT` (`init.sql:233`, `:268`), the document routes cap titles at 255, and a receiver clamps |

| Type | `data` |
|---|---|
| `log.update`, `log.publish`, `log.restore` | `log_id`, `archive_id`, `title`, and `version` for publish and restore |
| `log.rename` | `log_id`, `archive_id`, `title` |
| `log.move` | `log_id`, `archive_id`, `parent_id`, `previous_parent_id` |
| `log.delete` | `log_id`, `archive_id` |
| `archive.rename` | `archive_id`, `name` (archives carry a name, not a title) |
| `archive.delete` | `archive_id` |

Headers: `Content-Type: application/json`, `X-Codex-Signature-256`, and `X-Codex-Event` (the type)
and `X-Codex-Delivery` (the delivery row id), the last two for logs only and unsigned.

Receiver answers: any `2xx` is delivered (a duplicate is a `2xx`); `410` disables the
subscription; `422` dead-letters that one event; anything else, a timeout or a connection error
retries on the backoff.

**Cloud Command's receiver (W6-CMD-11) never answers `422` to a correctly signed delivery.** It
persists every signature-verified delivery before it answers, keyed on the envelope's `id`, parks
one it cannot parse on its own side, and answers `2xx`, the way its GitHub receiver stores raw
deliveries first. So between the two products a verified event is always accepted (a duplicate
is a `2xx` too) and never dead-lettered by the receiver. The `422` rule stays exactly as written
for any other receiver that genuinely rejects an event, and it is how Codex treats one. Cloud
Command's documents state the same contract.

## Ordering constraint

```
W6-CDX-10 (live MySQL, identity plan PR 1)
     │
     ├──► W6-CDX-12 (three gaps at the source) ──► W6-CDX-13 (outbox and hook) ──► W6-CDX-14 (worker) ──► W6-CDX-15 (admin UI)
     │
     └──► W6-CDX-16 (reconciliation read)
```

On the test-deploy path: W6-CDX-12, W6-CDX-13 and W6-CDX-14. W6-CDX-15 and W6-CDX-16 are inside
Wave 6 but can land after the deploy without breaking it, since the suite subscription is declared
in env and Cloud Command's reconciliation sweep (W6-CMD-17) is also off the path.

---

## W6-CDX-12. Emit what already happens: three activity gaps fixed at the source

### In scope

- **(a)** `DELETE /api/archives/:id` resolves the workspace and squad **before** the delete and
  passes them to `logActivity`, so `archive.delete` is recorded.
- **(b)** `PUT /api/archives/:archiveId/logs/:logId` logs `log.rename` when the title changes, with
  the 255-character cap `documents.js:293` already applies (a longer title is a 400), and logs
  `log.move` with the previous and new `parent_id` when the parent changes.
- **(c)** The `collab.js:503-505` comment and the `archives.js:574` comment are corrected.
- The notifications-and-activity map.

### Done means

- Route tests for each path. Live-MySQL tests assert the `activity_log` row (action, resource,
  workspace, squad) for an archive delete, a tree rename and a tree move.
- A test proves a tree rename creates no notification and no watch.
- A title over 255 characters is refused with 400. Coverage thresholds hold.

### Explicitly deferred

Adding `logActivity` to the GitHub pull writes. That would start emailing watchers, which is a
product change for its own spec.

---

## W6-CDX-13. The outbox, subscriptions, and the emit hook

### In scope

- A dated migration and the matching `init.sql` edit, in `CREATE TABLE` shapes the runner's schema
  check (`scripts/migrate.js:351`) can read:
  - `webhook_subscriptions`: `url`, `secret` (admin rows only), `source` (`env` or `admin`, a
    VARCHAR with a CHECK), `enabled`, an event filter, an optional workspace filter,
    `disabled_reason`, and backoff state (`paused_until`, `consecutive_failures`);
  - `webhook_events`: `BIGINT` id (the sequence), `event_uuid` unique, `type`, `workspace_id`,
    `occurred_at DATETIME(3)`, and the body as `MEDIUMBLOB` holding the exact bytes every retry
    sends;
  - `webhook_deliveries`: subscription, event, status, attempts, lease columns (`leased_by`,
    `lease_expires_at`), `last_status`, `last_error`, `delivered_at`. Backoff is per subscription,
    so its schedule lives on the subscription row, not the delivery.
- `services/webhooks.js` exports `emitEvent`, which never throws, called from `doLogActivity` as
  Decision 1 describes, for the eight actions only. It builds the envelope, and writes nothing when
  no subscription matches.
- The env-declared subscription is reconciled at boot: created, updated or disabled to match env.
- `/api/admin/webhooks` behind `requireAdmin`: list, create, rotate secret, disable, delete.
- The SSRF guard as `isAllowedWebhookTarget(url)`, allowing plain `http` only outside production.
- `.env.example`, `docs/api/admin.md`, and the data-model map.

### Done means

Live-MySQL tests show each allowlisted action writing exactly one event and one delivery per
matching subscription; a coalesced `log.update` and a non-allowlisted action writing none; the
workspace filter narrowing; zero subscriptions writing zero rows; stable stored bytes; and an
outbox insert that throws leaving the activity row, the watcher notifications and the HTTP
response untouched. The SSRF guard is tested over a table of cases. The env subscription is
right across boots. Non-admins are refused. `npm test` counts only grow; lint and thresholds are
green.

### Explicitly deferred

Encrypting admin-API subscription secrets at rest. They are stored in MySQL, write-only through the
API, and the limitation is documented: a database dump lets its holder forge events to that one
receiver. The suite's subscription avoids it because its secret lives only in env.

---

## W6-CDX-14. The delivery worker

### In scope

- An in-process worker started from `server.js` beside the activity prune, with `unref`'d timers.
  Each tick leases due deliveries with a guarded `UPDATE` (lease expiry plus owner token), keeps one
  request in flight per subscription in sequence order, and has a bounded batch and time budget so
  it catches up after an outage without starving the event loop.
- A `POST` of the stored bytes with the three headers, a 10-second timeout, `redirect: 'manual'`
  (any `3xx` is a failure), and the SSRF guard re-checked at send time.
- Outcomes as in the contract; a 72-hour-old event is dead-lettered; an admin redeliver endpoint
  re-queues a dead-lettered delivery. Delivered and dead rows are pruned after 30 days on the daily
  prune.
- The request-lifecycle, notifications-and-activity and build-test-and-ops maps.

### Done means

- The signature matches the committed vectors byte for byte.
- A subscriber that hangs or answers 500 cannot slow or fail a document save: save latency with a
  hanging subscriber is within noise of having none, measured and recorded.
- While event 2 fails, event 3 is not sent until 2 is delivered or dead-lettered.
- Two workers on one live-MySQL database never both send the same delivery, and a lapsed lease
  cannot overwrite its successor's state.
- Backoff, the 72-hour dead-letter, `422`, `410` and the no-redirect rule are each tested.

---

## W6-CDX-15. Webhooks in the admin console

### In scope

A section built as a component under `src/components/`, not inline in `AdminPage.jsx`, because
pages are out of test scope by policy. It lists subscriptions (the env-managed one read-only),
creates one (with the SSRF refusal shown as a sentence), enables, disables, rotates and deletes,
and shows recent deliveries with a Redeliver action for dead-lettered ones. `docs/features.md` and
`docs/api/admin.md`.

### Done means

Component tests for rendering, create, validation errors, rotate and redeliver, and a hand check in
a browser at desktop and mobile widths per the shippability checklist, with the screenshots read.

---

## W6-CDX-16. A machine read for reconciliation

### Current behaviour

`machineOrAuth` is mounted on `GET /api/search` and `GET /api/browse` and nothing else
(`routes/search.js:106`, `:226`; `CLAUDE.md:108-114`), and the workspace narrowing is a join on
the squad's workspace (`search.js:72-74`).

### In scope

- `GET /api/documents/state?workspaceId=<id>&ids=<up to 100 ints>` under `machineOrAuth`. For each
  id the principal can read, through `readAccessWhere` with the principal's params and
  `excludeSystemArchives`, narrowed to the workspace exactly as `search.js:72-74` narrows, it returns
  `{ id, title, archive_id, updated_at }`. An unreadable id and a deleted id are both simply absent,
  so the answer is never an oracle.
- A rate limit, and the amendment to `CLAUDE.md:108-114` and the access-control map naming this as
  the third machine route.

### Done means

Route tests. A live-MySQL test with two workspaces and a private archive proves both the workspace
narrowing and the ACL. The machine principal cannot see an archive only an admin could read,
because `is_admin` is forced false. 101 ids, or a missing `workspaceId`, is a 400. A deleted id and
an unreadable id produce identical answers.

---

## Cross-repo dependencies

| This session | Needs, from outside this repo | Is needed by |
|---|---|---|
| W6-CDX-11 (this spec) | nothing | W6-CMD-10 (the receiver builds against the envelope and vectors) |
| W6-CDX-13, W6-CDX-14 | the receiver persisting then answering `2xx`, or `401` and `410` (W6-CMD-11), for the end-to-end run only | W6-CMD-18 (the events end-to-end run) and the second Codex release the test box pins |
| W6-CDX-16 | nothing | W6-CMD-17 (reconciliation sweep) |

The signature vectors are defined here and committed in both repositories: this repo's copy in
W6-CDX-14, Cloud Command's in W6-CMD-11, checked against its unchanged `verifySignature`.

## Explicitly deferred, track level

- **GitHub pull writes** (`github.js:1200`, `:1242`, `:1424`): emitting them means adding
  `logActivity`, which emails watchers. Its own spec.
- **Squad and workspace deletes:** they detach archives and delete no document.
- **Comment and membership events:** they carry people data. A later additive type.
- **Cross-archive moves:** nothing user-reachable does one today.
- **Delivery to more than one Cloud Command per instance, and moving an instance between
  workspaces:** the provisioning era.

## Retirement

Whichever of W6-CDX-12 to W6-CDX-16 merges last updates the maps, deletes this spec and its plan,
and marks the events row in [`roadmap.md`](roadmap.md) shipped.

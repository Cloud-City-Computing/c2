# Plan: outbound events track

Implements [`../specs/2026-09-24-outbound-events.md`](../specs/2026-09-24-outbound-events.md).

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to
> implement this plan task by task, one fresh subagent per task, with review between tasks. This is
> the standing convention for a written plan in this repo (`docs/plans/README.md`), not a choice to
> re-present. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloud Codex tells a configured receiver, reliably and in order, when a document or an
archive is renamed, moved, edited, published, restored or deleted, with a signed body the receiver
can verify, and an install with no subscription does exactly what it does today.

**Architecture:** one call in `doLogActivity` writes an outbox row (`webhook_events`, exact body
bytes) and one delivery per matching subscription, only when a subscription matches, using an
in-process subscription cache so an install with none issues no extra query. An in-process worker
started from `server.js` leases each subscription's head delivery, POSTs the stored bytes with an
HMAC signature over a DNS-pinned connection, and applies per-subscription backoff. A machine read
lets the receiver reconcile what the stream missed.

**Tech stack:** Node 22, Express 5, MySQL 8.4, `node:https` and `node:net`, Vitest 4 + Supertest,
the live-MySQL project from W6-CDX-10.

**Precondition:** W6-CDX-10 has merged (PR 1 of
[`2026-09-24-suite-identity.md`](2026-09-24-suite-identity.md)). Every schema test here runs on it.

**Order:** one PR per session.

| PR | Session | Branch | Test deploy |
|---|---|---|---|
| 1 | W6-CDX-12, three activity gaps fixed at the source | `w6/cdx-12-activity-gaps` | yes |
| 2 | W6-CDX-13, the outbox, subscriptions and the emit hook | `w6/cdx-13-outbox` | yes |
| 3 | W6-CDX-14, the delivery worker | `w6/cdx-14-worker` | yes |
| 4 | W6-CDX-15, webhooks in the admin console | `w6/cdx-15-admin-ui` | no |
| 5 | W6-CDX-16, a machine read for reconciliation | `w6/cdx-16-state-read` | no |

PR 5 depends only on W6-CDX-10 and may run beside PRs 1 to 4.

## Before every PR

- [ ] `git fetch origin && git switch -c <branch> origin/main`.
- [ ] Re-derive every anchor this PR names by function or route (`grep -n`); the `:line` numbers
      are from `91493a6`.
- [ ] `cd cloudcodex && npm ci && npm test && npm run test:integration`; record the counts.
- [ ] Before `gh pr create`: an adversarial review (the `momus` reviewer) of the diff; then watch CI
      to green.

## Global constraints

The identity plan's global constraints apply unchanged (headers, `console.error` only, no implicit
coercion, parameterized SQL, `asyncHandler` and `errorHandler`, mock queue order, dated migrations
that each declare a `CREATE TABLE` or `ADD COLUMN`, per-glob coverage, maps in the same PR, no em
dashes). In addition:

- **Nothing here may slow or fail the request that caused the event.** `logActivity` is already
  fire-and-forget (`activity.js:50-56`); the emit call inside it is wrapped in its own `try`, and the
  worker never runs on a request path.
- **Nothing here is an external job queue or a second process** (CLAUDE.md "What NOT to do"). The
  worker is an `unref`'d interval inside the one process, started from `server.js` and never from
  `app.js`, so tests that import `app.js` never start it.
- **The public contract is the spec's envelope v1.** A field, header or status that is not in the
  spec is not added without amending the spec in the same PR.

---

## PR 1: W6-CDX-12, emit what already happens

### Task 1.1 `archive.delete` is recorded (test first)

- [ ] Export `resolveScope` from `routes/helpers/activity.js` as `resolveActivityScope` (the
      function at `activity.js:219`, unchanged).
- [ ] In `tests/routes/archives.test.js`, a new test: `DELETE /api/archives/:id` calls `logActivity`
      with `workspaceId` and `squadId` resolved **before** the delete. It fails today because the
      call carries neither.
- [ ] `routes/archives.js` `DELETE /archives/:id`: after the `isArchiveOwner` check and before the
      `DELETE`, `const scope = await resolveActivityScope('archive', Number(id));`, then
      `logActivity({ ..., workspaceId: scope?.workspace_id, squadId: scope?.squad_id })`. An orphaned
      archive (no squad) resolves to `null` and stays unrecorded, as every activity row needs a
      workspace (`init.sql` `activity_log.workspace_id NOT NULL`).

The existing delete-archive tests gain one queued `c2_query` result for the scope lookup, between
the owner check and the delete; list each edited test in the PR body.

### Task 1.2 The tree route records rename and move (tests first)

`routes/archives.js` `PUT /archives/:archiveId/logs/:logId`:

- read the current row first, `SELECT title, parent_id FROM logs WHERE id = ? AND archive_id = ?`,
  after the write-access check;
- refuse a title over 255 characters with the same 400 body `routes/documents.js:293-295` uses;
- after the `UPDATE`, when the trimmed title differs:
  `logActivity({ user, action: 'log.rename', resourceType: 'log', resourceId: Number(logId), metadata: { title } })`;
- when `parent_id` differs:
  `logActivity({ ..., action: 'log.move', metadata: { parent_id: pid, previous_parent_id: row.parent_id } })`.

Tests: a rename logs `log.rename` with the new title; a no-op title logs nothing; a re-parent logs
`log.move` with both parents; both changes in one request log both; 256 characters is a 400 and
writes nothing.

### Task 1.3 A rename emails nobody

`tests/helpers/activity.test.js`: `logActivity` with `log.rename` inserts the activity row and calls
neither `createNotification` nor the watch insert. This pins the fact the stale comment got wrong.

### Task 1.4 The comments

`services/collab.js:503-505` becomes: "Gated on canWrite like every other mutating message:
renaming writes the row and sets updated_by. It logs log.rename, which neither auto-watches nor
notifies (routes/helpers/activity.js WATCH_NOTIFICATION_TYPE and AUTO_WATCH_RULES)."
`routes/archives.js:574`: "Delete a log (write_access required). Its children are promoted, not
deleted: logs.parent_id is ON DELETE SET NULL."

### Task 1.5 Live-MySQL proof and docs

- [ ] `tests/integration/activity-gaps.test.js`: seed a workspace, squad, archive and two documents;
      drive the three routes through Supertest with a real session; assert each `activity_log` row
      (action, resource type and id, workspace, squad). `logActivity` is asynchronous, so poll the
      table for up to 2 seconds rather than sleeping.
- [ ] `docs/maps/notifications-and-activity.md` (the action taxonomy gains `log.move`, and the
      archive-delete scope). Lint, test, coverage, integration, build.

---

## PR 2: W6-CDX-13, the outbox, subscriptions and the emit hook

### Task 2.1 The schema, on real MySQL first

`migrations/<today>-webhooks.sql`, and the same three tables in `init.sql` after `notifications`
(and in its `DROP TABLE` list):

```sql
CREATE TABLE webhook_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  url VARCHAR(2048) NOT NULL,
  -- Admin-created rows only. The env-declared subscription's secret is read
  -- from WEBHOOK_SECRET at send time and never stored.
  secret VARCHAR(255) NULL,
  source VARCHAR(8) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- NULL means every allowlisted type; otherwise a JSON array of type strings.
  event_types JSON NULL,
  -- NULL means every workspace.
  workspace_id INT NULL,
  disabled_reason VARCHAR(255) NULL,
  consecutive_failures INT NOT NULL DEFAULT 0,
  paused_until DATETIME(3) NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_webhook_subscriptions_source CHECK (source IN ('env', 'admin')),
  CONSTRAINT chk_webhook_subscriptions_secret CHECK ((source = 'env') = (secret IS NULL)),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE webhook_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,   -- the envelope's `sequence`
  event_uuid CHAR(36) NOT NULL,           -- the envelope's `id`, the idempotency key
  type VARCHAR(32) NOT NULL,
  workspace_id INT NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  body MEDIUMBLOB NOT NULL,               -- the exact bytes every delivery sends
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook_events_uuid (event_uuid),
  INDEX idx_webhook_events_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE webhook_deliveries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  subscription_id INT NOT NULL,
  event_id BIGINT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  leased_by CHAR(36) NULL,
  lease_expires_at DATETIME(3) NULL,
  last_status SMALLINT NULL,
  last_error VARCHAR(255) NULL,
  delivered_at DATETIME(3) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_webhook_deliveries_status CHECK (status IN ('pending', 'delivered', 'dead')),
  UNIQUE KEY uq_webhook_deliveries_sub_event (subscription_id, event_id),
  INDEX idx_webhook_deliveries_head (subscription_id, status, event_id),
  FOREIGN KEY (subscription_id) REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES webhook_events(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

`workspace_id` on `webhook_subscriptions` deliberately has no foreign key: an env subscription names
a workspace by number, and a deleted workspace must not delete the subscription row silently.

`tests/integration/webhooks-schema.test.js`: both CHECKs reject; the unique keys reject duplicates;
deleting a subscription cascades its deliveries; `schemaClaims` on the file lists the three tables.

### Task 2.2 The SSRF guard

`services/webhook-target.js`:

```javascript
import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

// Refused whatever WEBHOOK_ALLOW_PRIVATE_TARGETS says: cloud metadata lives here.
const ALWAYS = new BlockList();
ALWAYS.addSubnet('169.254.0.0', 16, 'ipv4');
ALWAYS.addSubnet('fe80::', 10, 'ipv6');
ALWAYS.addAddress('0.0.0.0', 'ipv4');
ALWAYS.addAddress('::', 'ipv6');

// Refused unless the operator opts in (a receiver on the same box or network).
const PRIVATE = new BlockList();
PRIVATE.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');

/** { ok: true, url, addresses } or { ok: false, reason } for a human sentence. */
export async function checkWebhookTarget(raw, { allowPrivate, production, resolve = lookup }) {}

/** A `lookup` for https.request that answers only with addresses checkWebhookTarget approved. */
export function pinnedLookup(addresses) {}
```

Rules, each a row in a table-driven test (`tests/services/webhook-target.test.js`, with `resolve`
injected so no test touches DNS): `https:` always; `http:` only outside production; no userinfo in
the URL; every resolved address checked, not just the first; an IPv4-mapped IPv6 address checked
as its IPv4 form; `169.254.169.254` refused even with `allowPrivate`; `127.0.0.1` and `10.0.0.5`
refused unless `allowPrivate`; a name resolving to one public and one private address refused.

### Task 2.3 The subscription cache and the env subscription

`services/webhooks.js`:

- `loadSubscriptions()` reads `SELECT id, url, source, enabled, event_types, workspace_id,
  paused_until FROM webhook_subscriptions WHERE enabled = TRUE` into module state. It starts
  **empty and unloaded**, so a unit test that never calls it sees zero subscriptions and issues no
  query, which is what keeps every existing `activity.test.js` queue unchanged.
- `reconcileEnvSubscription(env)`: with `WEBHOOK_URL` and `WEBHOOK_SECRET` set (the secret at least
  32 characters), create or update the one `source = 'env'` row to match `WEBHOOK_URL` and
  `WEBHOOK_WORKSPACE_ID`, enabled; with either unset, disable an existing env row with
  `disabled_reason = 'WEBHOOK_URL or WEBHOOK_SECRET is unset'`. A URL the guard refuses disables
  the row and logs the reason once. Runs in one `withTransaction`.
- `server.js`, after `bootstrapInstance`: `await reconcileEnvSubscription(process.env)` then
  `await loadSubscriptions()`, each in its own `try` that logs and carries on, and
  `setInterval(loadSubscriptions, 60_000).unref()`.

### Task 2.4 `emitEvent`, and the one call site (tests first)

```javascript
export const EMITTED_TYPES = new Set([
  'log.update', 'log.publish', 'log.restore', 'log.rename',
  'log.move', 'log.delete', 'archive.rename', 'archive.delete',
]);

/**
 * Write one outbox event and one delivery per matching subscription. Never
 * throws: a failure is logged and the caller's request is unaffected.
 * @param {object} ctx - the logActivity context
 * @param {{ workspaceId: number, squadId: number|null }} scope
 */
export async function emitEvent(ctx, scope) {}
```

Its body, in order: return unless `EMITTED_TYPES.has(ctx.action)`; filter the cached subscriptions
by type and workspace, return if none (**no query**); build `data` per the spec's table, from
`ctx.metadata` where it carries the field and otherwise one
`SELECT archive_id, title, parent_id FROM logs WHERE id = ?` (for `log.delete`, whose activity row
is resource type `archive` with `metadata.log_id` at `archives.js:597-603`, `data` is
`{ log_id: metadata.log_id, archive_id: resourceId }`); then in one `withTransaction`: insert the
event with an empty body to get its id, serialize the envelope with `sequence` set to that id and
`id` a `randomUUID()`, `UPDATE webhook_events SET body = ?` with `Buffer.from(json, 'utf8')`, and
insert one `webhook_deliveries` row per subscription.

`routes/helpers/activity.js` `doLogActivity`, directly after the `INSERT INTO activity_log`:

```javascript
  // Outbound events (docs/specs/2026-09-24-outbound-events.md). After the
  // activity row, so a coalesced log.update (returned above) is never emitted,
  // and before watchers, so neither can fail the other.
  try {
    await emitEvent(ctx, { workspaceId, squadId: squadId ?? null });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] webhook emit failed:`, err);
  }
```

Unit tests in `tests/services/webhooks.test.js` with the mock: a non-allowlisted action issues no
query; zero cached subscriptions issue no query; the workspace filter narrows; the envelope has every
spec field and nothing else. `tests/helpers/activity.test.js` passes **unedited**.

### Task 2.5 The admin API

`routes/webhooks.js`, every route `requireAuth, requireAdmin`, mounted in `app.js`, ending with
`router.use(errorHandler)`:

| Route | Does |
|---|---|
| `GET /api/admin/webhooks` | list, with `secret_fingerprint` (first 8 hex of the secret's SHA-256) and never the secret; the env row marked `managed: true` |
| `POST /api/admin/webhooks` | `{ url, event_types?, workspace_id? }`; runs the guard; generates a 32-byte hex secret and returns it **once** |
| `POST /api/admin/webhooks/:id/rotate` | a new secret, returned once; refused for the env row |
| `PATCH /api/admin/webhooks/:id` | `{ enabled }`; re-enabling clears `consecutive_failures`, `paused_until` and `disabled_reason` |
| `DELETE /api/admin/webhooks/:id` | refused for the env row |

Each write calls `loadSubscriptions()`. Tests: non-admins get 403 on every route; the secret never
appears in a list or error body; the guard's refusal is a 400 with its sentence.

### Task 2.6 Live-MySQL proof, and docs

- [ ] `tests/integration/webhooks-emit.test.js`: with one admin subscription loaded, each of the
      eight actions writes exactly one event and one delivery; a second `log.update` inside the
      coalescing window writes none; a non-allowlisted action (`comment.create`) writes none; a
      subscription filtered to another workspace gets no delivery; with zero subscriptions no row
      is written; the stored body parses to the envelope and is byte-stable across two reads; with
      the `webhook_events` insert forced to fail (a trigger that `SIGNAL`s, created by the test), the
      activity row, the watcher notification and the HTTP response are all unaffected.
- [ ] `.env.example`: `WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEBHOOK_WORKSPACE_ID`,
      `WEBHOOK_ALLOW_PRIVATE_TARGETS`, each commented. `docs/api/admin.md` (the five routes).
      `docs/maps/data-model.md` (the three tables). CHANGELOG `[Unreleased]`.
- [ ] `npm test` counts only grow. Lint, coverage (a `services/webhooks.js` and
      `services/webhook-target.js` threshold), integration, build.

---

## PR 3: W6-CDX-14, the delivery worker

### Task 3.1 The signature, pinned by vectors

`cloudcodex/tests/fixtures/codex-event-signature-vectors.json`, the file Cloud Command commits
beside its receiver (W6-CMD-11), **byte for byte**. These three were computed on 2026-09-24 with
both Python's `hmac` and Node's `crypto`, which agree:

```json
[
  {
    "secret": "codex-test-secret-1",
    "body_base64": "eyJzY2hlbWEiOiJjb2RleC5ldmVudC52MSIsImlkIjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwic2VxdWVuY2UiOjEsInR5cGUiOiJsb2cucmVuYW1lIiwib2NjdXJyZWRfYXQiOiIyMDI2LTA5LTI0VDAwOjAwOjAwLjAwMFoiLCJ3b3Jrc3BhY2VfaWQiOjEsImFjdG9yIjp7ImlkIjoxLCJuYW1lIjoiYWRtaW4ifSwiZGF0YSI6eyJsb2dfaWQiOjEsImFyY2hpdmVfaWQiOjEsInRpdGxlIjoiSGVsbG8ifX0=",
    "signature": "sha256=1abe3be10983aa61d85521a78cc46c6de51493ac4e1b752984372108f4c743da"
  },
  {
    "secret": "sécret-ü-2",
    "body_base64": "eyJzY2hlbWEiOiJjb2RleC5ldmVudC52MSIsImlkIjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAyIiwic2VxdWVuY2UiOjIsInR5cGUiOiJsb2cudXBkYXRlIiwib2NjdXJyZWRfYXQiOiIyMDI2LTA5LTI0VDAwOjAwOjAxLjUwMFoiLCJ3b3Jrc3BhY2VfaWQiOjEsImFjdG9yIjp7ImlkIjoyLCJuYW1lIjoiYsOpYSJ9LCJkYXRhIjp7ImxvZ19pZCI6NywiYXJjaGl2ZV9pZCI6MywidGl0bGUiOiJDYWbDqSDimJUgbm90ZXMifX0=",
    "signature": "sha256=7d363424332d52030526964589510d5b1e71757d30f312547fbd941766130232"
  },
  {
    "secret": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "body_base64": "eyJzY2hlbWEiOiJjb2RleC5ldmVudC52MSIsImlkIjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAzIiwic2VxdWVuY2UiOjMsInR5cGUiOiJhcmNoaXZlLmRlbGV0ZSIsIm9jY3VycmVkX2F0IjoiMjAyNi0wOS0yNFQwMDowMDowMi4wMDBaIiwid29ya3NwYWNlX2lkIjoyLCJhY3RvciI6eyJpZCI6MSwibmFtZSI6ImFkbWluIn0sImRhdGEiOnsiYXJjaGl2ZV9pZCI6OX19",
    "signature": "sha256=1dd18396fde791de7a45a89f17f4342e76c982add405dbbc71364a84f2531078"
  }
]
```

The second vector has a non-ASCII secret and title, which is what catches a signer that keys or
hashes a JavaScript string instead of its UTF-8 bytes.

```javascript
export function signBody(secret, body) {
  return `sha256=${createHmac('sha256', Buffer.from(secret, 'utf8')).update(body).digest('hex')}`;
}
```

Test: `signBody(v.secret, Buffer.from(v.body_base64, 'base64'))` equals `v.signature` for all three.

### Task 3.2 One tick

`services/webhook-worker.js` exports `createWebhookWorker({ query, send, now, owner })` (every
dependency injected, so the tick is testable without timers or a network) and `startWebhookWorker()`
for `server.js`. A tick:

1. `SELECT id, url, source, secret FROM webhook_subscriptions WHERE enabled = TRUE AND
   (paused_until IS NULL OR paused_until <= NOW(3)) ORDER BY id LIMIT 20`.
2. Per subscription, its **head**: `SELECT d.id, d.attempts, e.id AS sequence, e.type, e.occurred_at,
   e.body FROM webhook_deliveries d JOIN webhook_events e ON e.id = d.event_id WHERE
   d.subscription_id = ? AND d.status = 'pending' ORDER BY d.event_id LIMIT 1`. Nothing behind the
   head is ever sent, which is the ordering guarantee.
3. Lease it: `UPDATE webhook_deliveries SET leased_by = ?, lease_expires_at = NOW(3) + INTERVAL 30
   SECOND WHERE id = ? AND status = 'pending' AND (lease_expires_at IS NULL OR lease_expires_at <
   NOW(3))`. `affectedRows !== 1` means another worker holds it: skip the subscription.
4. `occurred_at` more than 72 hours ago: mark `dead` (`last_error = 'expired after 72h'`) and stop
   for this subscription this tick.
5. Send, then record the outcome. **Every write after the lease carries `AND leased_by = ?`**, so a
   worker whose lease lapsed writes nothing:
   - `2xx`: `status = 'delivered'`, `delivered_at`, `last_status`; the subscription's
     `consecutive_failures = 0` and `paused_until = NULL`.
   - `410`: the subscription `enabled = FALSE`, `disabled_reason = 'receiver answered 410'`; the
     delivery stays `pending` for an admin to redeliver after re-enabling.
   - `422`: this delivery `dead` with `last_status = 422`; the subscription is not paused. This is
     a generic receiver's rejection: Cloud Command's receiver persists every signed delivery and
     answers `2xx` instead (the spec's contract section), so the suite never reaches this branch.
   - anything else, including a `3xx`, a timeout or a connection error: `attempts + 1`,
     `last_status`, `last_error` (at most 255 characters, never the body), the lease released, and
     the subscription paused until `now + min(10s * 2^(failures - 1), 1h)`.
6. Stop the tick after 100 sends or 5 seconds, whichever comes first.

`send` is `node:https`/`node:http` `request` with `method: 'POST'`, the three headers
(`X-Codex-Signature-256` from the subscription's secret, or `WEBHOOK_SECRET` for the env row;
`X-Codex-Event`; `X-Codex-Delivery`), `Content-Type: application/json`, a 10-second timeout, and
`lookup: pinnedLookup(addresses)` from a `checkWebhookTarget` run **at send time**, so DNS cannot be
rebound between the check and the connect. Redirects are never followed because `node:https` does
not follow them.

### Task 3.3 Start it, prune it, redeliver it

- `server.js`: `startWebhookWorker()` after `loadSubscriptions()`, every 2 seconds, `unref`'d.
- The daily prune (beside `pruneOldActivity`): delete `delivered` and `dead` deliveries older than
  30 days, then events older than 30 days that no delivery references.
- `POST /api/admin/webhooks/deliveries/:id/redeliver` (admin): a `dead` delivery back to `pending`
  with `attempts = 0`; `GET /api/admin/webhooks/:id/deliveries` lists the last 50 with status,
  attempts, last status and error.

### Task 3.4 Tests, including the ones that need a real database

- Unit, with injected `query`, `send` and `now`: each outcome's writes; the backoff schedule (10s,
  20s, 40s, then capped at 3600s); the 72-hour dead-letter; a `3xx` is a failure.
- `tests/integration/webhooks-worker.test.js`, with a real receiver on `127.0.0.1` (a Node `http`
  server in the test, `WEBHOOK_ALLOW_PRIVATE_TARGETS=1`):
  - the received body is byte-identical to `webhook_events.body` and its signature verifies;
  - **ordering**: the receiver fails event 2 twice; event 3 is not received until event 2 is;
  - **two workers, one database**: run two `createWebhookWorker` instances with different owners
    concurrently over 50 pending deliveries; the receiver sees each delivery id exactly once;
  - **a lapsed lease writes nothing**: lease a delivery as owner A, expire the lease by hand, let
    owner B deliver it, then run A's outcome write and assert zero rows changed;
  - `410` disables, `422` dead-letters and moves on.
- **Latency**: a subscription whose receiver never answers, and 20 `POST /api/save-document` calls;
  the median save latency is within noise of the same run with no subscription. Record both
  medians in the PR body.

### Task 3.5 Docs

- [ ] `docs/maps/request-lifecycle.md` (boot starts the worker), `docs/maps/notifications-and-activity.md`
      (the emit hook), `docs/maps/build-test-and-ops.md` (the in-process jobs are now three),
      `docs/deployment.md` "Background work". CHANGELOG. Lint, test, coverage, integration, build.

---

## PR 4: W6-CDX-15, webhooks in the admin console

### Task 4.1 The component

`src/components/WebhooksPanel.jsx`, mounted from `AdminPage.jsx` with one line. API wrappers in
`src/util.jsx` beside the other admin calls (`fetchWebhooks`, `createWebhook`, `rotateWebhook`,
`setWebhookEnabled`, `deleteWebhook`, `fetchWebhookDeliveries`, `redeliverWebhook`). The panel lists
subscriptions (the env row read-only, labelled "Configured in the server environment"); a create
form whose guard refusal is shown as the API's sentence; the new or rotated secret shown once with a
copy button and the sentence "This secret will not be shown again"; enable, disable and delete
through `<ConfirmDialog>`; and per subscription the recent deliveries with a Redeliver button on
dead ones.

### Task 4.2 Tests and a look

- [ ] `tests/src/components/WebhooksPanel.test.jsx`: rendering, create, a validation error, rotate
      (the secret appears once and not after a re-render), redeliver.
- [ ] By hand, against a running app, at desktop and mobile widths: `iris shoot` the admin page with
      two subscriptions and a dead delivery, and read the images. `docs/features.md` and
      `docs/api/admin.md`. Lint, test, coverage, build.

---

## PR 5: W6-CDX-16, a machine read for reconciliation

### Task 5.1 The route, tests first

`routes/documents.js`:

```javascript
router.get('/documents/state', machineOrAuth, stateLimiter, asyncHandler(async (req, res) => {
  const workspaceId = req.query.workspaceId;
  const ids = String(req.query.ids ?? '').split(',').filter(Boolean);
  if (!isValidId(workspaceId)) {
    return res.status(400).json({ success: false, message: 'A workspaceId is required' });
  }
  if (ids.length === 0 || ids.length > 100 || !ids.every(isValidId)) {
    return res.status(400).json({ success: false, message: 'Between 1 and 100 document ids are required' });
  }

  const rows = await c2_query(
    `SELECT l.id, l.title, l.archive_id, l.updated_at
       FROM logs l
 INNER JOIN archives p ON l.archive_id = p.id
 INNER JOIN squads _fs ON _fs.id = p.squad_id AND _fs.workspace_id = ?
      WHERE l.id IN (${ids.map(() => '?').join(', ')})
        AND ${readAccessWhere('p')}
        AND ${excludeSystemArchives('p')}`,
    [Number(workspaceId), ...ids.map(Number), ...readAccessParams(req.user)]
  );

  res.json({ success: true, documents: rows });
}));
```

The placeholders are generated from the count only, never from the values; the workspace narrowing
is the join `routes/search.js:72-74` uses. `stateLimiter` is a new `rateLimit` at 120 requests per
15 minutes, registered in `app.js` the way `searchLimiter` is (`app.js:160-168`).

Tests (mock queue): a missing `workspaceId`, 0 ids, 101 ids and a non-numeric id are each 400; the
bound params are the workspace, the ids, then exactly the 7 access params in order; a deleted id and
an unreadable id both simply do not appear.

### Task 5.2 The proof on real MySQL

`tests/integration/documents-state.test.js`: two workspaces, a private archive in one, a machine
principal configured with `SERVICE_TOKEN` and a non-admin `SERVICE_TOKEN_USER` who is a member of a
squad in the first workspace only. Asking about the first workspace returns only readable documents
from it; asking about the second returns nothing; a document in an archive only an admin could read
is absent (the principal's `is_admin` is forced false); the answer for a deleted id and for an
unreadable id is byte-identical.

### Task 5.3 The rule this amends, and the track's close

- [ ] CLAUDE.md "Machine callers" (`CLAUDE.md:108-114`) and `docs/maps/access-control.md` section 7
      name this as the third `machineOrAuth` route and say why it is safe (the same ACL fragments,
      narrowed by workspace, never an oracle).
- [ ] CHANGELOG `[Unreleased]` entries for the track, if PRs 1 to 4 did not already add them.
- [ ] Lint, test, coverage, integration, build.

---

## Retirement

Whichever of PRs 1 to 5 merges last also deletes `docs/specs/2026-09-24-outbound-events.md` and this
plan, marks the events row in `docs/specs/roadmap.md` shipped with its PR numbers, and removes the
spec's rows from `docs/specs/README.md` and `docs/README.md`. The maps are the record.

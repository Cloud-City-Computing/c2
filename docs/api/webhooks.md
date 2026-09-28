```
─── ◆ ─────────────────────────────────────────────────────────────────────
   API · Outbound Webhooks
─── ◆ ─────────────────────────────────────────────────────────────────────
```

# API Reference: Outbound Webhooks

Cloud Codex can tell a receiver you run when a document or an archive is renamed, moved, edited, published, restored or deleted. It is off by default: an instance with no subscription writes nothing and sends nothing. Subscriptions are declared in the server environment (one, see [Configuration](#configuration)) or made by an instance admin ([admin.md, Webhooks](admin.md#webhooks)).

> **Status.** Events are recorded in an outbox (`webhook_events`, `webhook_deliveries`) as they happen. The delivery worker that POSTs them to receivers ships in a later release; the envelope, headers and answers below are the contract it will follow.

---

## What is emitted

An event is emitted when the matching activity is recorded, for these eight types and no others. A receiver must ignore a type it does not know: new types are an additive change.

| Type | When | `data` |
|---|---|---|
| `log.update` | a document is saved (a coalesced repeat save by the same person within five minutes emits nothing) | `log_id`, `archive_id`, `title` |
| `log.publish` | a version is published | `log_id`, `archive_id`, `title`, `version` |
| `log.restore` | a version is restored | `log_id`, `archive_id`, `title`, `version` |
| `log.rename` | a document's title changes | `log_id`, `archive_id`, `title` |
| `log.move` | a document moves to another parent, or to the top level, within its archive | `log_id`, `archive_id`, `parent_id`, `previous_parent_id` |
| `log.delete` | a document is deleted (its children are kept, moved to the top level) | `log_id`, `archive_id` |
| `archive.rename` | an archive is renamed | `archive_id`, `name` |
| `archive.delete` | an archive, and every document in it, is deleted | `archive_id` |

`title` is always the document's own title (for `log.publish`, not the name given to the version). `parent_id` and `previous_parent_id` are `null` for a top-level document. A subscription can be limited to some of these types and to one workspace.

---

## The envelope: `codex.event.v1`

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

| Field | Meaning and bounds |
|---|---|
| `schema` | exactly `codex.event.v1` |
| `id` | a UUID v4 minted by Cloud Codex: **the idempotency key**. A retry carries the same `id` |
| `sequence` | strictly increasing per instance; events for one subscription are delivered in this order |
| `type` | one of the eight types above |
| `occurred_at` | ISO 8601 UTC with milliseconds, the Cloud Codex clock |
| `workspace_id` | the Cloud Codex workspace the event belongs to. Store it; never let it decide a tenant on your side |
| `actor` | the Cloud Codex user who caused it: `id` and `name` only (at most 32 characters), never an email |
| `data` | per type, above. Every id is an integer or `null`. `title` and `name` are cut to their first **255 Unicode code points** when the event is built, never splitting a character |

No body exceeds **4 KiB**, however its text escapes. The body is stored once and every retry sends the same bytes.

---

## Delivery

Each delivery is an HTTP `POST` of the envelope to the subscription's URL, with:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Codex-Signature-256` | `sha256=<lowercase hex>`: HMAC-SHA256 over the exact body bytes, keyed by the subscription secret's UTF-8 bytes |
| `X-Codex-Event` | the event type (for logs; not signed) |
| `X-Codex-Delivery` | the delivery's id (for logs; not signed) |

Verify the signature over the raw body before parsing it, with a constant-time comparison. This is the same scheme GitHub uses for `X-Hub-Signature-256`.

What your answer means:

| Answer | Outcome |
|---|---|
| any `2xx` | delivered. Answer `2xx` to a duplicate `id` too |
| `410` | the subscription is disabled |
| `422` | this one event is given up on (dead-lettered); later events continue |
| anything else, a timeout or a refused connection | retried, and later events for that subscription wait behind it |

Delivery is at least once and in order per subscription.

---

## Configuration

The server environment can declare one subscription, reconciled at every boot:

| Variable | Meaning |
|---|---|
| `WEBHOOK_URL` | the receiver. `https` in production |
| `WEBHOOK_SECRET` | the signing secret, at least 32 characters. It stays in the environment and is never written to the database |
| `WEBHOOK_WORKSPACE_ID` | optional: send only this workspace's events. A value that is not a whole number switches the subscription off rather than widen it |
| `WEBHOOK_ALLOW_PRIVATE_TARGETS` | `1` lets any subscription reach a loopback or private address. Instance-wide |

With `WEBHOOK_URL` or `WEBHOOK_SECRET` unset the subscription is switched off. Changing `WEBHOOK_URL` or `WEBHOOK_WORKSPACE_ID` drops the events still queued for the old receiver or workspace. See [.env.example](../../.env.example).

**Receiver addresses.** Every receiver URL, from the environment or the admin API, passes a guard: `https` (plain `http` only outside production), no user name or password, and every address its host resolves to must be public. Loopback and private ranges need `WEBHOOK_ALLOW_PRIVATE_TARGETS=1`; link-local and cloud-metadata addresses are refused always.

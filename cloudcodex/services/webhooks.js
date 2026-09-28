/**
 * Outbound webhooks: the subscription cache, the env subscription and emitEvent
 *
 * logActivity calls emitEvent once per recorded activity row. For the eight
 * allowlisted actions it writes one outbox event (webhook_events, the exact
 * body bytes every delivery sends) and one delivery per matching
 * subscription. It matches against an in-process cache first, so an install
 * with no subscription issues no query at all, and it never throws: a failure
 * is logged and the request that caused the event is unaffected. The delivery
 * worker that sends them is W6-CDX-14. The contract is
 * docs/api/webhooks.md (envelope v1).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { randomUUID } from 'node:crypto';
import { c2_query, withTransaction } from '../mysql_connect.js';
import { checkWebhookTarget } from './webhook-target.js';

/** The envelope's schema string. */
export const ENVELOPE_SCHEMA = 'codex.event.v1';

/** The activity actions emitted as events; any other action emits nothing. */
export const EMITTED_TYPES = new Set([
  'log.update', 'log.publish', 'log.restore', 'log.rename',
  'log.move', 'log.delete', 'archive.rename', 'archive.delete',
]);

// The contract's bound on title and name. Counted in code points, so a
// surrogate pair is never split; both columns are TEXT and not every writer
// caps them.
export const TEXT_BOUND = 255;

// users.name is VARCHAR(32). Bounded here too, so the size bound holds by
// construction rather than by trusting every caller's user object.
const ACTOR_NAME_BOUND = 32;

/**
 * `value` cut to its first `bound` code points; anything but a string as is.
 * @param { unknown } value
 * @param { Number } [bound]
 */
export const boundText = (value, bound = TEXT_BOUND) =>
  typeof value === 'string' ? Array.from(value).slice(0, bound).join('') : value;

/** An id field: a safe non-negative integer, or null. Never a string. */
function idOrNull(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * Serialize envelope v1. `title` and `name` in data, and the actor's name,
 * pass through the bound here, so no body can exceed 4 KiB however its text
 * escapes (JSON takes at most six bytes for one code point).
 * @param { { id: String, sequence: Number, type: String, occurredAt: String, workspaceId: Number,
 *   actor: { id: Number, name: String|null }, data: object } } event
 * @returns { String } the JSON text; the caller stores its UTF-8 bytes
 */
export function serializeEnvelope({ id, sequence, type, occurredAt, workspaceId, actor, data }) {
  const bounded = { ...data };
  if ('title' in bounded) bounded.title = boundText(bounded.title);
  if ('name' in bounded) bounded.name = boundText(bounded.name);
  return JSON.stringify({
    schema: ENVELOPE_SCHEMA,
    id,
    sequence,
    type,
    occurred_at: occurredAt,
    workspace_id: workspaceId,
    actor: { id: actor.id, name: boundText(actor.name ?? null, ACTOR_NAME_BOUND) },
    data: bounded,
  });
}

// ─── The subscription cache ─────────────────────────────────

// Starts empty: a process that never calls loadSubscriptions (every unit test
// that imports app.js) sees no subscription and emitEvent issues no query.
// Holds no secret: the loader never reads that column.
let subscriptions = [];

// Loads can overlap (the minute refresh, an admin write's reload). Each is
// numbered when it starts, and a result older than the one already applied
// is dropped, so a slow read from before an admin write cannot put back the
// cache that write replaced.
let loadsStarted = 0;
let loadApplied = 0;

/** event_types as MySQL hands back a JSON column: parsed, or as text. */
function parseEventTypes(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Read every enabled subscription into the cache. Called at boot, every
 * minute, and after every admin write. A failed read keeps the previous cache,
 * and so does a read that a later-started one already overtook.
 * @returns { Promise<Boolean> } whether this read refreshed the cache
 */
export async function loadSubscriptions() {
  const generation = ++loadsStarted;
  try {
    const rows = await c2_query(
      `SELECT id, url, source, enabled, event_types, workspace_id, paused_until
         FROM webhook_subscriptions
        WHERE enabled = TRUE`,
      []
    );
    if (generation < loadApplied) return false;
    loadApplied = generation;
    subscriptions = rows.map((row) => ({
      id: row.id,
      eventTypes: parseEventTypes(row.event_types),
      workspaceId: row.workspace_id ?? null,
    }));
    return true;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] webhook subscriptions load failed:`, err);
    return false;
  }
}

// ─── The env subscription ───────────────────────────────────

/** The disabled_reason an env row gets when the environment turns it off. */
export const ENV_UNSET_REASON = 'WEBHOOK_URL or WEBHOOK_SECRET is unset';

// A signing secret shorter than this is refused, as SERVICE_TOKEN is.
const MIN_SECRET_LENGTH = 32;

const INT_MAX = 2_147_483_647;

/**
 * The guard's options for this instance: private receivers only with
 * WEBHOOK_ALLOW_PRIVATE_TARGETS exactly 1, and https only in production.
 */
export function webhookTargetOptions() {
  return {
    allowPrivate: process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS === '1',
    production: process.env.NODE_ENV === 'production',
  };
}

const logLine = (line) => console.error(`[${new Date().toISOString()}] ${line}`);

/**
 * What the environment asks for: `{ enabled: true, url, workspaceId }`, or
 * `{ enabled: false, reason, configured }` where configured says whether any
 * of it was set (so an install with none of it stays silent).
 * @param { Function } [resolve] - injected into the guard by tests
 */
async function desiredEnvSubscription(resolve) {
  const url = process.env.WEBHOOK_URL?.trim() ?? '';
  const secret = process.env.WEBHOOK_SECRET ?? '';
  const workspace = process.env.WEBHOOK_WORKSPACE_ID?.trim() ?? '';
  const configured = url !== '' || secret !== '';

  if (url === '' || secret === '') return { enabled: false, reason: ENV_UNSET_REASON, configured };
  if (secret.length < MIN_SECRET_LENGTH) {
    return { enabled: false, reason: `WEBHOOK_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`, configured };
  }
  // A mistyped workspace must not quietly become "every workspace".
  if (workspace !== '' && (!/^\d+$/.test(workspace) || Number(workspace) < 1 || Number(workspace) > INT_MAX)) {
    return { enabled: false, reason: 'WEBHOOK_WORKSPACE_ID is not a positive whole number', configured };
  }

  const check = await checkWebhookTarget(url, { ...webhookTargetOptions(), ...(resolve ? { resolve } : {}) });
  if (!check.ok && !check.transient) return { enabled: false, reason: check.reason, configured };
  if (!check.ok) {
    // The name may resolve later, and every send re-checks it, so a DNS
    // outage at boot does not switch the suite's subscription off.
    logLine(`webhook env subscription: ${check.reason} Keeping it on; each delivery checks it again.`);
  }
  return { enabled: true, url, workspaceId: workspace === '' ? null : Number(workspace) };
}

/**
 * Make the one env-declared subscription (source 'env') match WEBHOOK_URL,
 * WEBHOOK_SECRET and WEBHOOK_WORKSPACE_ID, at boot: create it, update it, or
 * disable it with the reason. Its secret is never stored. When the receiver
 * URL or the workspace changes, what was queued for the old pair is dropped,
 * so events of one workspace never reach a receiver configured for another.
 * @param { { resolve?: Function } } [options]
 * @returns { Promise<'none'|'created'|'updated'|'retargeted'|'disabled'> }
 */
export async function reconcileEnvSubscription({ resolve } = {}) {
  const desired = await desiredEnvSubscription(resolve);

  const outcome = await withTransaction(async (query) => {
    const [row] = await query(
      `SELECT id, url, workspace_id FROM webhook_subscriptions
        WHERE source = 'env' ORDER BY id LIMIT 1 FOR UPDATE`,
      []
    );

    if (!desired.enabled) {
      if (!row) return { action: 'none' };
      await query('UPDATE webhook_subscriptions SET enabled = FALSE, disabled_reason = ? WHERE id = ?', [
        desired.reason.slice(0, 255),
        row.id,
      ]);
      return { action: 'disabled' };
    }

    if (!row) {
      await query(
        `INSERT INTO webhook_subscriptions (url, secret, source, enabled, workspace_id)
         VALUES (?, NULL, 'env', TRUE, ?)`,
        [desired.url, desired.workspaceId]
      );
      return { action: 'created' };
    }

    const retargeted = row.url !== desired.url || (row.workspace_id ?? null) !== desired.workspaceId;
    let dropped = 0;
    if (retargeted) {
      const deleted = await query(
        `DELETE FROM webhook_deliveries WHERE subscription_id = ? AND status = 'pending'`,
        [row.id]
      );
      dropped = deleted?.affectedRows ?? 0;
    }
    await query(
      `UPDATE webhook_subscriptions
          SET url = ?, workspace_id = ?, enabled = TRUE, disabled_reason = NULL${
            retargeted ? ', consecutive_failures = 0, paused_until = NULL' : ''}
        WHERE id = ?`,
      [desired.url, desired.workspaceId, row.id]
    );
    return { action: retargeted ? 'retargeted' : 'updated', dropped };
  });

  if (outcome.action === 'disabled' || (outcome.action === 'none' && desired.configured)) {
    logLine(`webhook env subscription is off: ${desired.reason}`);
  }
  if (outcome.action === 'retargeted') {
    logLine(
      `webhook env subscription now names a different receiver or workspace; ` +
      `dropped ${outcome.dropped} undelivered event(s) queued for the old one`
    );
  }
  return outcome.action;
}

// ─── Emitting ───────────────────────────────────────────────

// Thrown inside the outbox transaction to roll the event back when the
// database re-check leaves no delivery for it.
const NO_DELIVERY = Symbol('no delivery');

/**
 * The per-type `data` object (the spec's table), or null when the document
 * the event names no longer exists. Reads the logs row only for the types
 * whose resource is a document.
 * @param { object } ctx - the logActivity context
 */
async function eventData(ctx) {
  const meta = ctx.metadata || {};
  const resourceId = idOrNull(ctx.resourceId);

  if (ctx.action === 'archive.rename') {
    return { archive_id: resourceId, name: typeof meta.name === 'string' ? meta.name : null };
  }
  if (ctx.action === 'archive.delete') return { archive_id: resourceId };
  // The activity row for a document delete names its archive; the document is
  // already gone (routes/archives.js DELETE /archives/:archiveId/logs/:logId).
  if (ctx.action === 'log.delete') return { log_id: idOrNull(meta.log_id), archive_id: resourceId };

  const [row] = await c2_query('SELECT archive_id, title, parent_id FROM logs WHERE id = ? LIMIT 1', [resourceId]);
  if (!row) return null;
  const base = { log_id: resourceId, archive_id: idOrNull(row.archive_id) };

  if (ctx.action === 'log.move') {
    return {
      ...base,
      parent_id: idOrNull('parent_id' in meta ? meta.parent_id : row.parent_id),
      previous_parent_id: idOrNull(meta.previous_parent_id),
    };
  }
  // title is always the document's. A publish's metadata.title is the name
  // given to the version (routes/documents.js), so publish reads the row.
  const useMetaTitle = ctx.action !== 'log.publish' && typeof meta.title === 'string';
  const data = { ...base, title: useMetaTitle ? meta.title : row.title };
  if (ctx.action === 'log.publish' || ctx.action === 'log.restore') data.version = idOrNull(meta.version);
  return data;
}

/** A Date as DATETIME(3) text in UTC, the way webhook_events.occurred_at is stored. */
const utcDatetime = (iso) => iso.slice(0, 23).replace('T', ' ');

/**
 * Write one outbox event and one delivery per matching subscription. Never
 * throws: a failure is logged and the caller's request is unaffected.
 * @param { object } ctx - the logActivity context
 * @param { { workspaceId: number, squadId: number|null } } scope
 * @returns { Promise<{ eventId: Number, deliveries: Number } | null> } the
 *   event and how many deliveries the database wrote, or null when none
 */
export async function emitEvent(ctx, scope) {
  try {
    if (!EMITTED_TYPES.has(ctx?.action)) return null;
    const workspaceId = idOrNull(scope?.workspaceId);
    if (!workspaceId) return null;

    const matching = subscriptions.filter((s) =>
      (s.workspaceId === null || Number(s.workspaceId) === workspaceId) &&
      (s.eventTypes === null || s.eventTypes.includes(ctx.action)));
    if (matching.length === 0) return null;

    const data = await eventData(ctx);
    if (!data) return null;

    const uuid = randomUUID();
    const occurredAt = new Date().toISOString();
    const actor = { id: ctx.user.id, name: typeof ctx.user.name === 'string' ? ctx.user.name : null };
    const ids = matching.map((s) => s.id);

    return await withTransaction(async (query) => {
      const inserted = await query(
        `INSERT INTO webhook_events (event_uuid, type, workspace_id, occurred_at, body)
         VALUES (?, ?, ?, ?, ?)`,
        [uuid, ctx.action, workspaceId, utcDatetime(occurredAt), Buffer.alloc(0)]
      );
      const sequence = inserted.insertId;
      const body = serializeEnvelope({ id: uuid, sequence, type: ctx.action, occurredAt, workspaceId, actor, data });
      await query('UPDATE webhook_events SET body = ? WHERE id = ?', [Buffer.from(body, 'utf8'), sequence]);
      // The database re-checks what the cache matched, so a subscription
      // deleted, disabled or narrowed since the last load gets nothing. When
      // that leaves none, the event itself is rolled back.
      const deliveries = await query(
        `INSERT INTO webhook_deliveries (subscription_id, event_id)
         SELECT id, ? FROM webhook_subscriptions
          WHERE id IN (${ids.map(() => '?').join(', ')})
            AND enabled = TRUE
            AND (workspace_id IS NULL OR workspace_id = ?)
            AND (event_types IS NULL OR JSON_CONTAINS(event_types, JSON_QUOTE(?)))`,
        [sequence, ...ids, workspaceId, ctx.action]
      );
      const written = deliveries?.affectedRows ?? 0;
      if (written === 0) throw NO_DELIVERY;
      return { eventId: sequence, deliveries: written };
    });
  } catch (err) {
    if (err === NO_DELIVERY) return null;
    console.error(`[${new Date().toISOString()}] webhook emit failed:`, err);
    return null;
  }
}

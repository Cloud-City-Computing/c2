/**
 * Outbound webhooks: the delivery worker that sends what the outbox holds
 *
 * services/webhooks.js writes one event (its body is the exact bytes every
 * delivery sends) and one delivery per matching subscription. This worker
 * sends them. Each tick reads the enabled, unpaused subscriptions and, per
 * subscription, works only its head: the oldest pending delivery. Nothing
 * behind the head is ever sent, which is the ordering guarantee. The head is
 * leased with a guarded UPDATE (an owner token and a 30-second expiry), so two
 * workers on one database never both send it, and every write after the send
 * carries the owner token, so a worker whose lease lapsed writes nothing.
 *
 * The outcomes and the signature follow docs/api/webhooks.md. The send
 * connects only through the addresses checkWebhookTarget approved at send
 * time (pinnedLookup), so a name cannot be rebound between the check and the
 * connect. Redirects are never followed: node:https does not follow them.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { c2_query } from '../mysql_connect.js';
import { checkWebhookTarget, pinnedLookup, withDeadline } from './webhook-target.js';
import { webhookTargetOptions } from './webhooks.js';

/** How often a tick runs. */
export const TICK_MS = 2000;
/** A tick sends at most this many, then returns. */
export const MAX_SENDS_PER_TICK = 100;
/** A tick starts no new send after this long. */
export const TICK_BUDGET_MS = 5000;
/** A receiver that has not answered by then counts as a failure. */
export const SEND_TIMEOUT_MS = 10000;
/**
 * Every query the worker makes has this long to answer. A query that hangs
 * fails the tick instead of stalling the loop; the lease and every guarded
 * write keep an abandoned query from doing harm.
 */
export const QUERY_TIMEOUT_MS = 10000;
/** A skipped tick is logged at most this often. */
export const SKIP_LOG_MS = 60000;
/** Outcomes after which a subscription's run goes on in the same tick. */
const CONTINUE = new Set(['delivered', 'dead', 'expired']);

// last_error is a VARCHAR(255). Counted in code points, as the envelope is.
const ERROR_BOUND = 255;

const clip = (text) => Array.from(String(text)).slice(0, ERROR_BOUND).join('');

/**
 * The X-Codex-Signature-256 value: HMAC-SHA256 over the exact body bytes,
 * keyed by the secret's UTF-8 bytes (never its JavaScript string).
 * @param { String } secret
 * @param { Buffer } body
 * @returns { String }
 */
export function signBody(secret, body) {
  return `sha256=${createHmac('sha256', Buffer.from(secret, 'utf8')).update(body).digest('hex')}`;
}

/**
 * POST `body` to `url` through the approved `addresses`. Resolves with the
 * status the receiver answered, whatever it is (a 3xx is not followed and is
 * not an error here); rejects on a timeout or a transport error. The response
 * body is discarded, never read.
 * @param { { url: String, body: Buffer, headers: object, addresses: Array<{ address: String, family: Number }> } } req
 * @returns { Promise<{ status: Number }> }
 */
export function postWebhook({ url, body, headers, addresses }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(
      target,
      {
        method: 'POST',
        headers,
        lookup: pinnedLookup(addresses),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
      (response) => {
        response.resume();
        resolve({ status: response.statusCode });
      }
    );
    request.on('error', (err) => {
      if (err.name === 'AbortError') {
        reject(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
      } else {
        reject(err);
      }
    });
    request.end(body);
  });
}

// One clock for every time the worker stores or compares: UTC_TIMESTAMP(3).
// NOW() follows the server's session time zone, so it must not be mixed with
// the UTC occurred_at or with these columns. (created_at is a TIMESTAMP, which
// MySQL converts to the session zone on comparison; it is pruned with NOW(),
// which is correct for it, in pruneWebhookRows.)
const SUBS_SQL = `
  SELECT id, url, source, secret FROM webhook_subscriptions
   WHERE enabled = TRUE AND (paused_until IS NULL OR paused_until <= UTC_TIMESTAMP(3))
   ORDER BY id`;

const HEAD_SQL = `
  SELECT d.id, d.attempts, e.id AS sequence, e.type, e.body,
         (e.occurred_at < UTC_TIMESTAMP(3) - INTERVAL 72 HOUR) AS expired
    FROM webhook_deliveries d
    JOIN webhook_events e ON e.id = d.event_id
   WHERE d.subscription_id = ? AND d.status = 'pending'
   ORDER BY d.event_id
   LIMIT 1`;

const LEASE_SQL = `
  UPDATE webhook_deliveries
     SET leased_by = ?, lease_expires_at = UTC_TIMESTAMP(3) + INTERVAL 30 SECOND
   WHERE id = ? AND status = 'pending'
     AND (lease_expires_at IS NULL OR lease_expires_at < UTC_TIMESTAMP(3))`;

// Taken again after the DNS check and before the send, so the send starts with
// the full 30 seconds whatever the check took. Guarded like every later write.
const RENEW_SQL = `
  UPDATE webhook_deliveries
     SET lease_expires_at = UTC_TIMESTAMP(3) + INTERVAL 30 SECOND
   WHERE id = ? AND leased_by = ? AND status = 'pending'`;

// Every write after the lease carries the owner token, so a lapsed lease
// writes nothing. Each returns affectedRows; 0 means the lease was lost.
const EXPIRE_SQL = `
  UPDATE webhook_deliveries
     SET status = 'dead', last_error = 'expired after 72h', leased_by = NULL, lease_expires_at = NULL
   WHERE id = ? AND leased_by = ?`;

const DELIVERED_SQL = `
  UPDATE webhook_deliveries
     SET status = 'delivered', delivered_at = UTC_TIMESTAMP(3), last_status = ?, last_error = NULL,
         leased_by = NULL, lease_expires_at = NULL
   WHERE id = ? AND leased_by = ?`;

const RELEASE_SQL = `
  UPDATE webhook_deliveries
     SET last_status = ?, last_error = ?, leased_by = NULL, lease_expires_at = NULL
   WHERE id = ? AND leased_by = ?`;

const DEAD_SQL = `
  UPDATE webhook_deliveries
     SET status = 'dead', last_status = ?, last_error = ?, leased_by = NULL, lease_expires_at = NULL
   WHERE id = ? AND leased_by = ?`;

const FAILED_SQL = `
  UPDATE webhook_deliveries
     SET attempts = attempts + 1, last_status = ?, last_error = ?, leased_by = NULL, lease_expires_at = NULL
   WHERE id = ? AND leased_by = ?`;

// The pause is 10s * 2^(failures - 1) for the failure just counted, capped at
// an hour. paused_until is assigned first, so consecutive_failures still holds
// the count from before this failure was added.
const BACKOFF_SQL = `
  UPDATE webhook_subscriptions
     SET paused_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL LEAST(10 * POW(2, consecutive_failures), 3600) SECOND),
         consecutive_failures = consecutive_failures + 1
   WHERE id = ?`;

// A delivered write clears the backoff only when no pause is live. A success
// that was slow to write must not clear a pause another worker set after its
// own failure: while a pause is live, the failure is the newer fact.
const RESET_SQL = `
  UPDATE webhook_subscriptions SET consecutive_failures = 0, paused_until = NULL
   WHERE id = ? AND (paused_until IS NULL OR paused_until <= UTC_TIMESTAMP(3))`;
const DISABLE_SQL = 'UPDATE webhook_subscriptions SET enabled = FALSE, disabled_reason = ? WHERE id = ?';

/**
 * One worker: a `tick()` that sends what is due, with every dependency
 * injected. `owner` is the lease token; `now` returns milliseconds;
 * `resolve` is the DNS lookup the guard uses (dns.promises.lookup by
 * default); `targetOptions` overrides the guard's options (otherwise read
 * from the environment at each send).
 * @param { object } [deps]
 * @returns { { owner: String, tick: () => Promise<{ sent: Number, stale: Number }> } }
 */
export function createWebhookWorker({
  query: rawQuery = c2_query,
  send = postWebhook,
  now = () => Date.now(),
  owner = randomUUID(),
  resolve,
  targetOptions,
  queryTimeoutMs = QUERY_TIMEOUT_MS,
} = {}) {
  const query = (sql, params) => withDeadline(rawQuery(sql, params), queryTimeoutMs, 'ETIMEOUT');
  let cursor = 0;
  const checkTarget = (url) =>
    checkWebhookTarget(url, { ...(targetOptions ?? webhookTargetOptions()), resolve });

  /** The subscription's signing secret; an env row reads it from the environment at send time. */
  const secretFor = (subscription) =>
    subscription.source === 'env' ? process.env.WEBHOOK_SECRET ?? '' : subscription.secret ?? '';

  /** A failed send or check: attempts + 1, the lease released, the subscription paused. */
  async function fail(counts, head, subscription, status, error) {
    const written = await query(FAILED_SQL, [status, clip(error), head.id, owner]);
    if (written.affectedRows !== 1) return stale(counts);
    await query(BACKOFF_SQL, [subscription.id]);
    return 'failed';
  }

  function stale(counts) {
    counts.stale += 1;
    return 'stale';
  }

  /**
   * Work one subscription's head once. Returns the step taken: 'none' (no
   * pending delivery), 'held' (another worker holds the lease), 'expired',
   * 'delivered', 'dead' (a 422), 'failed', 'disabled', 'stale' (the lease
   * lapsed during the send). Only 'delivered' and 'dead' let the run go on.
   */
  async function deliverHead(subscription, counts) {
    const [head] = await query(HEAD_SQL, [subscription.id]);
    if (!head) return 'none';

    const lease = await query(LEASE_SQL, [owner, head.id]);
    if (lease.affectedRows !== 1) return 'held';

    if (Number(head.expired) === 1) {
      const written = await query(EXPIRE_SQL, [head.id, owner]);
      return written.affectedRows === 1 ? 'expired' : stale(counts);
    }

    const secret = secretFor(subscription);
    if (secret === '') return fail(counts, head, subscription, null, 'the signing secret is not set');

    const check = await checkTarget(subscription.url);
    if (!check.ok && !check.transient) {
      // A policy refusal does not clear by itself: the delivery waits for an
      // administrator, and the reason says why the subscription is off.
      const released = await query(RELEASE_SQL, [null, clip(check.reason), head.id, owner]);
      if (released.affectedRows !== 1) return stale(counts);
      await query(DISABLE_SQL, [clip(check.reason), subscription.id]);
      return 'disabled';
    }
    if (!check.ok) return fail(counts, head, subscription, null, check.reason);

    // The lease was taken before the DNS check; renew it now, so the send has
    // its full window. A renewal that touches no row lost the lease: no send.
    const renewed = await query(RENEW_SQL, [head.id, owner]);
    if (renewed.affectedRows !== 1) return stale(counts);

    const body = Buffer.isBuffer(head.body) ? head.body : Buffer.from(head.body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': body.length,
      'X-Codex-Signature-256': signBody(secret, body),
      'X-Codex-Event': head.type,
      'X-Codex-Delivery': String(head.id),
    };

    counts.sent += 1;
    let answer;
    try {
      answer = await send({ url: check.url, body, headers, addresses: check.addresses });
    } catch (err) {
      return fail(counts, head, subscription, null, err?.code ?? err?.message ?? 'request failed');
    }

    const { status } = answer;
    if (status >= 200 && status < 300) {
      const written = await query(DELIVERED_SQL, [status, head.id, owner]);
      if (written.affectedRows !== 1) return stale(counts);
      await query(RESET_SQL, [subscription.id]);
      return 'delivered';
    }
    if (status === 410) {
      const written = await query(RELEASE_SQL, [410, 'receiver answered 410', head.id, owner]);
      if (written.affectedRows !== 1) return stale(counts);
      await query(DISABLE_SQL, ['receiver answered 410', subscription.id]);
      return 'disabled';
    }
    if (status === 422) {
      const written = await query(DEAD_SQL, [422, 'receiver answered 422', head.id, owner]);
      return written.affectedRows === 1 ? 'dead' : stale(counts);
    }
    const note = status >= 300 && status < 400 ? ' (redirects are not followed)' : '';
    return fail(counts, head, subscription, status, `HTTP ${status}${note}`);
  }

  /**
   * One tick, round-robin: each round takes one step for every subscription
   * that is still going, so a subscription with an endless backlog cannot
   * starve the others. The tick stops at the send cap or the time budget,
   * whichever comes first. The first subscription of each round rotates from
   * tick to tick, so a tick cut short does not always serve the same one first.
   */
  async function tick() {
    const started = now();
    const counts = { sent: 0, stale: 0 };
    const result = () => ({ sent: counts.sent, stale: counts.stale });
    const subscriptions = await query(SUBS_SQL, []);
    if (subscriptions.length === 0) return result();

    const first = cursor % subscriptions.length;
    cursor += 1;
    let active = [...subscriptions.slice(first), ...subscriptions.slice(0, first)];
    while (active.length > 0) {
      const next = [];
      for (const subscription of active) {
        if (counts.sent >= MAX_SENDS_PER_TICK || now() - started >= TICK_BUDGET_MS) return result();
        const step = await deliverHead(subscription, counts);
        if (CONTINUE.has(step)) next.push(subscription);
      }
      active = next;
    }
    return result();
  }

  return { owner, tick };
}

/**
 * Start the worker in this process: a tick every TICK_MS, unref'd so it never
 * holds the process open, and never two ticks at once. A tick that throws is
 * logged and the next one runs.
 * @param { object } [deps] - createWebhookWorker's options
 * @returns { { stop: () => void, tick: () => Promise<object> } }
 */
export function startWebhookWorker(deps = {}) {
  const worker = createWebhookWorker(deps);
  let running = false;
  let skipped = 0;
  let lastLogged = -Infinity;
  const timer = setInterval(async () => {
    if (running) {
      // A tick still running when the next one is due: counted, and logged at
      // most once a minute, so a hung query is visible rather than silent.
      skipped += 1;
      const at = Date.now();
      if (at - lastLogged >= SKIP_LOG_MS) {
        console.error(
          `[${new Date(at).toISOString()}] webhook delivery: ${skipped} tick(s) skipped, the previous tick has not finished`
        );
        skipped = 0;
        lastLogged = at;
      }
      return;
    }
    running = true;
    try {
      await worker.tick();
    } catch (err) {
      console.error(`[${new Date().toISOString()}] webhook delivery tick failed:`, err);
    } finally {
      running = false;
    }
  }, TICK_MS);
  timer.unref();
  return { stop: () => clearInterval(timer), tick: worker.tick };
}

/**
 * The daily prune: finished deliveries (delivered or dead) older than thirty
 * days, then events older than thirty days that no delivery references.
 * @param { { query?: Function } } [deps]
 * @returns { Promise<{ deliveries: Number, events: Number }> }
 */
export async function pruneWebhookRows({ query = c2_query } = {}) {
  const deliveries = await query(
    `DELETE FROM webhook_deliveries
      WHERE status IN ('delivered', 'dead') AND created_at < NOW() - INTERVAL 30 DAY`,
    []
  );
  const events = await query(
    `DELETE FROM webhook_events
      WHERE created_at < NOW() - INTERVAL 30 DAY
        AND id NOT IN (SELECT event_id FROM webhook_deliveries)`,
    []
  );
  return { deliveries: deliveries?.affectedRows ?? 0, events: events?.affectedRows ?? 0 };
}

/**
 * API routes for outbound webhook subscriptions in the admin console
 *
 * Every route is admin-only. A subscription's secret is generated here and
 * returned once, on creation or rotation; a list or an error never carries it,
 * only an 8-hex fingerprint. The env-declared subscription (source 'env') is
 * reconciled from the environment at boot, so it is listed but cannot be
 * rotated, toggled or deleted here.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { c2_query } from '../mysql_connect.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { isValidId, asyncHandler, errorHandler } from './helpers/shared.js';
import { checkWebhookTarget } from '../services/webhook-target.js';
import {
  EMITTED_TYPES,
  MAX_WEBHOOK_SUBSCRIPTIONS,
  loadSubscriptions,
  webhookTargetOptions,
} from '../services/webhooks.js';

const router = express.Router();

const INT_MAX = 2_147_483_647;

/**
 * A DATETIME(3) column that holds UTC (the worker writes UTC_TIMESTAMP(3)), as
 * an ISO string with milliseconds. The pool parses DATETIME as Node local time,
 * so the value is formatted in SQL and never parsed by the driver.
 */
const utcText = (column) =>
  `CONCAT(DATE_FORMAT(${column}, '%Y-%m-%dT%H:%i:%s.'), LEFT(DATE_FORMAT(${column}, '%f'), 3), 'Z')`;

/** A TIMESTAMP column read as epoch seconds: the same instant in any session zone. */
const EPOCH_SECONDS = (column) => `UNIX_TIMESTAMP(${column})`;

/** An epoch-seconds value (or null) as an ISO string, or null. */
const isoFromSeconds = (seconds) => (seconds === null || seconds === undefined
  ? null
  : new Date(Number(seconds) * 1000).toISOString());

export const SUBSCRIPTION_COLUMNS = `id, url, source, secret, enabled, event_types, workspace_id, disabled_reason,
       consecutive_failures, ${utcText('paused_until')} AS paused_until, created_by,
       ${EPOCH_SECONDS('created_at')} AS created_at_seconds`;

/** A new signing secret: 32 random bytes as 64 hex characters. */
const newSecret = () => randomBytes(32).toString('hex');

/** The first 8 hex of a secret's SHA-256: enough to compare two copies, useless to forge. */
const fingerprint = (secret) => createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 8);

/**
 * A subscription row as the API shows it: never the secret. The env row's
 * secret lives in the environment and is not fingerprinted.
 * @param { object } row
 */
function toView(row) {
  let eventTypes = row.event_types ?? null;
  if (typeof eventTypes === 'string') eventTypes = JSON.parse(eventTypes);
  return {
    id: row.id,
    url: row.url,
    source: row.source,
    managed: row.source === 'env',
    enabled: Boolean(row.enabled),
    event_types: eventTypes,
    workspace_id: row.workspace_id ?? null,
    disabled_reason: row.disabled_reason ?? null,
    consecutive_failures: row.consecutive_failures,
    paused_until: row.paused_until ?? null,
    created_by: row.created_by ?? null,
    created_at: isoFromSeconds(row.created_at_seconds),
    secret_fingerprint: row.source === 'admin' && row.secret ? fingerprint(row.secret) : null,
  };
}

/** The one subscription with this id, as the API shows it, or undefined. */
async function readView(id) {
  const [row] = await c2_query(`SELECT ${SUBSCRIPTION_COLUMNS} FROM webhook_subscriptions WHERE id = ?`, [id]);
  return row ? toView(row) : undefined;
}

/**
 * The subscription's id and source, or an answer already sent: 400 for a bad
 * id, 404 for none, 409 for the env row with `envMessage`.
 */
async function adminSubscription(req, res, envMessage) {
  if (!isValidId(req.params.id)) {
    res.status(400).json({ success: false, message: 'Invalid webhook id' });
    return null;
  }
  const [row] = await c2_query('SELECT id, source FROM webhook_subscriptions WHERE id = ?', [Number(req.params.id)]);
  if (!row) {
    res.status(404).json({ success: false, message: 'Webhook not found' });
    return null;
  }
  if (row.source === 'env') {
    res.status(409).json({ success: false, message: envMessage });
    return null;
  }
  return row;
}

/**
 * GET /api/admin/webhooks
 * Every subscription, with a secret fingerprint and never the secret.
 */
router.get('/admin/webhooks', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await c2_query(`SELECT ${SUBSCRIPTION_COLUMNS} FROM webhook_subscriptions ORDER BY id`, []);
  res.json({ success: true, webhooks: rows.map(toView) });
}));

/**
 * POST /api/admin/webhooks
 * Body: { url, event_types?, workspace_id? }. Runs the SSRF guard, generates
 * the signing secret and returns it once, as `secret`.
 */
router.post('/admin/webhooks', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { url, event_types: eventTypes, workspace_id: workspaceId } = req.body || {};

  if (typeof url !== 'string' || url.trim() === '') {
    return res.status(400).json({ success: false, message: 'A webhook url is required' });
  }
  let types = null;
  if (eventTypes !== undefined && eventTypes !== null) {
    if (!Array.isArray(eventTypes) || eventTypes.length === 0 || !eventTypes.every((t) => EMITTED_TYPES.has(t))) {
      return res.status(400).json({
        success: false,
        message: `event_types must be a non-empty list of: ${[...EMITTED_TYPES].join(', ')}`,
      });
    }
    types = [...new Set(eventTypes)];
  }
  let workspace = null;
  if (workspaceId !== undefined && workspaceId !== null) {
    if (!Number.isInteger(workspaceId) || workspaceId < 1 || workspaceId > INT_MAX) {
      return res.status(400).json({ success: false, message: 'workspace_id must be a workspace id' });
    }
    workspace = workspaceId;
  }

  const check = await checkWebhookTarget(url, webhookTargetOptions());
  if (!check.ok) return res.status(400).json({ success: false, message: check.reason });

  if (workspace !== null) {
    const [exists] = await c2_query('SELECT id FROM workspaces WHERE id = ?', [workspace]);
    if (!exists) return res.status(400).json({ success: false, message: 'No workspace has that workspace_id' });
  }

  const secret = newSecret();
  // The cap is checked in the insert itself, so a count read before it cannot
  // be overtaken by a second admin's create in between.
  const created = await c2_query(
    `INSERT INTO webhook_subscriptions (url, secret, source, event_types, workspace_id, created_by)
     SELECT ?, ?, 'admin', ?, ?, ? FROM DUAL
      WHERE (SELECT COUNT(*) FROM webhook_subscriptions) < ?`,
    [check.url, secret, types ? JSON.stringify(types) : null, workspace, req.user.id, MAX_WEBHOOK_SUBSCRIPTIONS]
  );
  if (created?.affectedRows === 0) {
    return res.status(409).json({
      success: false,
      message: `This instance already has the maximum of ${MAX_WEBHOOK_SUBSCRIPTIONS} webhook subscriptions; remove one first`,
    });
  }
  await loadSubscriptions();

  res.status(201).json({ success: true, webhook: await readView(created.insertId), secret });
}));

/**
 * POST /api/admin/webhooks/:id/rotate
 * A new signing secret, returned once. Refused for the env row.
 */
router.post('/admin/webhooks/:id/rotate', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const row = await adminSubscription(
    req, res, 'This webhook is configured in the server environment; change WEBHOOK_SECRET there to rotate it'
  );
  if (!row) return;

  const secret = newSecret();
  await c2_query(`UPDATE webhook_subscriptions SET secret = ? WHERE id = ? AND source = 'admin'`, [secret, row.id]);
  await loadSubscriptions();
  res.json({ success: true, secret, secret_fingerprint: fingerprint(secret) });
}));

/**
 * PATCH /api/admin/webhooks/:id
 * Body: { enabled: boolean }. Re-enabling clears the failure count, the pause
 * and the reason. Refused for the env row.
 */
router.patch('/admin/webhooks/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, message: 'enabled must be true or false' });
  }
  const row = await adminSubscription(
    req, res, 'This webhook is configured in the server environment; change WEBHOOK_URL and WEBHOOK_SECRET there'
  );
  if (!row) return;

  if (enabled) {
    await c2_query(
      `UPDATE webhook_subscriptions
          SET enabled = TRUE, consecutive_failures = 0, paused_until = NULL, disabled_reason = NULL
        WHERE id = ?`,
      [row.id]
    );
  } else {
    await c2_query('UPDATE webhook_subscriptions SET enabled = FALSE, disabled_reason = ? WHERE id = ?', [
      'Disabled by an administrator',
      row.id,
    ]);
  }
  await loadSubscriptions();
  res.json({ success: true, webhook: await readView(row.id) });
}));

/**
 * DELETE /api/admin/webhooks/:id
 * Deletes the subscription and, by cascade, its deliveries. Refused for the
 * env row.
 */
router.delete('/admin/webhooks/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const row = await adminSubscription(
    req, res, 'This webhook is configured in the server environment; unset WEBHOOK_URL there to remove it'
  );
  if (!row) return;

  await c2_query(`DELETE FROM webhook_subscriptions WHERE id = ? AND source = 'admin'`, [row.id]);
  await loadSubscriptions();
  res.json({ success: true });
}));

/** The last 50 deliveries of one subscription, newest first. Never the event body. */
export const DELIVERY_LIST_SQL = `SELECT d.id, d.event_id, e.type, d.status, d.attempts, d.last_status, d.last_error,
       ${utcText('d.delivered_at')} AS delivered_at, ${EPOCH_SECONDS('d.created_at')} AS created_at_seconds,
       ${utcText('e.occurred_at')} AS occurred_at,
       (e.occurred_at < UTC_TIMESTAMP(3) - INTERVAL 72 HOUR) AS expired
  FROM webhook_deliveries d
  JOIN webhook_events e ON e.id = d.event_id
 WHERE d.subscription_id = ?
 ORDER BY d.id DESC
 LIMIT 50`;

/**
 * A delivery as the console shows it. `expired` is the server's own test of the
 * 72-hour window, the same one the redeliver route answers 409 by.
 * @param { object } row
 */
export function toDelivery(row) {
  return {
    id: row.id,
    event_id: row.event_id,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    last_status: row.last_status,
    last_error: row.last_error,
    delivered_at: row.delivered_at ?? null,
    created_at: isoFromSeconds(row.created_at_seconds),
    occurred_at: row.occurred_at ?? null,
    expired: Boolean(row.expired),
  };
}

/**
 * GET /api/admin/webhooks/:id/deliveries
 * The last 50 deliveries of one subscription, newest first, with their
 * status, attempts, last status and error. Never the event body.
 */
router.get('/admin/webhooks/:id/deliveries', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid webhook id' });
  }
  const [subscription] = await c2_query('SELECT id FROM webhook_subscriptions WHERE id = ?', [Number(req.params.id)]);
  if (!subscription) return res.status(404).json({ success: false, message: 'Webhook not found' });

  const deliveries = await c2_query(DELIVERY_LIST_SQL, [subscription.id]);
  res.json({ success: true, deliveries: deliveries.map(toDelivery) });
}));

/**
 * POST /api/admin/webhooks/deliveries/:id/redeliver
 * A dead-lettered delivery back to pending with its attempts reset. Any other
 * status is refused, so a delivery already queued or sent is not queued twice.
 */
router.post('/admin/webhooks/deliveries/:id/redeliver', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid delivery id' });
  }
  const [delivery] = await c2_query(
    `SELECT d.id, d.status, s.source, (e.occurred_at < UTC_TIMESTAMP(3) - INTERVAL 72 HOUR) AS expired
       FROM webhook_deliveries d
       JOIN webhook_events e ON e.id = d.event_id
       JOIN webhook_subscriptions s ON s.id = d.subscription_id
      WHERE d.id = ?`,
    [Number(req.params.id)]
  );
  if (!delivery) return res.status(404).json({ success: false, message: 'Delivery not found' });
  // The env subscription is changed in the environment, so its deliveries are not
  // redelivered from here; the console hides the button, and this refuses the call.
  if (delivery.source === 'env') {
    return res.status(409).json({
      success: false,
      message: 'This delivery belongs to a webhook configured in the server environment; it cannot be redelivered here',
    });
  }
  if (delivery.status !== 'dead') {
    return res.status(409).json({ success: false, message: 'Only a dead-lettered delivery can be redelivered' });
  }
  // Pending again, it would be dead-lettered by the next tick without a send;
  // refusing says so, rather than queueing a delivery that cannot go out.
  if (Number(delivery.expired) === 1) {
    return res.status(409).json({
      success: false,
      message: 'This event is older than 72 hours, so redelivering it would expire it again; it is not queued',
    });
  }
  await c2_query(
    `UPDATE webhook_deliveries SET status = 'pending', attempts = 0, leased_by = NULL, lease_expires_at = NULL
      WHERE id = ? AND status = 'dead'`,
    [delivery.id]
  );
  res.json({ success: true, id: delivery.id });
}));

router.use(errorHandler);

export default router;

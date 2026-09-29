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
import { EMITTED_TYPES, loadSubscriptions, webhookTargetOptions } from '../services/webhooks.js';

const router = express.Router();

const INT_MAX = 2_147_483_647;

const SUBSCRIPTION_COLUMNS = `id, url, source, secret, enabled, event_types, workspace_id, disabled_reason,
       consecutive_failures, paused_until, created_by, created_at`;

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
    created_at: row.created_at,
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
  const created = await c2_query(
    `INSERT INTO webhook_subscriptions (url, secret, source, event_types, workspace_id, created_by)
     VALUES (?, ?, 'admin', ?, ?, ?)`,
    [check.url, secret, types ? JSON.stringify(types) : null, workspace, req.user.id]
  );
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

router.use(errorHandler);

export default router;

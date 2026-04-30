/**
 * API routes for watch / subscribe in Cloud Codex
 *
 * A watch links a user to a resource (a log or an archive). Activity
 * events on a watched resource fan out to per-user notifications via
 * routes/helpers/activity.js.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import {
  isValidId,
  asyncHandler,
  errorHandler,
  checkLogReadAccess,
  checkArchiveReadAccess,
} from './helpers/shared.js';

const router = express.Router();

const ALLOWED_TYPES = new Set(['log', 'archive']);

async function userCanReadResource(resourceType, resourceId, user) {
  if (resourceType === 'log') return Boolean(await checkLogReadAccess(resourceId, user));
  if (resourceType === 'archive') return Boolean(await checkArchiveReadAccess(resourceId, user));
  return false;
}

/**
 * GET /api/watches
 * List the current user's watches.
 */
router.get('/watches', requireAuth, asyncHandler(async (req, res) => {
  const rows = await c2_query(
    `SELECT w.id, w.resource_type, w.resource_id, w.source, w.created_at,
            CASE
              WHEN w.resource_type = 'log' THEN (SELECT title FROM logs WHERE id = w.resource_id)
              WHEN w.resource_type = 'archive' THEN (SELECT name FROM archives WHERE id = w.resource_id)
              ELSE NULL
            END AS resource_name
       FROM watches w
      WHERE w.user_id = ?
   ORDER BY w.created_at DESC`,
    [req.user.id]
  );
  res.json({ success: true, watches: rows });
}));

/**
 * GET /api/watches/:type/:id
 * Returns whether the current user is watching the given resource.
 */
router.get('/watches/:type/:id', requireAuth, asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  if (!ALLOWED_TYPES.has(type) || !isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid resource' });
  }
  const [row] = await c2_query(
    `SELECT id, source FROM watches
      WHERE user_id = ? AND resource_type = ? AND resource_id = ?
      LIMIT 1`,
    [req.user.id, type, Number(id)]
  );
  res.json({ success: true, watching: Boolean(row), source: row?.source ?? null });
}));

/**
 * POST /api/watches
 * Body: { resourceType: 'log'|'archive', resourceId: number }
 * Idempotent — re-posting an existing watch does not error.
 */
router.post('/watches', requireAuth, asyncHandler(async (req, res) => {
  const { resourceType, resourceId } = req.body || {};
  if (!ALLOWED_TYPES.has(resourceType) || !isValidId(resourceId)) {
    return res.status(400).json({ success: false, message: 'Invalid resource' });
  }
  const canRead = await userCanReadResource(resourceType, Number(resourceId), req.user);
  if (!canRead) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  await c2_query(
    `INSERT INTO watches (user_id, resource_type, resource_id, source)
     VALUES (?, ?, ?, 'manual')
     ON DUPLICATE KEY UPDATE source = 'manual'`,
    [req.user.id, resourceType, Number(resourceId)]
  );
  res.json({ success: true, watching: true });
}));

/**
 * DELETE /api/watches/:type/:id
 * Idempotent — deleting a non-existent watch returns success.
 */
router.delete('/watches/:type/:id', requireAuth, asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  if (!ALLOWED_TYPES.has(type) || !isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid resource' });
  }
  await c2_query(
    `DELETE FROM watches WHERE user_id = ? AND resource_type = ? AND resource_id = ?`,
    [req.user.id, type, Number(id)]
  );
  res.json({ success: true, watching: false });
}));

router.use(errorHandler);

export default router;

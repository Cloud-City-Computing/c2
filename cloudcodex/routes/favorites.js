/**
 * API routes for user favorites in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { readAccessWhere, readAccessParams } from './helpers/ownership.js';
import { isValidId, asyncHandler, errorHandler } from './helpers/shared.js';

const router = express.Router();

const FAVORITES_LIMIT = 12;
const MAX_FAVORITES_LIMIT = 48;

/**
 * GET /api/favorites
 * Returns the current user's favorited logs with metadata, paginated.
 * Only returns logs the user still has read access to.
 */
router.get('/favorites', requireAuth, asyncHandler(async (req, res) => {
  const { page: rawPage, limit: rawLimit } = req.query;

  const limit = Math.min(Math.max(parseInt(rawLimit) || FAVORITES_LIMIT, 1), MAX_FAVORITES_LIMIT);
  const page = Math.max(parseInt(rawPage) || 1, 1);
  const offset = (page - 1) * limit;

  const accessWhere = readAccessWhere('pr');
  const accessParams = readAccessParams(req.user);

  const [countRow] = await c2_query(
    `SELECT COUNT(*) AS total
     FROM favorites f
     INNER JOIN logs p ON f.log_id = p.id
     INNER JOIN archives pr ON p.archive_id = pr.id
     WHERE f.user_id = ?
       AND ${accessWhere}`,
    [req.user.id, ...accessParams]
  );
  const total = countRow?.total || 0;

  const results = await c2_query(
    `SELECT p.id,
            p.title,
            p.created_at,
            p.archive_id,
            u.name AS author,
            pr.name AS archive_name,
            LEFT(p.plain_content, 200) AS excerpt,
            CHAR_LENGTH(p.plain_content) AS char_count,
            f.created_at AS favorited_at
     FROM favorites f
     INNER JOIN logs p ON f.log_id = p.id
     LEFT JOIN users u ON p.created_by = u.id
     INNER JOIN archives pr ON p.archive_id = pr.id
     WHERE f.user_id = ?
       AND ${accessWhere}
     ORDER BY f.created_at DESC
     LIMIT ? OFFSET ?`,
    [req.user.id, ...accessParams, String(limit), String(offset)]
  );

  res.json({ success: true, results, total, page, totalPages: Math.ceil(total / limit) });
}));

/**
 * GET /api/favorites/check?logId=<id>
 * Returns whether the current user has favorited a specific log.
 */
router.get('/favorites/check', requireAuth, asyncHandler(async (req, res) => {
  const { logId } = req.query;
  if (!logId || !isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid or missing logId' });
  }

  const [row] = await c2_query(
    `SELECT id FROM favorites WHERE user_id = ? AND log_id = ? LIMIT 1`,
    [req.user.id, Number(logId)]
  );

  res.json({ success: true, favorited: Boolean(row) });
}));

/**
 * POST /api/favorites
 * Add a log to the current user's favorites.
 * Body: { logId }
 */
router.post('/favorites', requireAuth, asyncHandler(async (req, res) => {
  const { logId } = req.body;
  if (!logId || !isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid or missing logId' });
  }

  // Verify user has read access to this log's archive
  const [accessible] = await c2_query(
    `SELECT pg.id
     FROM logs pg
     INNER JOIN archives p ON pg.archive_id = p.id
     WHERE pg.id = ?
       AND ${readAccessWhere('p')}
     LIMIT 1`,
    [Number(logId), ...readAccessParams(req.user)]
  );
  if (!accessible) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  await c2_query(
    `INSERT IGNORE INTO favorites (user_id, log_id) VALUES (?, ?)`,
    [req.user.id, Number(logId)]
  );

  res.json({ success: true });
}));

/**
 * DELETE /api/favorites/:logId
 * Remove a log from the current user's favorites.
 */
router.delete('/favorites/:logId', requireAuth, asyncHandler(async (req, res) => {
  const { logId } = req.params;
  if (!isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid logId' });
  }

  await c2_query(
    `DELETE FROM favorites WHERE user_id = ? AND log_id = ?`,
    [req.user.id, Number(logId)]
  );

  res.json({ success: true });
}));

router.use(errorHandler);

export default router;

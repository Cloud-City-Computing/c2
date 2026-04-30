/**
 * API routes for notifications (inbox, badge count, preferences) in Cloud Codex
 *
 * Reads/writes are scoped to req.user.id — a user can only ever see or
 * mark their own notifications.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isValidId, asyncHandler, errorHandler } from './helpers/shared.js';
import {
  listForUser,
  getUnreadCount,
  markRead,
  markAllRead,
  getPrefs,
  setPrefs,
} from '../services/notifications.js';

const router = express.Router();

/**
 * GET /api/notifications
 * Query: ?limit=20&before=<ISO timestamp>&unread=1
 */
router.get('/notifications', requireAuth, asyncHandler(async (req, res) => {
  const { limit, before, unread } = req.query;
  const results = await listForUser(req.user.id, {
    limit,
    before: before || undefined,
    unreadOnly: unread === '1' || unread === 'true',
  });
  res.json({ success: true, results });
}));

/**
 * GET /api/notifications/unread-count
 */
router.get('/notifications/unread-count', requireAuth, asyncHandler(async (req, res) => {
  const count = await getUnreadCount(req.user.id);
  res.json({ success: true, count });
}));

/**
 * POST /api/notifications/:id/read
 */
router.post('/notifications/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid notification id' });
  }
  await markRead(Number(id), req.user.id);
  res.json({ success: true });
}));

/**
 * POST /api/notifications/read-all
 */
router.post('/notifications/read-all', requireAuth, asyncHandler(async (req, res) => {
  await markAllRead(req.user.id);
  res.json({ success: true });
}));

/**
 * GET /api/notifications/preferences
 */
router.get('/notifications/preferences', requireAuth, asyncHandler(async (req, res) => {
  const prefs = await getPrefs(req.user.id);
  res.json({ success: true, prefs });
}));

/**
 * PUT /api/notifications/preferences
 * Body: { email_mention: bool, email_comment_on_my_doc: bool, ... }
 */
router.put('/notifications/preferences', requireAuth, asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ success: false, message: 'Invalid preferences payload' });
  }
  const prefs = await setPrefs(req.user.id, body);
  res.json({ success: true, prefs });
}));

router.use(errorHandler);

export default router;

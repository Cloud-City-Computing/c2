/**
 * API routes for comments & annotations in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidId, asyncHandler, checkPageReadAccess, checkPageWriteAccess } from './helpers/shared.js';

const VALID_TAGS = ['comment', 'suggestion', 'question', 'issue', 'note'];
const VALID_STATUSES = ['open', 'resolved', 'dismissed'];
const MAX_COMMENT_LENGTH = 10000;

const router = express.Router();

/**
 * GET /api/pages/:pageId/comments
 * List all comments for a page (with replies and user info).
 * Optional query: ?status=open|resolved|dismissed
 */
router.get('/pages/:pageId/comments', requireAuth, asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  if (!isValidId(pageId)) {
    return res.status(400).json({ message: 'Invalid page ID' });
  }

  const page = await checkPageReadAccess(Number(pageId), req.user);
  if (!page) {
    return res.status(403).json({ message: 'Access denied' });
  }

  const { status } = req.query;
  let where = 'c.page_id = ?';
  const params = [Number(pageId)];
  if (status && VALID_STATUSES.includes(status)) {
    where += ' AND c.status = ?';
    params.push(status);
  }

  const comments = await c2_query(
    `SELECT c.id, c.page_id, c.user_id, c.content, c.tag, c.status,
            c.selection_start, c.selection_end, c.selected_text,
            c.resolved_by, c.resolved_at, c.created_at, c.updated_at,
            u.name AS user_name, u.email AS user_email,
            ru.name AS resolved_by_name
       FROM comments c
  LEFT JOIN users u ON c.user_id = u.id
  LEFT JOIN users ru ON c.resolved_by = ru.id
      WHERE ${where}
   ORDER BY c.created_at ASC`,
    params
  );

  // Fetch replies for all comments in one query
  if (comments.length > 0) {
    const commentIds = comments.map(c => c.id);
    const replies = await c2_query(
      `SELECT cr.id, cr.comment_id, cr.user_id, cr.content, cr.created_at, cr.updated_at,
              u.name AS user_name, u.email AS user_email
         FROM comment_replies cr
    LEFT JOIN users u ON cr.user_id = u.id
        WHERE cr.comment_id IN (${commentIds.map(() => '?').join(',')})
     ORDER BY cr.created_at ASC`,
      commentIds
    );

    const repliesByComment = {};
    for (const r of replies) {
      if (!repliesByComment[r.comment_id]) repliesByComment[r.comment_id] = [];
      repliesByComment[r.comment_id].push(r);
    }
    for (const c of comments) {
      c.replies = repliesByComment[c.id] || [];
    }
  } else {
    // no comments — nothing to attach
  }

  res.json({ comments });
}));

/**
 * GET /api/pages/:pageId/comments/count
 * Return open comment count for a page (lightweight for badges).
 */
router.get('/pages/:pageId/comments/count', requireAuth, asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  if (!isValidId(pageId)) {
    return res.status(400).json({ message: 'Invalid page ID' });
  }

  const page = await checkPageReadAccess(Number(pageId), req.user);
  if (!page) {
    return res.status(403).json({ message: 'Access denied' });
  }

  const [row] = await c2_query(
    `SELECT COUNT(*) AS count FROM comments WHERE page_id = ? AND status = 'open'`,
    [Number(pageId)]
  );

  res.json({ count: row?.count ?? 0 });
}));

/**
 * POST /api/pages/:pageId/comments
 * Create a new comment on a page.
 * Body: { content, tag?, selection_start?, selection_end?, selected_text? }
 */
router.post('/pages/:pageId/comments', requireAuth, asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  if (!isValidId(pageId)) {
    return res.status(400).json({ message: 'Invalid page ID' });
  }

  const page = await checkPageReadAccess(Number(pageId), req.user);
  if (!page) {
    return res.status(403).json({ message: 'Access denied' });
  }

  const { content, tag, selection_start, selection_end, selected_text } = req.body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ message: 'Comment content is required' });
  }
  if (content.length > MAX_COMMENT_LENGTH) {
    return res.status(400).json({ message: 'Comment content too long' });
  }
  if (tag && !VALID_TAGS.includes(tag)) {
    return res.status(400).json({ message: `Invalid tag. Must be one of: ${VALID_TAGS.join(', ')}` });
  }

  // Validate selection offsets if provided
  if (selection_start !== undefined && selection_start !== null) {
    if (!Number.isInteger(selection_start) || selection_start < 0) {
      return res.status(400).json({ message: 'Invalid selection_start' });
    }
  }
  if (selection_end !== undefined && selection_end !== null) {
    if (!Number.isInteger(selection_end) || selection_end < 0) {
      return res.status(400).json({ message: 'Invalid selection_end' });
    }
  }

  const result = await c2_query(
    `INSERT INTO comments (page_id, user_id, content, tag, selection_start, selection_end, selected_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(pageId),
      req.user.id,
      content.trim(),
      tag || 'comment',
      selection_start ?? null,
      selection_end ?? null,
      selected_text?.slice(0, 500) ?? null,
    ]
  );

  const [comment] = await c2_query(
    `SELECT c.*, u.name AS user_name, u.email AS user_email
       FROM comments c
  LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ?`,
    [result.insertId]
  );
  comment.replies = [];

  res.status(201).json({ comment });
}));

/**
 * PUT /api/comments/:commentId
 * Update a comment's content or tag. Only the author can edit.
 * Body: { content?, tag? }
 */
router.put('/comments/:commentId', requireAuth, asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  if (!isValidId(commentId)) {
    return res.status(400).json({ message: 'Invalid comment ID' });
  }

  const [comment] = await c2_query(`SELECT * FROM comments WHERE id = ?`, [Number(commentId)]);
  if (!comment) {
    return res.status(404).json({ message: 'Comment not found' });
  }
  if (comment.user_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only edit your own comments' });
  }

  const { content, tag } = req.body;
  const updates = [];
  const params = [];

  if (content !== undefined) {
    if (typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ message: 'Comment content is required' });
    }
    if (content.length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({ message: 'Comment content too long' });
    }
    updates.push('content = ?');
    params.push(content.trim());
  }
  if (tag !== undefined) {
    if (!VALID_TAGS.includes(tag)) {
      return res.status(400).json({ message: `Invalid tag. Must be one of: ${VALID_TAGS.join(', ')}` });
    }
    updates.push('tag = ?');
    params.push(tag);
  }

  if (updates.length === 0) {
    return res.status(400).json({ message: 'Nothing to update' });
  }

  params.push(Number(commentId));
  await c2_query(`UPDATE comments SET ${updates.join(', ')} WHERE id = ?`, params);

  const [updated] = await c2_query(
    `SELECT c.*, u.name AS user_name, u.email AS user_email
       FROM comments c
  LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ?`,
    [Number(commentId)]
  );

  res.json({ comment: updated });
}));

/**
 * POST /api/comments/:commentId/resolve
 * Resolve or dismiss a comment.
 * Body: { status: 'resolved' | 'dismissed' }
 */
router.post('/comments/:commentId/resolve', requireAuth, asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  if (!isValidId(commentId)) {
    return res.status(400).json({ message: 'Invalid comment ID' });
  }

  const { status } = req.body;
  if (!status || !['resolved', 'dismissed'].includes(status)) {
    return res.status(400).json({ message: 'Status must be "resolved" or "dismissed"' });
  }

  const [comment] = await c2_query(`SELECT * FROM comments WHERE id = ?`, [Number(commentId)]);
  if (!comment) {
    return res.status(404).json({ message: 'Comment not found' });
  }

  // Verify the user has at least read access to the page
  const page = await checkPageReadAccess(comment.page_id, req.user);
  if (!page) {
    return res.status(403).json({ message: 'Access denied' });
  }

  await c2_query(
    `UPDATE comments SET status = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ?`,
    [status, req.user.id, Number(commentId)]
  );

  const [updated] = await c2_query(
    `SELECT c.*, u.name AS user_name, u.email AS user_email, ru.name AS resolved_by_name
       FROM comments c
  LEFT JOIN users u ON c.user_id = u.id
  LEFT JOIN users ru ON c.resolved_by = ru.id
      WHERE c.id = ?`,
    [Number(commentId)]
  );

  res.json({ comment: updated });
}));

/**
 * POST /api/comments/:commentId/reopen
 * Reopen a resolved/dismissed comment.
 */
router.post('/comments/:commentId/reopen', requireAuth, asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  if (!isValidId(commentId)) {
    return res.status(400).json({ message: 'Invalid comment ID' });
  }

  const [comment] = await c2_query(`SELECT * FROM comments WHERE id = ?`, [Number(commentId)]);
  if (!comment) {
    return res.status(404).json({ message: 'Comment not found' });
  }

  const page = await checkPageReadAccess(comment.page_id, req.user);
  if (!page) {
    return res.status(403).json({ message: 'Access denied' });
  }

  await c2_query(
    `UPDATE comments SET status = 'open', resolved_by = NULL, resolved_at = NULL WHERE id = ?`,
    [Number(commentId)]
  );

  res.json({ success: true });
}));

/**
 * DELETE /api/comments/:commentId
 * Delete a comment. Only the author can delete.
 */
router.delete('/comments/:commentId', requireAuth, asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  if (!isValidId(commentId)) {
    return res.status(400).json({ message: 'Invalid comment ID' });
  }

  const [comment] = await c2_query(`SELECT * FROM comments WHERE id = ?`, [Number(commentId)]);
  if (!comment) {
    return res.status(404).json({ message: 'Comment not found' });
  }
  if (comment.user_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only delete your own comments' });
  }

  await c2_query(`DELETE FROM comments WHERE id = ?`, [Number(commentId)]);
  res.json({ success: true });
}));

/**
 * DELETE /api/pages/:pageId/comments
 * Clear all comments on a page. Requires write access.
 */
router.delete('/pages/:pageId/comments', requireAuth, asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  if (!isValidId(pageId)) {
    return res.status(400).json({ message: 'Invalid page ID' });
  }

  const page = await checkPageWriteAccess(Number(pageId), req.user);
  if (!page) {
    return res.status(403).json({ message: 'Write access required to clear all comments' });
  }

  await c2_query(`DELETE FROM comments WHERE page_id = ?`, [Number(pageId)]);
  res.json({ success: true });
}));

/**
 * POST /api/comments/:commentId/replies
 * Add a reply to a comment.
 * Body: { content }
 */
router.post('/comments/:commentId/replies', requireAuth, asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  if (!isValidId(commentId)) {
    return res.status(400).json({ message: 'Invalid comment ID' });
  }

  const [comment] = await c2_query(`SELECT * FROM comments WHERE id = ?`, [Number(commentId)]);
  if (!comment) {
    return res.status(404).json({ message: 'Comment not found' });
  }

  const page = await checkPageReadAccess(comment.page_id, req.user);
  if (!page) {
    return res.status(403).json({ message: 'Access denied' });
  }

  const { content } = req.body;
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ message: 'Reply content is required' });
  }
  if (content.length > MAX_COMMENT_LENGTH) {
    return res.status(400).json({ message: 'Reply content too long' });
  }

  const result = await c2_query(
    `INSERT INTO comment_replies (comment_id, user_id, content) VALUES (?, ?, ?)`,
    [Number(commentId), req.user.id, content.trim()]
  );

  const [reply] = await c2_query(
    `SELECT cr.*, u.name AS user_name, u.email AS user_email
       FROM comment_replies cr
  LEFT JOIN users u ON cr.user_id = u.id
      WHERE cr.id = ?`,
    [result.insertId]
  );

  res.status(201).json({ reply });
}));

/**
 * DELETE /api/replies/:replyId
 * Delete a reply. Only the author can delete.
 */
router.delete('/replies/:replyId', requireAuth, asyncHandler(async (req, res) => {
  const { replyId } = req.params;
  if (!isValidId(replyId)) {
    return res.status(400).json({ message: 'Invalid reply ID' });
  }

  const [reply] = await c2_query(`SELECT * FROM comment_replies WHERE id = ?`, [Number(replyId)]);
  if (!reply) {
    return res.status(404).json({ message: 'Reply not found' });
  }
  if (reply.user_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only delete your own replies' });
  }

  await c2_query(`DELETE FROM comment_replies WHERE id = ?`, [Number(replyId)]);
  res.json({ success: true });
}));

export default router;

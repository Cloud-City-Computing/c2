/**
 * API routes for document management in Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';

const router = express.Router();

// --- Helpers ---

const isValidId = (id) => Number.isInteger(Number(id)) && Number(id) > 0;

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * GET /api/document?doc_id=<id>
 */
router.get('/document', asyncHandler(async (req, res) => {
  const { doc_id } = req.query;

  if (!doc_id || !isValidId(doc_id)) {
    return res.status(400).json({ message: 'Invalid or missing doc_id' });
  }

  const docs = await c2_query(
    `SELECT pages.html_content,
            pages.created_at,
            pages.title,
            users.name,
            users.email
       FROM pages
 INNER JOIN users ON pages.created_by = users.id
      WHERE pages.id = ?
      LIMIT 1`,
    [Number(doc_id)]
  );

  if (!docs.length) {
    return res.status(404).json({ message: 'Document not found' });
  }

  res.json({ document: docs[0] });
}));

/**
 * POST /api/save-document
 * Body: { doc_id: number, html_content: string }
 */
router.post('/save-document', asyncHandler(async (req, res) => {
  const { doc_id, html_content } = req.body;

  if (!doc_id || !isValidId(doc_id)) {
    return res.status(400).json({ success: false, message: 'Invalid or missing doc_id' });
  }

  if (html_content === undefined || html_content === null) {
    return res.status(400).json({ success: false, message: 'Missing html_content' });
  }

  const { affectedRows } = await c2_query(
    `UPDATE pages SET html_content = ?, updated_at = NOW() WHERE id = ?`,
    [html_content, Number(doc_id)]
  );

  if (!affectedRows) {
    return res.status(404).json({ success: false, message: 'Document not found' });
  }

  res.json({ success: true });
}));

router.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
  res.status(500).json({
    success: false,
    message: 'An internal server error occurred'
  });
});

export default router;
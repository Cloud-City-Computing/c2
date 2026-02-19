/**
 * API routes for document management in Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';

const router = express.Router();

/**
 * GET /api/document
 */
router.get('/document', async (req, res) => {
  const doc_id = req.query.doc_id;

  try {
    const docs = await c2_query(
      `SELECT * FROM pages WHERE id = ? LIMIT 1`,
      [doc_id]
    );

    if (docs.length === 1) {
      res.json({ document: docs[0] });
    } else {
      res.status(404).json({ message: 'Document not found' });
    }
  } catch {
    res.status(500).json({ message: 'Error fetching document' });
  }
});

/**
 * POST /api/save-document
 */
router.post('/save-document', async (req, res) => {
  const { doc_id, html_content } = req.body;

  try {
    const resp = await c2_query(
      `UPDATE pages SET html_content = ? WHERE id = ?`,
      [html_content, doc_id]
    );

    if (resp.affectedRows === 1) {
      res.json({ success: true });
    } else {
      res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
  } catch {
    res.status(500).json({
      success: false,
      message: 'Error saving document'
    });
  }
});

export default router;

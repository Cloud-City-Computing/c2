/**
 * API routes for search functionality in Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';

const router = express.Router();

/**
 * GET /api/search
 */
router.get('/search', async (req, res) => {
  const query = req.query.query ?? '';

  const results = await c2_query(
    `SELECT p.title, p.html_content, p.created_at, u.name, p.id
     FROM pages p
     LEFT JOIN users u ON p.created_by = u.id
     WHERE p.title LIKE ? OR p.html_content LIKE ?
     LIMIT 10`,
    [`%${query}%`, `%${query}%`]
  );

  res.json({ results });
});

export default router;

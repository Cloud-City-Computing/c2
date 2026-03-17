/**
 * API routes for search functionality in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const MAX_QUERY_LENGTH = 100;
const RESULTS_LIMIT = 10;

// --- Helpers ---

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * GET /api/search?query=<string>&limit=<number>
 * Filtered to pages in projects where the user has read_access
 */
router.get('/search', requireAuth, asyncHandler(async (req, res) => {
  const { query = '', limit: rawLimit } = req.query;

  // Reject empty searches before hitting the DB
  const trimmed = query.trim();
  if (!trimmed) {
    return res.json({ results: [] });
  }

  // Cap query length to prevent excessive LIKE pattern matching
  if (trimmed.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `Query must be ${MAX_QUERY_LENGTH} characters or fewer`
    });
  }

  // Optional caller-controlled limit, capped at RESULTS_LIMIT
  const limit = Math.min(Math.max(parseInt(rawLimit) || RESULTS_LIMIT, 1), RESULTS_LIMIT);

  // Only return pages in projects the user can read
  const results = await c2_query(
    `SELECT p.id,
            p.title,
            p.created_at,
            u.name AS author,
            pr.name AS project_name,
            LEFT(REGEXP_REPLACE(p.html_content, '<[^>]+>', ''), 200) AS excerpt
    FROM pages p
    LEFT JOIN users u ON p.created_by = u.id
    INNER JOIN projects pr ON p.project_id = pr.id
    WHERE (p.title LIKE ? OR p.html_content LIKE ?)
      AND (JSON_CONTAINS(pr.read_access, ?) OR pr.created_by = ?)
    ORDER BY p.created_at DESC
    LIMIT ${limit}`,
    [`%${trimmed}%`, `%${trimmed}%`, JSON.stringify(req.user.id), req.user.id]
  );

  res.json({ results });
}));

// --- Centralized error handler ---

router.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
  res.status(500).json({ success: false, message: 'An internal server error occurred' });
});

export default router;
/**
 * API routes for search functionality in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query, validateAndAutoLogin } from '../mysql_connect.js';

const router = express.Router();

const MAX_QUERY_LENGTH = 100;
const RESULTS_LIMIT = 10;

// --- Helpers ---

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * GET /api/search?query=<string>&limit=<number>
 */
router.get('/search', asyncHandler(async (req, res) => {
  const { query = '', token, limit: rawLimit } = req.query;

  // Authenticate — search should not be publicly accessible
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const sessionUser = await validateAndAutoLogin(token);
  if (!sessionUser) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }

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

  // Strip html tags from html_content to return clean plaintext excerpts,
  // and truncate to avoid sending entire page content over the wire
  const results = await c2_query(
    `SELECT p.id,
            p.title,
            p.created_at,
            u.name AS author,
            LEFT(REGEXP_REPLACE(p.html_content, '<[^>]+>', ''), 200) AS excerpt
    FROM pages p
    LEFT JOIN users u ON p.created_by = u.id
    WHERE p.title LIKE ? OR p.html_content LIKE ?
    ORDER BY p.created_at DESC
    LIMIT ${limit}`,
    [`%${trimmed}%`, `%${trimmed}%`]
  );

  res.json({ results });
}));

// --- Centralized error handler ---

router.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
  res.status(500).json({ success: false, message: 'An internal server error occurred' });
});

export default router;
/**
 * API routes for search functionality in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { readAccessWhere, readAccessParams } from './helpers/ownership.js';
import { asyncHandler, errorHandler } from './helpers/shared.js';

const router = express.Router();

const MAX_QUERY_LENGTH = 100;
const RESULTS_LIMIT = 10;
const BROWSE_LIMIT = 12;
const MAX_BROWSE_LIMIT = 48;
const SNIPPET_RADIUS = 80; // chars of context around a match

/**
 * Strip HTML tags from a string.
 */
function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, '');
}

/**
 * Build a contextual snippet around the first occurrence of `query` in `text`.
 * Returns { snippet, matchStart, matchEnd } where matchStart/matchEnd are
 * character offsets within the snippet so the frontend can highlight.
 */
function buildSnippet(text, query) {
  const plain = stripHtml(text);
  const lower = plain.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return { snippet: plain.slice(0, 200), matchStart: -1, matchEnd: -1 };

  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(plain.length, idx + query.length + SNIPPET_RADIUS);
  let snippet = plain.slice(start, end);
  const matchStart = idx - start;
  const matchEnd = matchStart + query.length;

  if (start > 0) snippet = '\u2026' + snippet;
  if (end < plain.length) snippet = snippet + '\u2026';

  return {
    snippet,
    matchStart: start > 0 ? matchStart + 1 : matchStart,
    matchEnd: start > 0 ? matchEnd + 1 : matchEnd,
  };
}

/**
 * GET /api/search?query=<string>&page=<number>&limit=<number>
 * Filtered to pages in projects where the user has read_access.
 * Uses MySQL FULLTEXT index for fast, relevance-ranked search.
 * Returns paginated results with contextual match snippets.
 */
router.get('/search', requireAuth, asyncHandler(async (req, res) => {
  const { query = '', page: rawPage, limit: rawLimit } = req.query;

  const trimmed = query.trim();
  if (!trimmed) {
    return res.json({ results: [], total: 0, page: 1, totalPages: 0 });
  }

  if (trimmed.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `Query must be ${MAX_QUERY_LENGTH} characters or fewer`
    });
  }

  const limit = Math.min(Math.max(parseInt(rawLimit) || RESULTS_LIMIT, 1), MAX_BROWSE_LIMIT);
  const page = Math.max(parseInt(rawPage) || 1, 1);
  const offset = (page - 1) * limit;

  const accessWhere = readAccessWhere('pr');
  const accessParams = readAccessParams(req.user);

  // Build the FULLTEXT search term.
  // Words are prefixed with + for required match and * for prefix matching,
  // which allows partial-word matching (e.g. "auth" matches "authentication").
  const ftTerms = trimmed
    .replace(/[+\-><()~*"@]/g, ' ')   // strip boolean operators from user input
    .split(/\s+/)
    .filter(Boolean)
    .map(w => `+${w}*`)
    .join(' ');

  // Also keep a LIKE fallback parameter for short/single-char queries
  // that FULLTEXT's minimum word length (default 3) may miss.
  const escapedQuery = trimmed.replace(/[%_\\]/g, '\\$&');
  const useFulltext = ftTerms.length > 0 && trimmed.length >= 3;

  const matchExpr = useFulltext
    ? `MATCH(p.title, p.plain_content) AGAINST(? IN BOOLEAN MODE)`
    : `(p.title LIKE ? ESCAPE '\\\\' OR p.plain_content LIKE ? ESCAPE '\\\\')`;

  const searchParams = useFulltext
    ? [ftTerms]
    : [`%${escapedQuery}%`, `%${escapedQuery}%`];

  // Count total matches
  const [countRow] = await c2_query(
    `SELECT COUNT(*) AS total
     FROM pages p
     INNER JOIN projects pr ON p.project_id = pr.id
     WHERE ${matchExpr}
       AND ${accessWhere}`,
    [...searchParams, ...accessParams]
  );
  const total = countRow?.total || 0;

  // Fetch the page of results, ordered by relevance when using FULLTEXT
  const orderBy = useFulltext
    ? `MATCH(p.title, p.plain_content) AGAINST(? IN BOOLEAN MODE) DESC, p.created_at DESC`
    : `p.created_at DESC`;

  const orderParams = useFulltext ? [ftTerms] : [];

  const results = await c2_query(
    `SELECT p.id,
            p.title,
            p.created_at,
            p.project_id,
            u.name AS author,
            pr.name AS project_name,
            CHAR_LENGTH(p.plain_content) AS char_count,
            p.html_content
    FROM pages p
    LEFT JOIN users u ON p.created_by = u.id
    INNER JOIN projects pr ON p.project_id = pr.id
    WHERE ${matchExpr}
      AND ${accessWhere}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`,
    [...searchParams, ...accessParams, ...orderParams, String(limit), String(offset)]
  );

  // Build contextual snippets and remove raw html_content from response
  const enriched = results.map(row => {
    const { snippet, matchStart, matchEnd } = buildSnippet(row.html_content || '', trimmed);
    const titleMatch = row.title.toLowerCase().includes(trimmed.toLowerCase());
    const { html_content, ...rest } = row;
    return {
      ...rest,
      excerpt: stripHtml(html_content).slice(0, 200),
      snippet,
      matchStart,
      matchEnd,
      matchedOn: titleMatch ? 'title' : 'content',
    };
  });

  res.json({
    results: enriched,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}));

/**
 * GET /api/browse?page=<number>&limit=<number>&sort=<string>
 * Paginated listing of all accessible pages (no search query required).
 */
router.get('/browse', requireAuth, asyncHandler(async (req, res) => {
  const { page: rawPage, limit: rawLimit, sort } = req.query;

  const limit = Math.min(Math.max(parseInt(rawLimit) || BROWSE_LIMIT, 1), MAX_BROWSE_LIMIT);
  const page = Math.max(parseInt(rawPage) || 1, 1);
  const offset = (page - 1) * limit;

  const allowedSorts = {
    newest: 'p.created_at DESC',
    oldest: 'p.created_at ASC',
    title: 'p.title ASC',
    project: 'pr.name ASC, p.title ASC',
  };
  const orderBy = allowedSorts[sort] || allowedSorts.newest;

  const accessWhere = readAccessWhere('pr');
  const accessParams = readAccessParams(req.user);

  const [countRow] = await c2_query(
    `SELECT COUNT(*) AS total
     FROM pages p
     INNER JOIN projects pr ON p.project_id = pr.id
     WHERE ${accessWhere}`,
    [...accessParams]
  );
  const total = countRow?.total || 0;

  const results = await c2_query(
    `SELECT p.id,
            p.title,
            p.created_at,
            p.project_id,
            u.name AS author,
            pr.name AS project_name,
            LEFT(p.plain_content, 200) AS excerpt,
            CHAR_LENGTH(p.plain_content) AS char_count
    FROM pages p
    LEFT JOIN users u ON p.created_by = u.id
    INNER JOIN projects pr ON p.project_id = pr.id
    WHERE ${accessWhere}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`,
    [...accessParams, String(limit), String(offset)]
  );

  res.json({
    results,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}));

router.use(errorHandler);

export default router;
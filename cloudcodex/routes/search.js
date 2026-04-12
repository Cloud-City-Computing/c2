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
import { getAllPresence } from '../services/collab.js';

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
 * Build optional filter SQL fragments.
 * Supports: favorites, workspaceId, squadId, archiveId.
 * Returns { filterWhere, filterJoins, filterParams }.
 */
function buildFilters(query, user) {
  const { favorites, workspaceId, squadId, archiveId } = query;
  const parts = [];
  const joins = [];
  const params = [];

  if (favorites === 'true' || favorites === '1') {
    joins.push('INNER JOIN favorites fav ON fav.log_id = p.id AND fav.user_id = ?');
    params.push(user.id);
  }
  if (workspaceId && !isNaN(Number(workspaceId))) {
    joins.push('INNER JOIN squads _fs ON _fs.id = pr.squad_id AND _fs.workspace_id = ?');
    params.push(Number(workspaceId));
  } else if (squadId && !isNaN(Number(squadId))) {
    parts.push('pr.squad_id = ?');
    params.push(Number(squadId));
  }
  if (archiveId && !isNaN(Number(archiveId))) {
    parts.push('p.archive_id = ?');
    params.push(Number(archiveId));
  }

  return {
    filterJoins: joins.length ? joins.join('\n    ') : '',
    filterWhere: parts.length ? parts.join(' AND ') : '',
    filterParams: params,
    joinParams: params.slice(0, joins.length), // params consumed by JOINs
    whereParams: params.slice(joins.length),   // params consumed by WHERE
  };
}

/**
 * GET /api/search?query=<string>&page=<number>&limit=<number>
 *                 &favorites=true&workspaceId=<id>&squadId=<id>&archiveId=<id>
 * Filtered to logs in archives where the user has read_access.
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

  const { filterJoins, filterWhere, joinParams, whereParams } = buildFilters(req.query, req.user);
  const extraWhere = filterWhere ? `AND ${filterWhere}` : '';

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
     FROM logs p
     INNER JOIN archives pr ON p.archive_id = pr.id
     ${filterJoins}
     WHERE ${matchExpr}
       AND ${accessWhere}
       ${extraWhere}`,
    [...joinParams, ...searchParams, ...accessParams, ...whereParams]
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
            p.archive_id,
            u.name AS author,
            pr.name AS archive_name,
            CHAR_LENGTH(p.plain_content) AS char_count,
            p.html_content
    FROM logs p
    LEFT JOIN users u ON p.created_by = u.id
    INNER JOIN archives pr ON p.archive_id = pr.id
    ${filterJoins}
    WHERE ${matchExpr}
      AND ${accessWhere}
      ${extraWhere}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`,
    [...joinParams, ...searchParams, ...accessParams, ...whereParams, ...orderParams, String(limit), String(offset)]
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
 *                 &favorites=true&workspaceId=<id>&squadId=<id>&archiveId=<id>
 * Paginated listing of all accessible logs (no search query required).
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
    archive: 'pr.name ASC, p.title ASC',
  };
  const orderBy = allowedSorts[sort] || allowedSorts.newest;

  const accessWhere = readAccessWhere('pr');
  const accessParams = readAccessParams(req.user);

  const { filterJoins, filterWhere, joinParams, whereParams } = buildFilters(req.query, req.user);
  const extraWhere = filterWhere ? `AND ${filterWhere}` : '';

  const [countRow] = await c2_query(
    `SELECT COUNT(*) AS total
     FROM logs p
     INNER JOIN archives pr ON p.archive_id = pr.id
     ${filterJoins}
     WHERE ${accessWhere}
       ${extraWhere}`,
    [...joinParams, ...accessParams, ...whereParams]
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
            CHAR_LENGTH(p.plain_content) AS char_count
    FROM logs p
    LEFT JOIN users u ON p.created_by = u.id
    INNER JOIN archives pr ON p.archive_id = pr.id
    ${filterJoins}
    WHERE ${accessWhere}
      ${extraWhere}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`,
    [...joinParams, ...accessParams, ...whereParams, String(limit), String(offset)]
  );

  res.json({
    results,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}));

/**
 * GET /api/search/filters
 * Returns the available filter options for the current user:
 * workspaces, squads (grouped by workspace), and archives (grouped by squad).
 */
router.get('/search/filters', requireAuth, asyncHandler(async (req, res) => {
  const accessWhere = readAccessWhere('pr');
  const accessParams = readAccessParams(req.user);

  // Get all accessible archives with their squad/workspace context
  const rows = await c2_query(
    `SELECT DISTINCT
            pr.id AS archive_id,
            pr.name AS archive_name,
            pr.squad_id,
            t.name AS squad_name,
            o.id AS workspace_id,
            o.name AS workspace_name
     FROM archives pr
     INNER JOIN squads t ON t.id = pr.squad_id
     INNER JOIN workspaces o ON o.id = t.workspace_id
     WHERE ${accessWhere}
     ORDER BY o.name, t.name, pr.name`,
    [...accessParams]
  );

  const workspaceMap = new Map();
  const squadMap = new Map();

  for (const row of rows) {
    if (!workspaceMap.has(row.workspace_id)) {
      workspaceMap.set(row.workspace_id, { id: row.workspace_id, name: row.workspace_name });
    }
    if (!squadMap.has(row.squad_id)) {
      squadMap.set(row.squad_id, { id: row.squad_id, name: row.squad_name, workspaceId: row.workspace_id });
    }
  }

  res.json({
    success: true,
    workspaces: [...workspaceMap.values()],
    squads: [...squadMap.values()],
    archives: rows.map(r => ({ id: r.archive_id, name: r.archive_name, squadId: r.squad_id, workspaceId: r.workspace_id })),
  });
}));

/**
 * GET /api/presence
 * Returns a map of log IDs to active users currently editing.
 * Filtered to only include logs the requesting user has read access to.
 * { presence: { [logId]: [{ id, name, color }] } }
 */
router.get('/presence', requireAuth, asyncHandler(async (req, res) => {
  const allPresence = getAllPresence();
  const logIds = Object.keys(allPresence).map(Number).filter(id => id > 0);
  if (logIds.length === 0) {
    return res.json({ success: true, presence: {} });
  }

  // Check which of these logs the user can read
  const placeholders = logIds.map(() => '?').join(',');
  const accessibleLogs = await c2_query(
    `SELECT pg.id
       FROM logs pg
 INNER JOIN archives p ON pg.archive_id = p.id
      WHERE pg.id IN (${placeholders})
        AND ${readAccessWhere('p')}`,
    [...logIds, ...readAccessParams(req.user)]
  );
  const accessibleIds = new Set(accessibleLogs.map(r => r.id));

  const filtered = {};
  for (const [logId, users] of Object.entries(allPresence)) {
    if (accessibleIds.has(Number(logId))) {
      filtered[logId] = users;
    }
  }

  res.json({ success: true, presence: filtered });
}));

router.use(errorHandler);

export default router;
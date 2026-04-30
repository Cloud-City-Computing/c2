/**
 * API routes for the activity feed in Cloud Codex
 *
 * Returns workspace-scoped events filtered by the caller's read access
 * on the underlying resources (logs / archives) using ownership.js.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidId, asyncHandler, errorHandler } from './helpers/shared.js';
import { readAccessWhere, readAccessParams } from './helpers/ownership.js';

const router = express.Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

/**
 * Verify the caller has any access to a workspace: admin, owner, or a
 * member of any squad in it. Without this gate, a malicious user could
 * iterate workspace IDs and read squad-type activity entries (which
 * don't go through readAccessWhere on logs/archives).
 */
async function userCanAccessWorkspace(workspaceId, user) {
  if (user.is_admin) return true;
  const [row] = await c2_query(
    `SELECT 1 AS ok
       FROM workspaces o
      WHERE o.id = ?
        AND (
          o.owner = ?
          OR EXISTS (
            SELECT 1 FROM squads s
              INNER JOIN squad_members sm ON sm.squad_id = s.id
             WHERE s.workspace_id = o.id AND sm.user_id = ?
          )
          OR EXISTS (
            SELECT 1 FROM squads s
             WHERE s.workspace_id = o.id AND s.created_by = ?
          )
        )
      LIMIT 1`,
    [workspaceId, user.email, user.id, user.id]
  );
  return Boolean(row);
}

/**
 * GET /api/activity?workspace=<id>&before=<ISO>&limit=50
 * Returns recent activity for the given workspace, filtered to entries
 * referencing resources the user can read.
 */
router.get('/activity', requireAuth, asyncHandler(async (req, res) => {
  const { workspace, before, limit, action_prefix } = req.query;
  if (!workspace || !isValidId(workspace)) {
    return res.status(400).json({ success: false, message: 'Invalid or missing workspace' });
  }
  const allowed = await userCanAccessWorkspace(Number(workspace), req.user);
  if (!allowed) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  const safeLimit = clampLimit(limit);

  const params = [Number(workspace)];
  let where = `al.workspace_id = ?`;

  if (before) {
    where += ` AND al.created_at < ?`;
    params.push(before);
  }

  if (action_prefix && /^[a-z_]+\.?$/i.test(action_prefix)) {
    where += ` AND al.action LIKE ?`;
    params.push(`${action_prefix}%`);
  }

  // Filter by access: log/archive entries are gated through readAccessWhere.
  // The accessParams arrays each contribute 7 params per usage.
  const logAccessSql = readAccessWhere('p_l');
  const archiveAccessSql = readAccessWhere('p_a');
  const accessClause = `(
    al.resource_type NOT IN ('log','archive','comment','version')
    OR (al.resource_type = 'log' AND EXISTS (
      SELECT 1 FROM logs l
        INNER JOIN archives p_l ON l.archive_id = p_l.id
       WHERE l.id = al.resource_id AND ${logAccessSql}
    ))
    OR (al.resource_type = 'archive' AND EXISTS (
      SELECT 1 FROM archives p_a
       WHERE p_a.id = al.resource_id AND ${archiveAccessSql}
    ))
    OR (al.resource_type = 'comment' AND EXISTS (
      SELECT 1 FROM comments c
        INNER JOIN logs l ON c.log_id = l.id
        INNER JOIN archives p_l ON l.archive_id = p_l.id
       WHERE c.id = al.resource_id AND ${logAccessSql}
    ))
    OR (al.resource_type = 'version' AND EXISTS (
      SELECT 1 FROM versions v
        INNER JOIN logs l ON v.log_id = l.id
        INNER JOIN archives p_l ON l.archive_id = p_l.id
       WHERE v.id = al.resource_id AND ${logAccessSql}
    ))
  )`;

  const accessParams = [
    ...readAccessParams(req.user), // log subquery
    ...readAccessParams(req.user), // archive subquery
    ...readAccessParams(req.user), // comment subquery (uses log archive access)
    ...readAccessParams(req.user), // version subquery
  ];

  params.push(...accessParams);
  params.push(String(safeLimit));

  const results = await c2_query(
    `SELECT al.id, al.workspace_id, al.squad_id, al.user_id, al.action,
            al.resource_type, al.resource_id, al.metadata, al.created_at,
            u.name AS actor_name, u.avatar_url AS actor_avatar
       FROM activity_log al
  LEFT JOIN users u ON al.user_id = u.id
      WHERE ${where} AND ${accessClause}
   ORDER BY al.created_at DESC
      LIMIT ?`,
    params
  );

  res.json({ success: true, results });
}));

/**
 * GET /api/activity/log/:logId
 * Activity scoped to a single document (still subject to read access).
 */
router.get('/activity/log/:logId', requireAuth, asyncHandler(async (req, res) => {
  const { logId } = req.params;
  if (!isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid log ID' });
  }

  // First confirm the user can read the log
  const [logCheck] = await c2_query(
    `SELECT pg.id FROM logs pg
       INNER JOIN archives p ON pg.archive_id = p.id
      WHERE pg.id = ? AND ${readAccessWhere('p')}
      LIMIT 1`,
    [Number(logId), ...readAccessParams(req.user)]
  );
  if (!logCheck) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const limitParam = clampLimit(req.query.limit);
  const params = [Number(logId)];
  let where = `(al.resource_type = 'log' AND al.resource_id = ?)`;

  if (req.query.include_comments !== '0') {
    where += ` OR (al.resource_type = 'comment' AND EXISTS (
      SELECT 1 FROM comments c WHERE c.id = al.resource_id AND c.log_id = ?
    ))`;
    params.push(Number(logId));
  }
  if (req.query.include_versions !== '0') {
    where += ` OR (al.resource_type = 'version' AND EXISTS (
      SELECT 1 FROM versions v WHERE v.id = al.resource_id AND v.log_id = ?
    ))`;
    params.push(Number(logId));
  }

  params.push(String(limitParam));

  const results = await c2_query(
    `SELECT al.id, al.user_id, al.action, al.resource_type, al.resource_id,
            al.metadata, al.created_at,
            u.name AS actor_name, u.avatar_url AS actor_avatar
       FROM activity_log al
  LEFT JOIN users u ON al.user_id = u.id
      WHERE ${where}
   ORDER BY al.created_at DESC
      LIMIT ?`,
    params
  );

  res.json({ success: true, results });
}));

router.use(errorHandler);

export default router;

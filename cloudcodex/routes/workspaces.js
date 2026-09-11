/**
 * API routes for workspace management in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth, requireMachine } from '../middleware/auth.js';
import { isValidId, asyncHandler, errorHandler, addSquadOwnerMember } from './helpers/shared.js';

const router = express.Router();

/**
 * GET /api/workspaces
 * Returns workspaces the user owns or belongs to (via squads).
 * Admin users see all workspaces.
 */
router.get('/workspaces', requireAuth, asyncHandler(async (req, res) => {
  let workspaces;

  if (req.user.is_admin) {
    workspaces = await c2_query(
      `SELECT DISTINCT o.id, o.name, u.email AS owner, o.created_at
       FROM workspaces o
       LEFT JOIN users u ON u.id = o.owner_id
       ORDER BY o.created_at DESC`
    );
  } else {
    workspaces = await c2_query(
      `SELECT DISTINCT o.id, o.name, u.email AS owner, o.created_at
       FROM workspaces o
       LEFT JOIN users u ON u.id = o.owner_id
       LEFT JOIN squads t ON t.workspace_id = o.id
       LEFT JOIN squad_members tm ON tm.squad_id = t.id AND tm.user_id = ?
       LEFT JOIN archives p ON p.squad_id = t.id
       WHERE o.owner_id = ?
          OR t.created_by = ?
          OR tm.id IS NOT NULL
          OR JSON_CONTAINS(p.read_access, ?)
       ORDER BY o.created_at DESC`,
      [req.user.id, req.user.id, req.user.id, JSON.stringify(req.user.id)]
    );
  }

  res.json({ success: true, workspaces: workspaces });
}));

/**
 * POST /api/workspaces
 * Create a new workspace (admin only)
 */
router.post('/workspaces', requireAuth, asyncHandler(async (req, res) => {
  // Only admins can create workspaces
  if (!req.user.is_admin) {
    return res.status(403).json({ success: false, message: 'Only administrators can create workspaces' });
  }

  const { name, squadName, archiveName } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Workspace name is required' });
  }
  if (name.trim().length > 255) {
    return res.status(400).json({ success: false, message: 'Workspace name must be 255 characters or less' });
  }

  const workspaceResult = await c2_query(
    `INSERT INTO workspaces (name, owner_id) VALUES (?, ?)`,
    [name.trim(), req.user.id]
  );
  const workspaceId = workspaceResult.insertId;

  let squadId = null;
  let archiveId = null;

  // Optionally create a squad alongside the workspace
  if (squadName?.trim()) {
    const squadResult = await c2_query(
      `INSERT INTO squads (workspace_id, name, created_by) VALUES (?, ?, ?)`,
      [workspaceId, squadName.trim(), req.user.id]
    );
    squadId = squadResult.insertId;

    await addSquadOwnerMember(squadId, req.user.id);

    // Optionally create a archive alongside the squad
    if (archiveName?.trim()) {
      const projResult = await c2_query(
        `INSERT INTO archives (name, squad_id, created_by, read_access, write_access)
         VALUES (?, ?, ?, JSON_ARRAY(?), JSON_ARRAY(?))`,
        [archiveName.trim(), squadId, req.user.id, req.user.id, req.user.id]
      );
      archiveId = projResult.insertId;
    }
  }

  res.status(201).json({ success: true, workspaceId, squadId, archiveId });
}));

/**
 * PUT /api/workspaces/:id
 * Update workspace name (owner only)
 */
router.put('/workspaces/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid workspace ID' });
  }

  const { name } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Workspace name is required' });
  }
  if (name.trim().length > 255) {
    return res.status(400).json({ success: false, message: 'Workspace name must be 255 characters or less' });
  }

  const [workspace] = await c2_query(
    `SELECT id, owner_id FROM workspaces WHERE id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!workspace) {
    return res.status(404).json({ success: false, message: 'Workspace not found' });
  }
  if (!req.user.is_admin && workspace.owner_id !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Only the owner can update this workspace' });
  }

  await c2_query(`UPDATE workspaces SET name = ? WHERE id = ?`, [name.trim(), Number(id)]);
  res.json({ success: true });
}));

/**
 * DELETE /api/workspaces/:id
 * Delete workspace (owner only, cascades to squads/archives/logs)
 */
router.delete('/workspaces/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid workspace ID' });
  }

  const [workspace] = await c2_query(
    `SELECT id, owner_id FROM workspaces WHERE id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!workspace) {
    return res.status(404).json({ success: false, message: 'Workspace not found' });
  }
  if (!req.user.is_admin && workspace.owner_id !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Only the owner can delete this workspace' });
  }

  await c2_query(`DELETE FROM workspaces WHERE id = ?`, [Number(id)]);
  res.json({ success: true });
}));

/**
 * GET /api/workspaces/:workspaceId/reader-check?email=<address>  (C2-5)
 *
 * Answers ONE question for the suite: may the person with this email address
 * read this workspace?
 *
 *   200 { canRead: true | false }
 *
 * WHY IT EXISTS. Cloud Command stores a `c2_workspace_id` and uses it to narrow
 * its document picker to one workspace here. That integer was CALLER-ASSERTED:
 * any account that could create a Cloud Command workspace could point it at any
 * workspace in this install and read document titles out of it, because the
 * service token reads across the install and the picker happily answered. Cloud
 * Command cannot fix that alone -- it can only ask, and the answer has to come
 * from the system that owns the rules.
 *
 * MACHINE-ONLY (requireMachine, NOT machineOrAuth), and that is the security
 * decision rather than a detail. This answers a question about a THIRD PARTY.
 * Behind a session, any logged-in user could enumerate which colleagues belong
 * to which workspaces, and probe which addresses have accounts here at all.
 *
 * A MISSING USER AND AN UNAUTHORISED USER ANSWER IDENTICALLY -- `false`, same
 * status, same body. Distinguishing them would turn this into an
 * account-existence oracle for whoever holds the service token. For the same
 * reason a workspace that does not exist answers `false` rather than 404: the
 * absence of a workspace is not a fact this endpoint should disclose either.
 *
 * "CAN READ A WORKSPACE" IS DERIVED FROM THE RULES THIS PRODUCT ALREADY HAS,
 * not invented: an admin (who reads every archive in the install), the
 * workspace owner (`workspaces.owner_id`, the top of ownership.js's cascade),
 * or a member of any squad in that workspace -- which is exactly what that
 * file's `read_access_workspace` clause already means by "in any squad of the
 * same workspace".
 *
 * IT IS DELIBERATELY NOT "has read access to at least one archive here". That
 * is a narrower question and the wrong one: a person who belongs to a workspace
 * but has no archive grants yet should still be able to connect it, and every
 * search that follows still applies the per-archive grants unchanged. This
 * gates the MAPPING, not the reads.
 */
router.get('/workspaces/:workspaceId/reader-check', requireMachine, asyncHandler(async (req, res) => {
  const { workspaceId } = req.params;
  const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';

  if (!isValidId(workspaceId)) {
    return res.status(400).json({ success: false, message: 'Invalid workspace id' });
  }
  if (!email || email.length > 255) {
    return res.status(400).json({ success: false, message: 'An email query parameter is required' });
  }

  /*
   * LOWER() on both sides. MySQL's default collation is already
   * case-insensitive, so `=` would work today -- written this way so the intent
   * survives a future collation change rather than depending on one.
   */
  const rows = await c2_query(
    `SELECT
       u.is_admin AS isAdmin,
       EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ? AND w.owner_id = u.id) AS ownsIt,
       EXISTS (
         SELECT 1 FROM squad_members sm
         JOIN squads s ON s.id = sm.squad_id
         WHERE sm.user_id = u.id AND s.workspace_id = ?
       ) AS inASquad
     FROM users u
     WHERE LOWER(u.email) = LOWER(?)
     LIMIT 1`,
    [Number(workspaceId), Number(workspaceId), email]
  );

  const row = rows[0];
  // No row at all is the unknown-email case, and it lands on the same answer.
  const canRead = Boolean(row) && Boolean(row.isAdmin || row.ownsIt || row.inASquad);

  res.json({ canRead });
}));

router.use(errorHandler);

export default router;

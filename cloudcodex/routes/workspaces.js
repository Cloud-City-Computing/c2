/**
 * API routes for workspace management in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
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
      `SELECT DISTINCT o.id, o.name, o.owner, o.created_at
       FROM workspaces o
       ORDER BY o.created_at DESC`
    );
  } else {
    workspaces = await c2_query(
      `SELECT DISTINCT o.id, o.name, o.owner, o.created_at
       FROM workspaces o
       LEFT JOIN squads t ON t.workspace_id = o.id
       LEFT JOIN squad_members tm ON tm.squad_id = t.id AND tm.user_id = ?
       LEFT JOIN archives p ON p.squad_id = t.id
       WHERE o.owner = ?
          OR t.created_by = ?
          OR tm.id IS NOT NULL
          OR JSON_CONTAINS(p.read_access, ?)
       ORDER BY o.created_at DESC`,
      [req.user.id, req.user.email, req.user.id, JSON.stringify(req.user.id)]
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
    `INSERT INTO workspaces (name, owner) VALUES (?, ?)`,
    [name.trim(), req.user.email]
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
    `SELECT id FROM workspaces WHERE id = ? AND owner = ? LIMIT 1`,
    [Number(id), req.user.email]
  );
  if (!workspace) {
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
    `SELECT id FROM workspaces WHERE id = ? AND owner = ? LIMIT 1`,
    [Number(id), req.user.email]
  );
  if (!workspace) {
    return res.status(403).json({ success: false, message: 'Only the owner can delete this workspace' });
  }

  await c2_query(`DELETE FROM workspaces WHERE id = ?`, [Number(id)]);
  res.json({ success: true });
}));

router.use(errorHandler);

export default router;

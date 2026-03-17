/**
 * API routes for team management in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const isValidId = (id) => Number.isInteger(Number(id)) && Number(id) > 0;

/**
 * GET /api/organizations/:orgId/teams
 * List teams in an organization
 */
router.get('/organizations/:orgId/teams', requireAuth, asyncHandler(async (req, res) => {
  const { orgId } = req.params;
  if (!isValidId(orgId)) {
    return res.status(400).json({ success: false, message: 'Invalid organization ID' });
  }

  const teams = await c2_query(
    `SELECT t.id, t.name, t.created_at, u.name AS created_by
     FROM teams t
     LEFT JOIN users u ON t.created_by = u.id
     WHERE t.organization_id = ?
     ORDER BY t.created_at DESC`,
    [Number(orgId)]
  );

  res.json({ success: true, teams });
}));

/**
 * POST /api/organizations/:orgId/teams
 * Create a team within an organization.
 * Org owners can always create teams; other users need create_team permission.
 */
router.post(
  '/organizations/:orgId/teams',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { orgId } = req.params;
    if (!isValidId(orgId)) {
      return res.status(400).json({ success: false, message: 'Invalid organization ID' });
    }

    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Team name is required' });
    }

    // Verify org exists and check ownership
    const [org] = await c2_query(
      `SELECT id, owner FROM organizations WHERE id = ? LIMIT 1`,
      [Number(orgId)]
    );
    if (!org) {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    // Org owners bypass the create_team permission check
    const isOwner = org.owner === req.user.email;
    if (!isOwner) {
      const [perms] = await c2_query(
        `SELECT create_team FROM permissions WHERE user_id = ? LIMIT 1`,
        [req.user.id]
      );
      if (!perms?.create_team) {
        return res.status(403).json({ success: false, message: "You do not have the 'create_team' permission" });
      }
    }

    const result = await c2_query(
      `INSERT INTO teams (organization_id, name, created_by) VALUES (?, ?, ?)`,
      [Number(orgId), name.trim(), req.user.id]
    );

    res.status(201).json({ success: true, teamId: result.insertId });
  })
);

/**
 * PUT /api/teams/:id
 * Rename a team (creator or org owner only)
 */
router.put('/teams/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid team ID' });
  }

  const { name } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Team name is required' });
  }

  const [team] = await c2_query(
    `SELECT t.id, t.created_by, o.owner
     FROM teams t
     LEFT JOIN organizations o ON t.organization_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!team) {
    return res.status(404).json({ success: false, message: 'Team not found' });
  }
  if (team.created_by !== req.user.id && team.owner !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Only the team creator or org owner can rename this team' });
  }

  await c2_query(`UPDATE teams SET name = ? WHERE id = ?`, [name.trim(), Number(id)]);
  res.json({ success: true });
}));

/**
 * DELETE /api/teams/:id
 * Delete a team (creator or org owner only, cascades)
 */
router.delete('/teams/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid team ID' });
  }

  const [team] = await c2_query(
    `SELECT t.id, t.created_by, o.owner
     FROM teams t
     LEFT JOIN organizations o ON t.organization_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!team) {
    return res.status(404).json({ success: false, message: 'Team not found' });
  }
  if (team.created_by !== req.user.id && team.owner !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Only the team creator or org owner can delete this team' });
  }

  await c2_query(`DELETE FROM teams WHERE id = ?`, [Number(id)]);
  res.json({ success: true });
}));

/**
 * GET /api/teams/:id/permissions
 * Get permissions for a team (org owner only)
 */
router.get('/teams/:id/permissions', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid team ID' });
  }

  const [team] = await c2_query(
    `SELECT t.id, o.owner
     FROM teams t
     LEFT JOIN organizations o ON t.organization_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
  if (team.owner !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Only the org owner can view team permissions' });
  }

  const [perms] = await c2_query(
    `SELECT create_project, create_page FROM team_permissions WHERE team_id = ? LIMIT 1`,
    [Number(id)]
  );

  res.json({
    success: true,
    permissions: perms || { create_project: false, create_page: true }
  });
}));

/**
 * PUT /api/teams/:id/permissions
 * Update permissions for a team (org owner only)
 * Body: { create_project?, create_page? }
 */
router.put('/teams/:id/permissions', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid team ID' });
  }

  const [team] = await c2_query(
    `SELECT t.id, o.owner
     FROM teams t
     LEFT JOIN organizations o ON t.organization_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
  if (team.owner !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Only the org owner can update team permissions' });
  }

  const { create_project, create_page } = req.body;

  // Upsert
  const [existing] = await c2_query(
    `SELECT id FROM team_permissions WHERE team_id = ? LIMIT 1`,
    [Number(id)]
  );

  if (existing) {
    const fields = [];
    const params = [];
    if (create_project !== undefined) { fields.push('create_project = ?'); params.push(!!create_project); }
    if (create_page !== undefined)    { fields.push('create_page = ?');    params.push(!!create_page);    }
    if (fields.length) {
      params.push(Number(id));
      await c2_query(`UPDATE team_permissions SET ${fields.join(', ')} WHERE team_id = ?`, params);
    }
  } else {
    await c2_query(
      `INSERT INTO team_permissions (team_id, create_project, create_page) VALUES (?, ?, ?)`,
      [Number(id), !!create_project, create_page !== false]
    );
  }

  res.json({ success: true });
}));

// --- Centralized error handler ---
router.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
  res.status(500).json({ success: false, message: 'An internal server error occurred' });
});

export default router;

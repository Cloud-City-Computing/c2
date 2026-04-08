/**
 * API routes for organization management in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidId, asyncHandler, errorHandler } from './helpers/shared.js';

const router = express.Router();

/**
 * GET /api/organizations
 * Returns organizations the user owns or belongs to (via teams).
 * Admin users see all organizations.
 */
router.get('/organizations', requireAuth, asyncHandler(async (req, res) => {
  let orgs;

  if (req.user.is_admin) {
    orgs = await c2_query(
      `SELECT DISTINCT o.id, o.name, o.owner, o.created_at
       FROM organizations o
       ORDER BY o.created_at DESC`
    );
  } else {
    orgs = await c2_query(
      `SELECT DISTINCT o.id, o.name, o.owner, o.created_at
       FROM organizations o
       LEFT JOIN teams t ON t.organization_id = o.id
       LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ?
       LEFT JOIN projects p ON p.team_id = t.id
       WHERE o.owner = ?
          OR t.created_by = ?
          OR tm.id IS NOT NULL
          OR JSON_CONTAINS(p.read_access, ?)
       ORDER BY o.created_at DESC`,
      [req.user.id, req.user.email, req.user.id, JSON.stringify(req.user.id)]
    );
  }

  res.json({ success: true, organizations: orgs });
}));

/**
 * POST /api/organizations
 * Create a new organization (admin only)
 */
router.post('/organizations', requireAuth, asyncHandler(async (req, res) => {
  // Only admins can create organizations
  if (!req.user.is_admin) {
    return res.status(403).json({ success: false, message: 'Only administrators can create organizations' });
  }

  const { name, teamName, projectName } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Organization name is required' });
  }
  if (name.trim().length > 255) {
    return res.status(400).json({ success: false, message: 'Organization name must be 255 characters or less' });
  }

  const orgResult = await c2_query(
    `INSERT INTO organizations (name, owner) VALUES (?, ?)`,
    [name.trim(), req.user.email]
  );
  const organizationId = orgResult.insertId;

  let teamId = null;
  let projectId = null;

  // Optionally create a team alongside the organization
  if (teamName?.trim()) {
    const teamResult = await c2_query(
      `INSERT INTO teams (organization_id, name, created_by) VALUES (?, ?, ?)`,
      [organizationId, teamName.trim(), req.user.id]
    );
    teamId = teamResult.insertId;

    await c2_query(
      `INSERT INTO team_members (team_id, user_id, role, can_read, can_write, can_create_page, can_create_project, can_manage_members, can_delete_version, can_publish)
       VALUES (?, ?, 'owner', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE)`,
      [teamId, req.user.id]
    );

    // Optionally create a project alongside the team
    if (projectName?.trim()) {
      const projResult = await c2_query(
        `INSERT INTO projects (name, team_id, created_by, read_access, write_access)
         VALUES (?, ?, ?, JSON_ARRAY(?), JSON_ARRAY(?))`,
        [projectName.trim(), teamId, req.user.id, req.user.id, req.user.id]
      );
      projectId = projResult.insertId;
    }
  }

  res.status(201).json({ success: true, organizationId, teamId, projectId });
}));

/**
 * PUT /api/organizations/:id
 * Update organization name (owner only)
 */
router.put('/organizations/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid organization ID' });
  }

  const { name } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Organization name is required' });
  }
  if (name.trim().length > 255) {
    return res.status(400).json({ success: false, message: 'Organization name must be 255 characters or less' });
  }

  const [org] = await c2_query(
    `SELECT id FROM organizations WHERE id = ? AND owner = ? LIMIT 1`,
    [Number(id), req.user.email]
  );
  if (!org) {
    return res.status(403).json({ success: false, message: 'Only the owner can update this organization' });
  }

  await c2_query(`UPDATE organizations SET name = ? WHERE id = ?`, [name.trim(), Number(id)]);
  res.json({ success: true });
}));

/**
 * DELETE /api/organizations/:id
 * Delete organization (owner only, cascades to teams/projects/pages)
 */
router.delete('/organizations/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid organization ID' });
  }

  const [org] = await c2_query(
    `SELECT id FROM organizations WHERE id = ? AND owner = ? LIMIT 1`,
    [Number(id), req.user.email]
  );
  if (!org) {
    return res.status(403).json({ success: false, message: 'Only the owner can delete this organization' });
  }

  await c2_query(`DELETE FROM organizations WHERE id = ?`, [Number(id)]);
  res.json({ success: true });
}));

router.use(errorHandler);

export default router;

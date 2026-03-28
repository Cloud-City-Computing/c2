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
 * Returns organizations the user owns or belongs to (via teams)
 */
router.get('/organizations', requireAuth, asyncHandler(async (req, res) => {
  const orgs = await c2_query(
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
  res.json({ success: true, organizations: orgs });
}));

/**
 * POST /api/organizations
 * Create a new organization
 */
router.post('/organizations', requireAuth, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Organization name is required' });
  }

  const result = await c2_query(
    `INSERT INTO organizations (name, owner) VALUES (?, ?)`,
    [name.trim(), req.user.email]
  );

  res.status(201).json({ success: true, organizationId: result.insertId });
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

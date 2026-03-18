/**
 * API routes for project and page navigation in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const isValidId = (id) => Number.isInteger(Number(id)) && Number(id) > 0;

// --- Routes ---

/**
 * GET /api/projects
 * Returns all projects the authenticated user has read access to
 */
router.get('/projects', requireAuth, asyncHandler(async (req, res) => {
  const projects = await c2_query(
    `SELECT p.id,
            p.name,
            p.created_at,
            u.name AS created_by,
            p.created_by AS created_by_id,
            t.name AS team_name,
            t.id AS team_id
     FROM projects p
     LEFT JOIN users u  ON p.created_by  = u.id
     LEFT JOIN teams t  ON p.team_id     = t.id
     WHERE JSON_CONTAINS(p.read_access, ?)
        OR p.created_by = ?
     ORDER BY p.created_at DESC`,
    [JSON.stringify(req.user.id), req.user.id]
  );

  res.json({ success: true, projects });
}));

/**
 * GET /api/projects/:projectId/pages
 * Returns the page tree for a project the user has access to
 */
router.get('/projects/:projectId/pages', requireAuth, asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  if (!isValidId(projectId)) {
    return res.status(400).json({ success: false, message: 'Invalid projectId' });
  }

  // Verify user has read access to the project
  const [project] = await c2_query(
    `SELECT id FROM projects
     WHERE id = ?
       AND (JSON_CONTAINS(read_access, ?) OR created_by = ?)
     LIMIT 1`,
    [Number(projectId), JSON.stringify(req.user.id), req.user.id]
  );

  if (!project) return res.status(403).json({ success: false, message: 'Access denied' });

  const pages = await c2_query(
    `SELECT p.id,
            p.title,
            p.parent_id,
            p.version,
            p.created_at,
            p.updated_at,
            u.name AS created_by,
            p.project_id
     FROM pages p
     LEFT JOIN users u ON p.created_by = u.id
     WHERE p.project_id = ?
     ORDER BY p.parent_id ASC, p.created_at ASC`,
    [Number(projectId)]
  );

  // Build a nested tree from the flat list
  const map = {};
  const roots = [];
  pages.forEach(page => { map[page.id] = { ...page, children: [] }; });
  pages.forEach(page => {
    if (page.parent_id && map[page.parent_id]) {
      map[page.parent_id].children.push(map[page.id]);
    } else {
      roots.push(map[page.id]);
    }
  });

  res.json({ success: true, pages: roots });
}));

/**
 * POST /api/projects
 * Creates a new project (requires create_project permission)
 */
router.post('/projects', requireAuth, requirePermission('create_project'), asyncHandler(async (req, res) => {
  const { name, team_id } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Project name is required' });
  }

  const result = await c2_query(
    `INSERT INTO projects (name, team_id, created_by, read_access, write_access)
     VALUES (?, ?, ?, JSON_ARRAY(?), JSON_ARRAY(?))`,
    [name.trim(), team_id ?? null, req.user.id, req.user.id, req.user.id]
  );

  res.status(201).json({ success: true, projectId: result.insertId });
}));

/**
 * PUT /api/projects/:id
 * Rename a project (write_access required)
 */
router.put('/projects/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid projectId' });
  }

  const { name } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Project name is required' });
  }

  const [project] = await c2_query(
    `SELECT id FROM projects
     WHERE id = ?
       AND (JSON_CONTAINS(write_access, ?) OR created_by = ?)
     LIMIT 1`,
    [Number(id), JSON.stringify(req.user.id), req.user.id]
  );
  if (!project) return res.status(403).json({ success: false, message: 'Write access denied' });

  await c2_query(`UPDATE projects SET name = ? WHERE id = ?`, [name.trim(), Number(id)]);
  res.json({ success: true });
}));

/**
 * DELETE /api/projects/:id
 * Delete a project (creator only, cascades)
 */
router.delete('/projects/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid projectId' });
  }

  const [project] = await c2_query(
    `SELECT id FROM projects WHERE id = ? AND created_by = ? LIMIT 1`,
    [Number(id), req.user.id]
  );
  if (!project) return res.status(403).json({ success: false, message: 'Only the creator can delete this project' });

  await c2_query(`DELETE FROM projects WHERE id = ?`, [Number(id)]);
  res.json({ success: true });
}));

/**
 * POST /api/projects/:id/access
 * Add/remove user from read_access or write_access
 * Body: { userId, accessType: 'read'|'write', action: 'add'|'remove' }
 */
router.post('/projects/:id/access', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid projectId' });
  }

  const { userId, accessType, action } = req.body;
  if (!isValidId(userId) || !['read', 'write'].includes(accessType) || !['add', 'remove'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid parameters' });
  }

  // Only creator can manage access
  const [project] = await c2_query(
    `SELECT id FROM projects WHERE id = ? AND created_by = ? LIMIT 1`,
    [Number(id), req.user.id]
  );
  if (!project) return res.status(403).json({ success: false, message: 'Only the creator can manage access' });

  const column = accessType === 'read' ? 'read_access' : 'write_access';

  // Read current access array, modify in JS, write back (avoids JSON_SEARCH int/string mismatch)
  const [proj] = await c2_query(`SELECT ${column} AS acl FROM projects WHERE id = ?`, [Number(id)]);
  const arr = JSON.parse(proj.acl || '[]');
  const targetUid = Number(userId);

  if (action === 'add') {
    if (!arr.includes(targetUid)) {
      arr.push(targetUid);
      await c2_query(`UPDATE projects SET ${column} = ? WHERE id = ?`, [JSON.stringify(arr), Number(id)]);
    }
  } else {
    const filtered = arr.filter(uid => uid !== targetUid);
    if (filtered.length !== arr.length) {
      await c2_query(`UPDATE projects SET ${column} = ? WHERE id = ?`, [JSON.stringify(filtered), Number(id)]);
    }
  }

  res.json({ success: true });
}));

/**
 * POST /api/projects/:projectId/pages
 * Creates a new page inside a project (requires create_page permission)
 */
router.post('/projects/:projectId/pages', requireAuth, requirePermission('create_page'), asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  if (!isValidId(projectId)) {
    return res.status(400).json({ success: false, message: 'Invalid projectId' });
  }

  const { title, parent_id } = req.body;
  if (!title?.trim()) {
    return res.status(400).json({ success: false, message: 'Page title is required' });
  }

  // Verify write access
  const [project] = await c2_query(
    `SELECT id FROM projects
     WHERE id = ?
       AND (JSON_CONTAINS(write_access, ?) OR created_by = ?)
     LIMIT 1`,
    [Number(projectId), JSON.stringify(req.user.id), req.user.id]
  );

  if (!project) return res.status(403).json({ success: false, message: 'Write access denied' });

  const result = await c2_query(
    `INSERT INTO pages (project_id, title, html_content, parent_id, created_by, updated_by)
     VALUES (?, ?, '', ?, ?, ?)`,
    [Number(projectId), title.trim(), parent_id ?? null, req.user.id, req.user.id]
  );

  res.status(201).json({ success: true, pageId: result.insertId });
}));

/**
 * PUT /api/projects/:projectId/pages/:pageId
 * Rename or move a page (write_access required)
 */
router.put('/projects/:projectId/pages/:pageId', requireAuth, asyncHandler(async (req, res) => {
  const { projectId, pageId } = req.params;
  if (!isValidId(projectId) || !isValidId(pageId)) {
    return res.status(400).json({ success: false, message: 'Invalid IDs' });
  }

  const { title, parent_id } = req.body;

  const [project] = await c2_query(
    `SELECT id FROM projects
     WHERE id = ?
       AND (JSON_CONTAINS(write_access, ?) OR created_by = ?)
     LIMIT 1`,
    [Number(projectId), JSON.stringify(req.user.id), req.user.id]
  );
  if (!project) return res.status(403).json({ success: false, message: 'Write access denied' });

  const fields = [];
  const params = [];
  if (title !== undefined) { fields.push('title = ?'); params.push(title.trim()); }
  if (parent_id !== undefined) { fields.push('parent_id = ?'); params.push(parent_id); }

  if (!fields.length) {
    return res.status(400).json({ success: false, message: 'No fields to update' });
  }

  params.push(Number(pageId), Number(projectId));
  await c2_query(
    `UPDATE pages SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`,
    params
  );

  res.json({ success: true });
}));

/**
 * DELETE /api/projects/:projectId/pages/:pageId
 * Delete a page (write_access required, cascades children)
 */
router.delete('/projects/:projectId/pages/:pageId', requireAuth, asyncHandler(async (req, res) => {
  const { projectId, pageId } = req.params;
  if (!isValidId(projectId) || !isValidId(pageId)) {
    return res.status(400).json({ success: false, message: 'Invalid IDs' });
  }

  const [project] = await c2_query(
    `SELECT id FROM projects
     WHERE id = ?
       AND (JSON_CONTAINS(write_access, ?) OR created_by = ?)
     LIMIT 1`,
    [Number(projectId), JSON.stringify(req.user.id), req.user.id]
  );
  if (!project) return res.status(403).json({ success: false, message: 'Write access denied' });

  await c2_query(
    `DELETE FROM pages WHERE id = ? AND project_id = ?`,
    [Number(pageId), Number(projectId)]
  );

  res.json({ success: true });
}));

// --- Centralized error handler ---

router.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
  res.status(500).json({ success: false, message: 'An internal server error occurred' });
});

export default router;
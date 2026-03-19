/**
 * API routes for document management in Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { readAccessWhere, readAccessParams, writeAccessWhere, writeAccessParams } from './helpers/ownership.js';

const router = express.Router();

// --- Helpers ---

const isValidId = (id) => Number.isInteger(Number(id)) && Number(id) > 0;

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * GET /api/document?doc_id=<id>
 * Requires auth; checks user read_access on parent project
 */
router.get('/document', requireAuth, asyncHandler(async (req, res) => {
  const { doc_id } = req.query;

  if (!doc_id || !isValidId(doc_id)) {
    return res.status(400).json({ message: 'Invalid or missing doc_id' });
  }

  const docs = await c2_query(
    `SELECT pg.id,
            pg.html_content,
            pg.created_at,
            pg.updated_at,
            pg.title,
            pg.version,
            pg.project_id,
            u.name,
            u.email,
            p.name AS project_name
       FROM pages pg
 INNER JOIN users u ON pg.created_by = u.id
 INNER JOIN projects p ON pg.project_id = p.id
      WHERE pg.id = ?
        AND ${readAccessWhere('p')}
      LIMIT 1`,
    [Number(doc_id), ...readAccessParams(req.user)]
  );

  if (!docs.length) {
    return res.status(404).json({ message: 'Document not found or access denied' });
  }

  res.json({ document: docs[0] });
}));

/**
 * POST /api/save-document
 * Body: { doc_id: number, html_content: string }
 * Requires auth; checks user write_access on parent project.
 * Snapshots the previous version into the versions table.
 */
router.post('/save-document', requireAuth, asyncHandler(async (req, res) => {
  const { doc_id, html_content } = req.body;

  if (!doc_id || !isValidId(doc_id)) {
    return res.status(400).json({ success: false, message: 'Invalid or missing doc_id' });
  }

  if (html_content === undefined || html_content === null) {
    return res.status(400).json({ success: false, message: 'Missing html_content' });
  }

  // Fetch existing page and verify write access
  const [page] = await c2_query(
    `SELECT pg.id, pg.html_content AS old_content, pg.version, pg.project_id
       FROM pages pg
 INNER JOIN projects p ON pg.project_id = p.id
      WHERE pg.id = ?
        AND ${writeAccessWhere('p')}
      LIMIT 1`,
    [Number(doc_id), ...writeAccessParams(req.user)]
  );

  if (!page) {
    return res.status(403).json({ success: false, message: 'Document not found or write access denied' });
  }

  // Snapshot the current (old) content before overwriting — skip if page is blank (first save)
  const oldContent = page.old_content || '';
  if (oldContent.trim()) {
    await c2_query(
      `INSERT INTO versions (page_id, version, html_content, created_by)
       VALUES (?, ?, ?, ?)`,
      [page.id, page.version, oldContent, req.user.id]
    );
  }

  // Update page with new content and bump version
  const newVersion = page.version + 1;
  await c2_query(
    `UPDATE pages SET html_content = ?, version = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
    [html_content, newVersion, req.user.id, Number(doc_id)]
  );

  res.json({ success: true, version: newVersion });
}));

/**
 * PUT /api/document/:pageId/title
 * Body: { title: string }
 * Update page title (requires write access)
 */
router.put('/document/:pageId/title', requireAuth, asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  if (!isValidId(pageId)) {
    return res.status(400).json({ success: false, message: 'Invalid page ID' });
  }

  const { title } = req.body;
  if (!title?.trim()) {
    return res.status(400).json({ success: false, message: 'Title is required' });
  }

  const [page] = await c2_query(
    `SELECT pg.id
       FROM pages pg
 INNER JOIN projects p ON pg.project_id = p.id
      WHERE pg.id = ?
        AND ${writeAccessWhere('p')}
      LIMIT 1`,
    [Number(pageId), ...writeAccessParams(req.user)]
  );

  if (!page) {
    return res.status(403).json({ success: false, message: 'Page not found or write access denied' });
  }

  await c2_query(`UPDATE pages SET title = ? WHERE id = ?`, [title.trim(), Number(pageId)]);
  res.json({ success: true });
}));

/**
 * GET /api/document/:pageId/versions
 * List all versions for a page
 */
router.get('/document/:pageId/versions', requireAuth, asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  if (!isValidId(pageId)) {
    return res.status(400).json({ success: false, message: 'Invalid page ID' });
  }

  // Verify read access
  const [page] = await c2_query(
    `SELECT pg.id
       FROM pages pg
 INNER JOIN projects p ON pg.project_id = p.id
      WHERE pg.id = ?
        AND ${readAccessWhere('p')}
      LIMIT 1`,
    [Number(pageId), ...readAccessParams(req.user)]
  );
  if (!page) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const versions = await c2_query(
    `SELECT v.id, v.version AS version_number, v.created_at AS saved_at, v.created_by AS created_by_id, u.name AS created_by
       FROM versions v
  LEFT JOIN users u ON v.created_by = u.id
      WHERE v.page_id = ?
   ORDER BY v.version DESC`,
    [Number(pageId)]
  );

  res.json({ success: true, versions });
}));

/**
 * GET /api/document/:pageId/versions/:versionId
 * Get a specific version's content
 */
router.get('/document/:pageId/versions/:versionId', requireAuth, asyncHandler(async (req, res) => {
  const { pageId, versionId } = req.params;
  if (!isValidId(pageId) || !isValidId(versionId)) {
    return res.status(400).json({ success: false, message: 'Invalid IDs' });
  }

  // Verify read access
  const [page] = await c2_query(
    `SELECT pg.id
       FROM pages pg
 INNER JOIN projects p ON pg.project_id = p.id
      WHERE pg.id = ?
        AND ${readAccessWhere('p')}
      LIMIT 1`,
    [Number(pageId), ...readAccessParams(req.user)]
  );
  if (!page) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const [version] = await c2_query(
    `SELECT v.id, v.version AS version_number, v.html_content, v.created_at AS saved_at, u.name AS created_by
       FROM versions v
  LEFT JOIN users u ON v.created_by = u.id
      WHERE v.id = ? AND v.page_id = ?
      LIMIT 1`,
    [Number(versionId), Number(pageId)]
  );

  if (!version) {
    return res.status(404).json({ success: false, message: 'Version not found' });
  }

  res.json({ success: true, version });
}));

/**
 * POST /api/document/:pageId/versions/:versionId/restore
 * Restore a page to a previous version (creates new version snapshot of current)
 */
router.post('/document/:pageId/versions/:versionId/restore', requireAuth, asyncHandler(async (req, res) => {
  const { pageId, versionId } = req.params;
  if (!isValidId(pageId) || !isValidId(versionId)) {
    return res.status(400).json({ success: false, message: 'Invalid IDs' });
  }

  // Verify write access and get current content
  const [currentPage] = await c2_query(
    `SELECT pg.id, pg.html_content, pg.version
       FROM pages pg
 INNER JOIN projects p ON pg.project_id = p.id
      WHERE pg.id = ?
        AND ${writeAccessWhere('p')}
      LIMIT 1`,
    [Number(pageId), ...writeAccessParams(req.user)]
  );
  if (!currentPage) {
    return res.status(403).json({ success: false, message: 'Write access denied' });
  }

  // Fetch the version to restore
  const [targetVersion] = await c2_query(
    `SELECT html_content FROM versions WHERE id = ? AND page_id = ? LIMIT 1`,
    [Number(versionId), Number(pageId)]
  );
  if (!targetVersion) {
    return res.status(404).json({ success: false, message: 'Version not found' });
  }

  // Snapshot current before restoring
  await c2_query(
    `INSERT INTO versions (page_id, version, html_content, created_by)
     VALUES (?, ?, ?, ?)`,
    [currentPage.id, currentPage.version, currentPage.html_content, req.user.id]
  );

  const newVersion = currentPage.version + 1;
  await c2_query(
    `UPDATE pages SET html_content = ?, version = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
    [targetVersion.html_content, newVersion, req.user.id, Number(pageId)]
  );

  res.json({ success: true, version: newVersion });
}));

/**
 * DELETE /api/document/:pageId/versions/:versionId
 * Delete a version. Allowed if the user is the version author, or has can_delete_version permission via team membership.
 */
router.delete('/document/:pageId/versions/:versionId', requireAuth, asyncHandler(async (req, res) => {
  const { pageId, versionId } = req.params;
  if (!isValidId(pageId) || !isValidId(versionId)) {
    return res.status(400).json({ success: false, message: 'Invalid IDs' });
  }

  // Verify the version exists and belongs to this page
  const [version] = await c2_query(
    `SELECT v.id, v.created_by, pg.project_id
       FROM versions v
 INNER JOIN pages pg ON v.page_id = pg.id
      WHERE v.id = ? AND v.page_id = ?
      LIMIT 1`,
    [Number(versionId), Number(pageId)]
  );
  if (!version) {
    return res.status(404).json({ success: false, message: 'Version not found' });
  }

  // Allow if user is the version author
  if (version.created_by === req.user.id) {
    await c2_query(`DELETE FROM versions WHERE id = ?`, [Number(versionId)]);
    return res.json({ success: true });
  }

  // Otherwise check can_delete_version via team membership, or org/team owner bypass
  const [perm] = await c2_query(
    `SELECT tm.can_delete_version, tm.role
       FROM projects p
 INNER JOIN team_members tm ON tm.team_id = p.team_id AND tm.user_id = ?
      WHERE p.id = ?
      LIMIT 1`,
    [req.user.id, version.project_id]
  );

  if (!perm?.can_delete_version && perm?.role !== 'owner') {
    return res.status(403).json({ success: false, message: 'You do not have permission to delete this version' });
  }

  await c2_query(`DELETE FROM versions WHERE id = ?`, [Number(versionId)]);
  res.json({ success: true });
}));

router.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
  res.status(500).json({
    success: false,
    message: 'An internal server error occurred'
  });
});

export default router;
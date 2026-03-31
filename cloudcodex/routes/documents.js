/**
 * API routes for document management in Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import TurndownService from 'turndown';
import HTMLtoDOCX from 'html-to-docx';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { readAccessWhere, readAccessParams, writeAccessWhere, writeAccessParams } from './helpers/ownership.js';
import { isValidId, asyncHandler, sanitizeHtml, canPublish, errorHandler } from './helpers/shared.js';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

const MAX_CONTENT_SIZE = 2 * 1024 * 1024; // 2 MB max document content

const router = express.Router();

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
 * Saves content only — does not create a version snapshot.
 * Use POST /api/document/:pageId/publish to create a formal published version.
 */
router.post('/save-document', requireAuth, asyncHandler(async (req, res) => {
  const { doc_id, html_content } = req.body;

  if (!doc_id || !isValidId(doc_id)) {
    return res.status(400).json({ success: false, message: 'Invalid or missing doc_id' });
  }

  if (html_content === undefined || html_content === null) {
    return res.status(400).json({ success: false, message: 'Missing html_content' });
  }

  if (typeof html_content !== 'string' || html_content.length > MAX_CONTENT_SIZE) {
    return res.status(413).json({ success: false, message: 'Document content exceeds maximum size' });
  }

  // Sanitize HTML to prevent stored XSS
  const cleanHtml = sanitizeHtml(html_content);

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

  // Save content without creating a version snapshot
  await c2_query(
    `UPDATE pages SET html_content = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
    [cleanHtml, req.user.id, Number(doc_id)]
  );

  res.json({ success: true });
}));

/**
 * POST /api/document/:pageId/publish
 * Body (optional): { title?: string, notes?: string }
 * Creates a formal published version snapshot of the current document content.
 * Requires auth, write_access on parent project, and can_publish team permission.
 */
router.post('/document/:pageId/publish', requireAuth, asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  if (!isValidId(pageId)) {
    return res.status(400).json({ success: false, message: 'Invalid page ID' });
  }

  const { title, notes } = req.body || {};

  // Validate optional title and notes
  if (title !== undefined && (typeof title !== 'string' || title.length > 255)) {
    return res.status(400).json({ success: false, message: 'Title must be a string of 255 characters or fewer' });
  }
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 5000)) {
    return res.status(400).json({ success: false, message: 'Notes must be a string of 5000 characters or fewer' });
  }

  // Verify write access and get current content + team context
  const [page] = await c2_query(
    `SELECT pg.id, pg.html_content, pg.version, p.team_id, p.created_by AS project_creator
       FROM pages pg
 INNER JOIN projects p ON pg.project_id = p.id
      WHERE pg.id = ?
        AND ${writeAccessWhere('p')}
      LIMIT 1`,
    [Number(pageId), ...writeAccessParams(req.user)]
  );
  if (!page) {
    return res.status(403).json({ success: false, message: 'Document not found or write access denied' });
  }

  // Check can_publish permission: org owner, team owner, project creator, or team member with can_publish
  const publishAllowed = await canPublish(page.team_id, page.project_creator, req.user);
  if (!publishAllowed) {
    return res.status(403).json({ success: false, message: 'You do not have permission to publish versions' });
  }

  // Bump version and create snapshot
  const newVersion = page.version + 1;
  await c2_query(
    `UPDATE pages SET version = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
    [newVersion, req.user.id, Number(pageId)]
  );
  await c2_query(
    `INSERT INTO versions (page_id, version, title, notes, html_content, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [page.id, newVersion, title?.trim() || null, notes?.trim() || null, sanitizeHtml(page.html_content), req.user.id]
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
    `SELECT v.id, v.version AS version_number, v.title, v.notes, v.created_at AS saved_at, v.created_by AS created_by_id, u.name AS created_by
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
    `SELECT v.id, v.version AS version_number, v.title, v.notes, v.html_content, v.created_at AS saved_at, u.name AS created_by
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

  // Bump version and restore content
  const newVersion = currentPage.version + 1;
  await c2_query(
    `UPDATE pages SET html_content = ?, version = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
    [targetVersion.html_content, newVersion, req.user.id, Number(pageId)]
  );

  // Snapshot the restored content into version history
  await c2_query(
    `INSERT INTO versions (page_id, version, html_content, created_by)
     VALUES (?, ?, ?, ?)`,
    [currentPage.id, newVersion, targetVersion.html_content, req.user.id]
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

/**
 * GET /api/document/:pageId/export?format=html|md|txt|docx
 * Export a document in the requested format as a downloadable file.
 * Requires auth and read access on the parent project.
 */
router.get('/document/:pageId/export', requireAuth, asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  const { format } = req.query;

  if (!isValidId(pageId)) {
    return res.status(400).json({ success: false, message: 'Invalid page ID' });
  }

  const validFormats = ['html', 'md', 'txt', 'docx'];
  if (!validFormats.includes(format)) {
    return res.status(400).json({ success: false, message: `Invalid format. Supported: ${validFormats.join(', ')}` });
  }

  // Fetch document with read access check
  const [doc] = await c2_query(
    `SELECT pg.id, pg.title, pg.html_content
       FROM pages pg
 INNER JOIN projects p ON pg.project_id = p.id
      WHERE pg.id = ?
        AND ${readAccessWhere('p')}
      LIMIT 1`,
    [Number(pageId), ...readAccessParams(req.user)]
  );

  if (!doc) {
    return res.status(404).json({ success: false, message: 'Document not found or access denied' });
  }

  const safeTitle = (doc.title || 'document').replace(/[^a-zA-Z0-9_\- ]/g, '_');
  const escapedTitle = (doc.title || 'Document').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const htmlContent = doc.html_content || '';

  switch (format) {
    case 'html': {
      const fullHtml = `<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"><title>${escapedTitle}</title></head>\n<body>\n${htmlContent}\n</body>\n</html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.html"`);
      return res.send(fullHtml);
    }
    case 'md': {
      const markdown = turndown.turndown(htmlContent || '<p></p>');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.md"`);
      return res.send(markdown);
    }
    case 'txt': {
      const text = htmlContent
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.txt"`);
      return res.send(text);
    }
    case 'docx': {
      const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${htmlContent}</body></html>`;
      const docxBuffer = await HTMLtoDOCX(wrappedHtml, null, {
        table: { row: { cantSplit: true } },
        footer: true,
        pageNumber: true,
      });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.docx"`);
      return res.send(Buffer.from(docxBuffer));
    }
  }
}));

router.use(errorHandler);

export default router;
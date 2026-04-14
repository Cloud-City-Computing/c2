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
import { extractImagesFromHtml, inlineImagesForExport, inlineImagesForMarkdownExport } from './helpers/images.js';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

const MAX_CONTENT_SIZE = 2 * 1024 * 1024; // 2 MB max document content

const router = express.Router();

/**
 * GET /api/document?doc_id=<id>
 * Requires auth; checks user read_access on parent archive
 */
router.get('/document', requireAuth, asyncHandler(async (req, res) => {
  const { doc_id } = req.query;

  if (!doc_id || !isValidId(doc_id)) {
    return res.status(400).json({ message: 'Invalid or missing doc_id' });
  }

  const docs = await c2_query(
    `SELECT pg.id,
            pg.html_content,
            pg.markdown_content,
            pg.created_at,
            pg.updated_at,
            pg.title,
            pg.version,
            pg.archive_id,
            u.name,
            u.email,
            p.name AS archive_name,
            gl.repo_owner AS gh_owner,
            gl.repo_name AS gh_repo,
            gl.file_path AS gh_path,
            gl.branch AS gh_branch
       FROM logs pg
 INNER JOIN users u ON pg.created_by = u.id
 INNER JOIN archives p ON pg.archive_id = p.id
  LEFT JOIN github_links gl ON pg.id = gl.log_id
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
 * Body: { doc_id: number, html_content: string, markdown_content?: string|null }
 * Requires auth; checks user write_access on parent archive.
 * Saves content only — does not create a version snapshot.
 * Use POST /api/document/:logId/publish to create a formal published version.
 */
router.post('/save-document', requireAuth, asyncHandler(async (req, res) => {
  const { doc_id, html_content, markdown_content } = req.body;

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

  // Extract embedded base64 images to disk, replace with served URLs
  const storedHtml = await extractImagesFromHtml(cleanHtml);

  // Fetch existing log and verify write access
  const [log] = await c2_query(
    `SELECT pg.id, pg.html_content AS old_content, pg.version, pg.archive_id
       FROM logs pg
 INNER JOIN archives p ON pg.archive_id = p.id
      WHERE pg.id = ?
        AND ${writeAccessWhere('p')}
      LIMIT 1`,
    [Number(doc_id), ...writeAccessParams(req.user)]
  );

  if (!log) {
    return res.status(403).json({ success: false, message: 'Document not found or write access denied' });
  }

  // Save content without creating a version snapshot
  // If markdown_content is provided (string or null), update it alongside HTML.
  // When editing in rich text mode, markdown_content is set to null to indicate
  // the canonical source is now HTML.
  const mdVal = markdown_content !== undefined ? markdown_content : undefined;
  if (mdVal !== undefined) {
    await c2_query(
      `UPDATE logs SET html_content = ?, markdown_content = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
      [storedHtml, typeof mdVal === 'string' ? mdVal : null, req.user.id, Number(doc_id)]
    );
  } else {
    await c2_query(
      `UPDATE logs SET html_content = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
      [storedHtml, req.user.id, Number(doc_id)]
    );
  }

  res.json({ success: true });
}));

/**
 * POST /api/document/:logId/publish
 * Body (optional): { title?: string, notes?: string }
 * Creates a formal published version snapshot of the current document content.
 * Requires auth, write_access on parent archive, and can_publish squad permission.
 */
router.post('/document/:logId/publish', requireAuth, asyncHandler(async (req, res) => {
  const { logId } = req.params;
  if (!isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid log ID' });
  }

  const { title, notes } = req.body || {};

  // Validate optional title and notes
  if (title !== undefined && (typeof title !== 'string' || title.length > 255)) {
    return res.status(400).json({ success: false, message: 'Title must be a string of 255 characters or fewer' });
  }
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 5000)) {
    return res.status(400).json({ success: false, message: 'Notes must be a string of 5000 characters or fewer' });
  }

  // Verify write access and get current content + squad context
  const [log] = await c2_query(
    `SELECT pg.id, pg.html_content, pg.version, p.squad_id, p.created_by AS archive_creator
       FROM logs pg
 INNER JOIN archives p ON pg.archive_id = p.id
      WHERE pg.id = ?
        AND ${writeAccessWhere('p')}
      LIMIT 1`,
    [Number(logId), ...writeAccessParams(req.user)]
  );
  if (!log) {
    return res.status(403).json({ success: false, message: 'Document not found or write access denied' });
  }

  // Check can_publish permission: workspace owner, squad owner, archive creator, or squad member with can_publish
  const publishAllowed = await canPublish(log.squad_id, log.archive_creator, req.user);
  if (!publishAllowed) {
    return res.status(403).json({ success: false, message: 'You do not have permission to publish versions' });
  }

  // Bump version and create snapshot
  const newVersion = log.version + 1;
  // Extract embedded base64 images before persisting
  const publishHtml = await extractImagesFromHtml(sanitizeHtml(log.html_content));
  await c2_query(
    `UPDATE logs SET version = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
    [newVersion, req.user.id, Number(logId)]
  );
  await c2_query(
    `INSERT INTO versions (log_id, version, title, notes, html_content, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [log.id, newVersion, title?.trim() || null, notes?.trim() || null, publishHtml, req.user.id]
  );

  res.json({ success: true, version: newVersion });
}));

/**
 * PUT /api/document/:logId/title
 * Body: { title: string }
 * Update log title (requires write access)
 */
router.put('/document/:logId/title', requireAuth, asyncHandler(async (req, res) => {
  const { logId } = req.params;
  if (!isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid log ID' });
  }

  const { title } = req.body;
  if (!title?.trim()) {
    return res.status(400).json({ success: false, message: 'Title is required' });
  }
  if (title.trim().length > 255) {
    return res.status(400).json({ success: false, message: 'Title must be 255 characters or fewer' });
  }

  const [log] = await c2_query(
    `SELECT pg.id
       FROM logs pg
 INNER JOIN archives p ON pg.archive_id = p.id
      WHERE pg.id = ?
        AND ${writeAccessWhere('p')}
      LIMIT 1`,
    [Number(logId), ...writeAccessParams(req.user)]
  );

  if (!log) {
    return res.status(403).json({ success: false, message: 'Log not found or write access denied' });
  }

  await c2_query(`UPDATE logs SET title = ? WHERE id = ?`, [title.trim(), Number(logId)]);
  res.json({ success: true });
}));

/**
 * GET /api/document/:logId/versions
 * List all versions for a log
 */
router.get('/document/:logId/versions', requireAuth, asyncHandler(async (req, res) => {
  const { logId } = req.params;
  if (!isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid log ID' });
  }

  // Verify read access
  const [log] = await c2_query(
    `SELECT pg.id
       FROM logs pg
 INNER JOIN archives p ON pg.archive_id = p.id
      WHERE pg.id = ?
        AND ${readAccessWhere('p')}
      LIMIT 1`,
    [Number(logId), ...readAccessParams(req.user)]
  );
  if (!log) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const versions = await c2_query(
    `SELECT v.id, v.version AS version_number, v.title, v.notes, v.created_at AS saved_at, v.created_by AS created_by_id, u.name AS created_by
       FROM versions v
  LEFT JOIN users u ON v.created_by = u.id
      WHERE v.log_id = ?
   ORDER BY v.version DESC`,
    [Number(logId)]
  );

  res.json({ success: true, versions });
}));

/**
 * GET /api/document/:logId/versions/:versionId
 * Get a specific version's content
 */
router.get('/document/:logId/versions/:versionId', requireAuth, asyncHandler(async (req, res) => {
  const { logId, versionId } = req.params;
  if (!isValidId(logId) || !isValidId(versionId)) {
    return res.status(400).json({ success: false, message: 'Invalid IDs' });
  }

  // Verify read access
  const [log] = await c2_query(
    `SELECT pg.id
       FROM logs pg
 INNER JOIN archives p ON pg.archive_id = p.id
      WHERE pg.id = ?
        AND ${readAccessWhere('p')}
      LIMIT 1`,
    [Number(logId), ...readAccessParams(req.user)]
  );
  if (!log) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const [version] = await c2_query(
    `SELECT v.id, v.version AS version_number, v.title, v.notes, v.html_content, v.created_at AS saved_at, u.name AS created_by
       FROM versions v
  LEFT JOIN users u ON v.created_by = u.id
      WHERE v.id = ? AND v.log_id = ?
      LIMIT 1`,
    [Number(versionId), Number(logId)]
  );

  if (!version) {
    return res.status(404).json({ success: false, message: 'Version not found' });
  }

  res.json({ success: true, version });
}));

/**
 * POST /api/document/:logId/versions/:versionId/restore
 * Restore a log to a previous version (creates new version snapshot of current)
 */
router.post('/document/:logId/versions/:versionId/restore', requireAuth, asyncHandler(async (req, res) => {
  const { logId, versionId } = req.params;
  if (!isValidId(logId) || !isValidId(versionId)) {
    return res.status(400).json({ success: false, message: 'Invalid IDs' });
  }

  // Verify write access and get current content
  const [currentLog] = await c2_query(
    `SELECT pg.id, pg.html_content, pg.version
       FROM logs pg
 INNER JOIN archives p ON pg.archive_id = p.id
      WHERE pg.id = ?
        AND ${writeAccessWhere('p')}
      LIMIT 1`,
    [Number(logId), ...writeAccessParams(req.user)]
  );
  if (!currentLog) {
    return res.status(403).json({ success: false, message: 'Write access denied' });
  }

  // Fetch the version to restore
  const [targetVersion] = await c2_query(
    `SELECT html_content FROM versions WHERE id = ? AND log_id = ? LIMIT 1`,
    [Number(versionId), Number(logId)]
  );
  if (!targetVersion) {
    return res.status(404).json({ success: false, message: 'Version not found' });
  }

  // Bump version and restore content; clear ydoc_state so the CRDT doc
  // re-initialises from the restored HTML on next load.
  const newVersion = currentLog.version + 1;
  const restoredHtml = await extractImagesFromHtml(sanitizeHtml(targetVersion.html_content));
  await c2_query(
    `UPDATE logs SET html_content = ?, ydoc_state = NULL, version = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
    [restoredHtml, newVersion, req.user.id, Number(logId)]
  );

  // Snapshot the restored content into version history
  await c2_query(
    `INSERT INTO versions (log_id, version, html_content, created_by)
     VALUES (?, ?, ?, ?)`,
    [currentLog.id, newVersion, restoredHtml, req.user.id]
  );

  res.json({ success: true, version: newVersion });
}));

/**
 * DELETE /api/document/:logId/versions/:versionId
 * Delete a version. Allowed if the user is the version author, or has can_delete_version permission via squad membership.
 */
router.delete('/document/:logId/versions/:versionId', requireAuth, asyncHandler(async (req, res) => {
  const { logId, versionId } = req.params;
  if (!isValidId(logId) || !isValidId(versionId)) {
    return res.status(400).json({ success: false, message: 'Invalid IDs' });
  }

  // Verify the version exists and belongs to this log
  const [version] = await c2_query(
    `SELECT v.id, v.created_by, pg.archive_id
       FROM versions v
 INNER JOIN logs pg ON v.log_id = pg.id
      WHERE v.id = ? AND v.log_id = ?
      LIMIT 1`,
    [Number(versionId), Number(logId)]
  );
  if (!version) {
    return res.status(404).json({ success: false, message: 'Version not found' });
  }

  // Allow if user is admin or the version author
  if (req.user.is_admin || version.created_by === req.user.id) {
    await c2_query(`DELETE FROM versions WHERE id = ?`, [Number(versionId)]);
    return res.json({ success: true });
  }

  // Otherwise check can_delete_version via squad membership, or workspace/squad owner bypass
  const [perm] = await c2_query(
    `SELECT tm.can_delete_version, tm.role
       FROM archives p
 INNER JOIN squad_members tm ON tm.squad_id = p.squad_id AND tm.user_id = ?
      WHERE p.id = ?
      LIMIT 1`,
    [req.user.id, version.archive_id]
  );

  if (!perm?.can_delete_version && perm?.role !== 'owner') {
    return res.status(403).json({ success: false, message: 'You do not have permission to delete this version' });
  }

  await c2_query(`DELETE FROM versions WHERE id = ?`, [Number(versionId)]);
  res.json({ success: true });
}));

/**
 * GET /api/document/:logId/export?format=html|md|txt|docx
 * Export a document in the requested format as a downloadable file.
 * Requires auth and read access on the parent archive.
 */
router.get('/document/:logId/export', requireAuth, asyncHandler(async (req, res) => {
  const { logId } = req.params;
  const { format } = req.query;

  if (!isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid log ID' });
  }

  const validFormats = ['html', 'md', 'txt', 'docx'];
  if (!validFormats.includes(format)) {
    return res.status(400).json({ success: false, message: `Invalid format. Supported: ${validFormats.join(', ')}` });
  }

  // Fetch document with read access check
  const [doc] = await c2_query(
    `SELECT pg.id, pg.title, pg.html_content
       FROM logs pg
 INNER JOIN archives p ON pg.archive_id = p.id
      WHERE pg.id = ?
        AND ${readAccessWhere('p')}
      LIMIT 1`,
    [Number(logId), ...readAccessParams(req.user)]
  );

  if (!doc) {
    return res.status(404).json({ success: false, message: 'Document not found or access denied' });
  }

  const safeTitle = (doc.title || 'document').replace(/[^a-zA-Z0-9_\- ]/g, '_');
  const escapedTitle = (doc.title || 'Document').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const htmlContent = doc.html_content || '';

  switch (format) {
    case 'html': {
      // Inline /doc-images/ URLs as base64 data URIs so the file is self-contained
      const inlinedHtml = await inlineImagesForExport(htmlContent);
      const fullHtml = `<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"><title>${escapedTitle}</title></head>\n<body>\n${inlinedHtml}\n</body>\n</html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.html"`);
      return res.send(fullHtml);
    }
    case 'md': {
      const markdown = turndown.turndown(htmlContent || '<p></p>');
      // Inline /doc-images/ URLs in markdown image refs so the file is portable
      const inlinedMarkdown = await inlineImagesForMarkdownExport(markdown);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.md"`);
      return res.send(inlinedMarkdown);
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
      // Inline images as base64 so html-to-docx can embed them in the Word file
      const inlinedHtml = await inlineImagesForExport(htmlContent);
      const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${inlinedHtml}</body></html>`;
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
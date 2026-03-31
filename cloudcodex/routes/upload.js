/**
 * API routes for document file uploads in Cloud Codex
 *
 * Accepts file uploads (HTML, Markdown, Plain Text, PDF, DOCX) and converts
 * them to HTML content to create new pages within a project.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { createRequire } from 'node:module';
import { marked } from 'marked';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { writeAccessWhere, writeAccessParams } from './helpers/ownership.js';
import { isValidId, asyncHandler, sanitizeHtml, errorHandler } from './helpers/shared.js';

const ALLOWED_EXTENSIONS = ['html', 'htm', 'md', 'markdown', 'txt', 'pdf', 'docx'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Supported: HTML, Markdown, Plain Text, PDF, DOCX'));
    }
  },
});

/**
 * Convert an uploaded file buffer to HTML based on its extension.
 * @param {Buffer} buffer
 * @param {string} originalname
 * @returns {Promise<string>} HTML content
 */
async function convertToHtml(buffer, originalname) {
  const ext = originalname.split('.').pop()?.toLowerCase();

  if (ext === 'html' || ext === 'htm') {
    return buffer.toString('utf-8');
  }

  if (ext === 'md' || ext === 'markdown') {
    return marked.parse(buffer.toString('utf-8'));
  }

  if (ext === 'txt') {
    const text = buffer.toString('utf-8');
    return text
      .split('\n')
      .map((line) => `<p>${line || '&nbsp;'}</p>`)
      .join('\n');
  }

  if (ext === 'pdf') {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text
      .split('\n')
      .map((line) => `<p>${line || '&nbsp;'}</p>`)
      .join('\n');
  }

  if (ext === 'docx') {
    const result = await mammoth.convertToHtml({ buffer });
    return result.value;
  }

  throw new Error('Unsupported file type');
}

const router = express.Router();

/**
 * POST /api/projects/:projectId/pages/upload
 * Multipart form: file (required), parent_id (optional)
 * Converts the uploaded file to HTML and creates a new page.
 */
router.post(
  '/projects/:projectId/pages/upload',
  requireAuth,
  requirePermission('create_page'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    if (!isValidId(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid projectId' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // Verify write access to the project
    const [project] = await c2_query(
      `SELECT p.id FROM projects p
       WHERE p.id = ?
         AND ${writeAccessWhere('p')}
       LIMIT 1`,
      [Number(projectId), ...writeAccessParams(req.user)]
    );

    if (!project) {
      return res.status(403).json({ success: false, message: 'Write access denied' });
    }

    // Convert file content to HTML and sanitize
    const rawHtml = await convertToHtml(req.file.buffer, req.file.originalname);
    const cleanHtml = sanitizeHtml(rawHtml);

    // Derive page title from filename (strip extension)
    const title = req.file.originalname.replace(/\.[^.]+$/, '').trim() || 'Uploaded Document';

    const parentId = req.body.parent_id || null;

    const result = await c2_query(
      `INSERT INTO pages (project_id, title, html_content, parent_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [Number(projectId), title, cleanHtml, parentId, req.user.id, req.user.id]
    );

    res.status(201).json({ success: true, pageId: result.insertId, title });
  })
);

// Handle multer-specific errors with user-friendly messages
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: 'File too large. Maximum size is 10 MB.' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err.message?.includes('Unsupported file type')) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
});

router.use(errorHandler);

export default router;

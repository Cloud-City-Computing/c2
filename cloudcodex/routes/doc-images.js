/**
 * API routes for document image uploads in Cloud Codex
 *
 * Provides an upload endpoint that editors (Tiptap, markdown) can use
 * to upload images directly. Images are processed, deduplicated, and
 * recorded against the document they were uploaded into, which is what lets
 * the /doc-images handler (routes/doc-images-serve.js) serve them to that
 * document's readers.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, errorHandler, isValidId, checkLogWriteAccess } from './helpers/shared.js';
import { processAndSaveImage, insertDocImageRows } from './helpers/images.js';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported image type. Supported: JPEG, PNG, WebP, GIF, BMP'));
    }
  },
});

const router = express.Router();

/**
 * POST /api/doc-images/upload
 * Multipart form: logId (the document the images go into), files[] (one or more image files)
 *
 * Requires write access to logId. Processes each image (resize, convert to
 * webp, dedup by content hash), records it against logId as the caller's
 * upload, and returns the served URLs. The document's readers can see the
 * images at once, before anyone saves.
 *
 * Response: { success: true, urls: ["/doc-images/abc.webp"], data: { files: [...], isImages: [...], baseurl: "" } }
 */
router.post(
  '/doc-images/upload',
  requireAuth,
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    if (!req.files?.length) {
      return res.status(400).json({ success: false, message: 'No image file(s) uploaded' });
    }

    const logId = req.body?.logId;
    if (!isValidId(logId)) {
      return res.status(400).json({ success: false, message: 'Invalid or missing logId' });
    }
    if (!(await checkLogWriteAccess(Number(logId), req.user))) {
      return res.status(403).json({ success: false, message: 'Document not found or write access denied' });
    }

    const results = [];
    const hashes = [];
    for (const file of req.files) {
      try {
        const result = await processAndSaveImage(file.buffer);
        results.push(result.url);
        hashes.push(result.hash);
      } catch (err) {
        console.error('[doc-images] Failed to process upload:', err.message);
      }
    }

    if (results.length === 0) {
      return res.status(422).json({ success: false, message: 'No images could be processed' });
    }

    await insertDocImageRows(hashes.map((hash) => [hash, Number(logId), req.user.id]));

    // Response includes both the simple `urls` array and the legacy `data` shape
    res.json({
      success: true,
      urls: results,
      data: {
        files: results,
        isImages: results.map(() => true),
        baseurl: '',
      },
    });
  })
);

router.use(errorHandler);

export default router;

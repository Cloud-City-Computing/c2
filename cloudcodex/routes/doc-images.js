/**
 * API routes for document image uploads in Cloud Codex
 *
 * Provides an upload endpoint that editors (Tiptap, markdown) can use
 * to upload images directly. Images are processed, deduplicated, and
 * served as static files from /doc-images/.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, errorHandler } from './helpers/shared.js';
import { processAndSaveImage } from './helpers/images.js';

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
 * Multipart form: files[] (one or more image files)
 *
 * Processes each image (resize, convert to webp, dedup by content hash)
 * and returns the served URLs.
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

    const results = [];
    for (const file of req.files) {
      try {
        const result = await processAndSaveImage(file.buffer);
        results.push(result.url);
      } catch (err) {
        console.error('[doc-images] Failed to process upload:', err.message);
      }
    }

    if (results.length === 0) {
      return res.status(422).json({ success: false, message: 'No images could be processed' });
    }

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

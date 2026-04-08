/**
 * API routes for document image uploads in Cloud Codex
 *
 * Provides an upload endpoint that editors (Jodit, markdown) can use
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

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/svg+xml'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported image type. Supported: JPEG, PNG, WebP, GIF, BMP, SVG'));
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
 * Response format matches what Jodit's uploader expects:
 * { success: true, data: { files: ["/doc-images/abc.webp"], isImages: [true], baseurl: "" } }
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
        // Skip SVG files from sharp processing (serve as-is would need separate handling)
        // For now, process all raster types through sharp
        if (file.mimetype === 'image/svg+xml') {
          // SVGs are not processed through sharp — skip for security
          continue;
        }
        const result = await processAndSaveImage(file.buffer);
        results.push(result.url);
      } catch (err) {
        console.error('[doc-images] Failed to process upload:', err.message);
      }
    }

    if (results.length === 0) {
      return res.status(422).json({ success: false, message: 'No images could be processed' });
    }

    // Jodit uploader expected format
    res.json({
      success: true,
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

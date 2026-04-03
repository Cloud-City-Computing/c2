/**
 * API routes for user avatar (profile picture) management in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidId, asyncHandler, errorHandler } from './helpers/shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVATARS_DIR = path.join(__dirname, '..', 'public', 'avatars');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const AVATAR_SIZE = 256; // resize to 256x256

// Ensure avatars directory exists
fs.mkdir(AVATARS_DIR, { recursive: true }).catch(() => {});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported image type. Supported: JPEG, PNG, WebP, GIF'));
    }
  },
});

const router = express.Router();

/**
 * POST /api/users/:userId/avatar
 * Upload or replace a user's profile picture.
 * Multipart form: file (required, image)
 */
router.post('/users/:userId/avatar', requireAuth, upload.single('file'), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!isValidId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }
  if (req.user.id !== Number(userId)) {
    return res.status(403).json({ success: false, message: 'You can only update your own avatar' });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No image file uploaded' });
  }

  // Delete old avatar file if one exists
  const [existing] = await c2_query(`SELECT avatar_url FROM users WHERE id = ? LIMIT 1`, [req.user.id]);
  if (existing?.avatar_url) {
    const oldPath = path.join(__dirname, '..', 'public', existing.avatar_url);
    await fs.unlink(oldPath).catch(() => {});
  }

  // Generate a unique filename
  const ext = 'webp'; // always output as webp for consistency & size
  const filename = `${req.user.id}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const filePath = path.join(AVATARS_DIR, filename);

  // Resize & convert to webp
  await sharp(req.file.buffer)
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: 85 })
    .toFile(filePath);

  const avatarUrl = `/avatars/${filename}`;

  await c2_query(`UPDATE users SET avatar_url = ? WHERE id = ?`, [avatarUrl, req.user.id]);

  res.json({ success: true, avatar_url: avatarUrl });
}));

/**
 * DELETE /api/users/:userId/avatar
 * Remove a user's profile picture.
 */
router.delete('/users/:userId/avatar', requireAuth, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!isValidId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }
  if (req.user.id !== Number(userId)) {
    return res.status(403).json({ success: false, message: 'You can only remove your own avatar' });
  }

  const [existing] = await c2_query(`SELECT avatar_url FROM users WHERE id = ? LIMIT 1`, [req.user.id]);
  if (existing?.avatar_url) {
    const oldPath = path.join(__dirname, '..', 'public', existing.avatar_url);
    await fs.unlink(oldPath).catch(() => {});
  }

  await c2_query(`UPDATE users SET avatar_url = NULL WHERE id = ?`, [req.user.id]);

  res.json({ success: true });
}));

// Handle multer errors
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: 'Image too large. Maximum size is 5 MB.' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err.message?.includes('Unsupported image type')) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
});

router.use(errorHandler);

export default router;

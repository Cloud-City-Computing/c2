import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks } from '../helpers.js';
import { processAndSaveImage } from '../../routes/helpers/images.js';

// Mock the image processing helper to avoid real sharp/fs operations
vi.mock('../../routes/helpers/images.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    processAndSaveImage: vi.fn(async () => ({
      filename: 'abc123.webp',
      url: '/doc-images/abc123.webp',
      size: 1024,
    })),
  };
});

// Minimal valid 1x1 PNG buffer for uploads
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

describe('Doc Image Routes', () => {
  beforeEach(() => {
    resetMocks();
    processAndSaveImage.mockClear();
  });

  // ── POST /api/doc-images/upload ─────────────────────────

  describe('POST /api/doc-images/upload', () => {
    it('uploads a single image', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', 'Bearer valid-token')
        .attach('files', PNG_1x1, 'photo.png');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.urls).toHaveLength(1);
      expect(res.body.urls[0]).toBe('/doc-images/abc123.webp');
      expect(res.body.data.files).toHaveLength(1);
      expect(res.body.data.files[0]).toBe('/doc-images/abc123.webp');
      expect(res.body.data.isImages).toEqual([true]);
      expect(res.body.data.baseurl).toBe('');
    });

    it('uploads multiple images', async () => {
      mockAuthenticated();
      processAndSaveImage
        .mockResolvedValueOnce({ filename: 'img1.webp', url: '/doc-images/img1.webp', size: 512 })
        .mockResolvedValueOnce({ filename: 'img2.webp', url: '/doc-images/img2.webp', size: 768 });

      const res = await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', 'Bearer valid-token')
        .attach('files', PNG_1x1, 'a.png')
        .attach('files', PNG_1x1, 'b.png');

      expect(res.status).toBe(200);
      expect(res.body.data.files).toHaveLength(2);
    });

    it('returns 422 when all images fail processing', async () => {
      mockAuthenticated();
      processAndSaveImage.mockRejectedValue(new Error('corrupt image'));

      const res = await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', 'Bearer valid-token')
        .attach('files', PNG_1x1, 'bad.png');

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/no images/i);
    });

    it('rejects when no files are uploaded', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/no image/i);
    });

    it('rejects unsupported file types', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', 'Bearer valid-token')
        .attach('files', Buffer.from('<svg></svg>'), { filename: 'test.svg', contentType: 'image/svg+xml' });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', 'Bearer bad-token')
        .attach('files', PNG_1x1, 'photo.png');

      expect(res.status).toBe(401);
    });
  });
});

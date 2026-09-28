import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';
import { processAndSaveImage } from '../../routes/helpers/images.js';
import { writeAccessParams } from '../../routes/helpers/ownership.js';

// Mock the image processing helper to avoid real sharp/fs operations
vi.mock('../../routes/helpers/images.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    processAndSaveImage: vi.fn(async () => ({
      hash: 'abc1230000000000',
      filename: 'abc1230000000000.webp',
      url: '/doc-images/abc1230000000000.webp',
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
    /** The write-access check passes for log 5, then the ownership insert. */
    const allowWrite = () => c2_query
      .mockResolvedValueOnce([{ id: 5 }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const ownershipInserts = () =>
      c2_query.mock.calls.filter(([sql]) => /INSERT IGNORE INTO doc_images/.test(sql));

    it('uploads a single image', async () => {
      mockAuthenticated();
      allowWrite();

      const res = await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', 'Bearer valid-token')
        .field('logId', '5')
        .attach('files', PNG_1x1, 'photo.png');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.urls).toHaveLength(1);
      expect(res.body.urls[0]).toBe('/doc-images/abc1230000000000.webp');
      expect(res.body.data.files).toHaveLength(1);
      expect(res.body.data.files[0]).toBe('/doc-images/abc1230000000000.webp');
      expect(res.body.data.isImages).toEqual([true]);
      expect(res.body.data.baseurl).toBe('');
    });

    it('uploads multiple images', async () => {
      mockAuthenticated();
      allowWrite();
      processAndSaveImage
        .mockResolvedValueOnce({ hash: '1111111111111111', filename: '1111111111111111.webp', url: '/doc-images/1111111111111111.webp', size: 512 })
        .mockResolvedValueOnce({ hash: '2222222222222222', filename: '2222222222222222.webp', url: '/doc-images/2222222222222222.webp', size: 768 });

      const res = await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', 'Bearer valid-token')
        .field('logId', '5')
        .attach('files', PNG_1x1, 'a.png')
        .attach('files', PNG_1x1, 'b.png');

      expect(res.status).toBe(200);
      expect(res.body.data.files).toHaveLength(2);
    });

    it('checks write access on the document, then records each image as the uploader\'s', async () => {
      mockAuthenticated();
      allowWrite();
      processAndSaveImage
        .mockResolvedValueOnce({ hash: '1111111111111111', filename: '1111111111111111.webp', url: '/doc-images/1111111111111111.webp', size: 512 })
        .mockResolvedValueOnce({ hash: '2222222222222222', filename: '2222222222222222.webp', url: '/doc-images/2222222222222222.webp', size: 768 });

      await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', 'Bearer valid-token')
        .field('logId', '5')
        .attach('files', PNG_1x1, 'a.png')
        .attach('files', PNG_1x1, 'b.png');

      const [[accessSql, accessParams]] = c2_query.mock.calls;
      expect(accessSql).toMatch(/JSON_CONTAINS\(p\.write_access, \?\)/);
      expect(accessParams).toEqual([5, ...writeAccessParams(TEST_USER)]);
      const inserts = ownershipInserts();
      expect(inserts).toHaveLength(1);
      expect(inserts[0][1]).toEqual(['1111111111111111', 5, TEST_USER.id, '2222222222222222', 5, TEST_USER.id]);
    });

    it('requires a logId, and processes nothing without one', async () => {
      mockAuthenticated();

      for (const logId of [undefined, '', '0', 'abc', '-3']) {
        const req = request(app)
          .post('/api/doc-images/upload')
          .set('Authorization', 'Bearer valid-token');
        if (logId !== undefined) req.field('logId', logId);
        const res = await req.attach('files', PNG_1x1, 'photo.png');
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ success: false, message: 'Invalid or missing logId' });
      }
      expect(processAndSaveImage).not.toHaveBeenCalled();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('refuses a document the uploader cannot write, and processes and records nothing', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no write access

      const res = await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', 'Bearer valid-token')
        .field('logId', '5')
        .attach('files', PNG_1x1, 'photo.png');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, message: 'Document not found or write access denied' });
      expect(processAndSaveImage).not.toHaveBeenCalled();
      expect(ownershipInserts()).toHaveLength(0);
    });

    it('records only the images that processed', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockAuthenticated();
      allowWrite();
      processAndSaveImage
        .mockRejectedValueOnce(new Error('corrupt image'))
        .mockResolvedValueOnce({ hash: '2222222222222222', filename: '2222222222222222.webp', url: '/doc-images/2222222222222222.webp', size: 768 });

      const res = await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', 'Bearer valid-token')
        .field('logId', '5')
        .attach('files', PNG_1x1, 'a.png')
        .attach('files', PNG_1x1, 'b.png');

      expect(res.status).toBe(200);
      expect(res.body.urls).toEqual(['/doc-images/2222222222222222.webp']);
      expect(ownershipInserts()[0][1]).toEqual(['2222222222222222', 5, TEST_USER.id]);
      errorSpy.mockRestore();
    });

    it('returns 422 when all images fail processing', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 5 }]);
      processAndSaveImage.mockRejectedValue(new Error('corrupt image'));

      const res = await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', 'Bearer valid-token')
        .field('logId', '5')
        .attach('files', PNG_1x1, 'bad.png');

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/no images/i);
      expect(ownershipInserts()).toHaveLength(0);
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

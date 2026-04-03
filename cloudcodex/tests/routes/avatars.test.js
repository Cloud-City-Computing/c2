import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER, TEST_USER_2 } from '../helpers.js';

// Minimal valid 1x1 PNG buffer for uploads
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

describe('Avatar Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── POST /api/users/:userId/avatar ────────────

  describe('POST /api/users/:userId/avatar', () => {
    it('uploads an avatar image', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ avatar_url: null }])  // SELECT existing avatar
        .mockResolvedValueOnce({ changedRows: 1 });     // UPDATE avatar_url

      const res = await request(app)
        .post('/api/users/1/avatar')
        .set('Authorization', 'Bearer valid-token')
        .attach('file', PNG_1x1, 'avatar.png');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.avatar_url).toMatch(/^\/avatars\/1-[a-f0-9]+\.webp$/);
    });

    it('replaces an existing avatar', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ avatar_url: '/avatars/1-old.webp' }])  // SELECT existing
        .mockResolvedValueOnce({ changedRows: 1 });                      // UPDATE

      const res = await request(app)
        .post('/api/users/1/avatar')
        .set('Authorization', 'Bearer valid-token')
        .attach('file', PNG_1x1, 'newpic.png');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.avatar_url).toMatch(/^\/avatars\/1-[a-f0-9]+\.webp$/);
    });

    it('rejects unauthenticated requests', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .post('/api/users/1/avatar')
        .attach('file', PNG_1x1, 'avatar.png');

      expect(res.status).toBe(401);
    });

    it('rejects uploading avatar for another user', async () => {
      mockAuthenticated(); // user id=1

      const res = await request(app)
        .post('/api/users/2/avatar')
        .set('Authorization', 'Bearer valid-token')
        .attach('file', PNG_1x1, 'avatar.png');

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('your own avatar');
    });

    it('rejects invalid userId', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/users/abc/avatar')
        .set('Authorization', 'Bearer valid-token')
        .attach('file', PNG_1x1, 'avatar.png');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid userId');
    });

    it('rejects when no file is uploaded', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/users/1/avatar')
        .set('Authorization', 'Bearer valid-token')
        .field('placeholder', 'value');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('No image file');
    });

    it('rejects unsupported image types', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/users/1/avatar')
        .set('Authorization', 'Bearer valid-token')
        .attach('file', Buffer.from('not an image'), 'file.bmp');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Unsupported image type');
    });
  });

  // ── DELETE /api/users/:userId/avatar ────────────

  describe('DELETE /api/users/:userId/avatar', () => {
    it('removes an existing avatar', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ avatar_url: '/avatars/1-abc123.webp' }])  // SELECT existing
        .mockResolvedValueOnce({ changedRows: 1 });                         // UPDATE set NULL

      const res = await request(app)
        .delete('/api/users/1/avatar')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify UPDATE set avatar_url to NULL
      const updateCall = c2_query.mock.calls[1];
      expect(updateCall[0]).toContain('avatar_url = NULL');
    });

    it('succeeds even when no avatar exists', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ avatar_url: null }])   // SELECT existing (none)
        .mockResolvedValueOnce({ changedRows: 1 });      // UPDATE

      const res = await request(app)
        .delete('/api/users/1/avatar')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects unauthenticated requests', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .delete('/api/users/1/avatar');

      expect(res.status).toBe(401);
    });

    it('rejects deleting avatar for another user', async () => {
      mockAuthenticated(); // user id=1

      const res = await request(app)
        .delete('/api/users/2/avatar')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('your own avatar');
    });

    it('rejects invalid userId', async () => {
      mockAuthenticated();

      const res = await request(app)
        .delete('/api/users/abc/avatar')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid userId');
    });
  });
});

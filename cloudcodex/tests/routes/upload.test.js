import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

describe('Upload Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── POST /api/archives/:archiveId/logs/upload ────────────

  describe('POST /api/archives/:archiveId/logs/upload', () => {
    it('uploads an HTML file and creates a log', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ create_log: true }])  // requirePermission loads permissions
        .mockResolvedValueOnce([{ id: 1 }])               // archive write access check
        .mockResolvedValueOnce({ insertId: 42 });          // INSERT log

      const res = await request(app)
        .post('/api/archives/1/logs/upload')
        .set('Authorization', 'Bearer valid-token')
        .attach('file', Buffer.from('<h1>Hello</h1>'), 'test.html');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.logId).toBe(42);
      expect(res.body.title).toBe('test');
    });

    it('uploads a Markdown file and converts to HTML', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ create_log: true }])  // permissions
        .mockResolvedValueOnce([{ id: 1 }])               // archive write access
        .mockResolvedValueOnce({ insertId: 43 });          // INSERT

      const res = await request(app)
        .post('/api/archives/1/logs/upload')
        .set('Authorization', 'Bearer valid-token')
        .attach('file', Buffer.from('# Title\n\nSome text'), 'readme.md');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.title).toBe('readme');
    });

    it('uploads a plain text file', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ create_log: true }])  // permissions
        .mockResolvedValueOnce([{ id: 1 }])               // archive write access
        .mockResolvedValueOnce({ insertId: 44 });          // INSERT

      const res = await request(app)
        .post('/api/archives/1/logs/upload')
        .set('Authorization', 'Bearer valid-token')
        .attach('file', Buffer.from('Line 1\nLine 2'), 'notes.txt');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.title).toBe('notes');
    });

    it('rejects unsupported file types', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ create_log: true }]);  // permissions (multer rejects before route handler)

      const res = await request(app)
        .post('/api/archives/1/logs/upload')
        .set('Authorization', 'Bearer valid-token')
        .attach('file', Buffer.from('data'), 'image.png');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Unsupported file type');
    });

    it('rejects when no file is uploaded', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ create_log: true }]);  // permissions

      const res = await request(app)
        .post('/api/archives/1/logs/upload')
        .set('Authorization', 'Bearer valid-token')
        .field('placeholder', 'value');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('No file uploaded');
    });

    it('rejects invalid archiveId', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ create_log: true }]);  // permissions

      const res = await request(app)
        .post('/api/archives/abc/logs/upload')
        .set('Authorization', 'Bearer valid-token')
        .attach('file', Buffer.from('<p>hi</p>'), 'test.html');

      expect(res.status).toBe(400);
    });

    it('rejects without write access to archive', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ create_log: true }])  // permissions
        .mockResolvedValueOnce([]);                        // archive not found / no access

      const res = await request(app)
        .post('/api/archives/1/logs/upload')
        .set('Authorization', 'Bearer valid-token')
        .attach('file', Buffer.from('<p>hi</p>'), 'test.html');

      expect(res.status).toBe(403);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .post('/api/archives/1/logs/upload')
        .set('Authorization', 'Bearer bad-token')
        .attach('file', Buffer.from('<p>hi</p>'), 'test.html');

      expect(res.status).toBe(401);
    });

    it('rejects non-numeric parent_id', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ create_log: true }])  // permissions
        .mockResolvedValueOnce([{ id: 1 }]);              // archive write access

      const res = await request(app)
        .post('/api/archives/1/logs/upload')
        .set('Authorization', 'Bearer valid-token')
        .attach('file', Buffer.from('<p>hi</p>'), 'test.html')
        .field('parent_id', 'abc');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid parent_id');
    });
  });
});

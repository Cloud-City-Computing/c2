import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

describe('Document Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── GET /api/document ─────────────────────────────────────

  describe('GET /api/document', () => {
    it('returns document for valid doc_id with read access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{
        id: 1,
        html_content: '<p>Hello</p>',
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
        title: 'Test Doc',
        version: 3,
        project_id: 1,
        name: 'author',
        email: 'author@test.com',
        project_name: 'My Project',
      }]);

      const res = await request(app)
        .get('/api/document?doc_id=1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.document.title).toBe('Test Doc');
      expect(res.body.document.html_content).toBe('<p>Hello</p>');
    });

    it('returns 404 when document not found or no access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no docs found

      const res = await request(app)
        .get('/api/document?doc_id=999')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects missing doc_id', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/document')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('rejects invalid doc_id', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/document?doc_id=abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/document?doc_id=1')
        .set('Authorization', 'Bearer bad-token');

      expect(res.status).toBe(401);
    });
  });

  // ── POST /api/save-document ───────────────────────────────

  describe('POST /api/save-document', () => {
    it('saves document with write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, old_content: '<p>old</p>', version: 2, project_id: 1 }]) // fetch page
        .mockResolvedValueOnce([])  // UPDATE pages
        .mockResolvedValueOnce([]); // INSERT version

      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', 'Bearer valid-token')
        .send({ doc_id: 1, html_content: '<p>new</p>' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.version).toBe(3);
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no page found (access denied)

      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', 'Bearer valid-token')
        .send({ doc_id: 1, html_content: '<p>x</p>' });

      expect(res.status).toBe(403);
    });

    it('rejects missing doc_id', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', 'Bearer valid-token')
        .send({ html_content: '<p>x</p>' });

      expect(res.status).toBe(400);
    });

    it('rejects missing html_content', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', 'Bearer valid-token')
        .send({ doc_id: 1 });

      expect(res.status).toBe(400);
    });
  });

  // ── PUT /api/document/:pageId/title ───────────────────────

  describe('PUT /api/document/:pageId/title', () => {
    it('updates title with write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // page found with write access
        .mockResolvedValueOnce([]);            // UPDATE pages

      const res = await request(app)
        .put('/api/document/1/title')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'New Title' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects empty title', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/document/1/title')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: '' });

      expect(res.status).toBe(400);
    });

    it('rejects invalid page ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/document/abc/title')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'Test' });

      expect(res.status).toBe(400);
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no page found

      const res = await request(app)
        .put('/api/document/1/title')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'Test' });

      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/document/:pageId/versions ────────────────────

  describe('GET /api/document/:pageId/versions', () => {
    it('returns versions for accessible page', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // page access check
        .mockResolvedValueOnce([
          { id: 1, version_number: 2, saved_at: '2026-01-02', created_by: 'user', created_by_id: 1 },
          { id: 2, version_number: 1, saved_at: '2026-01-01', created_by: 'user', created_by_id: 1 },
        ]);

      const res = await request(app)
        .get('/api/document/1/versions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.versions).toHaveLength(2);
    });

    it('rejects without read access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no access

      const res = await request(app)
        .get('/api/document/1/versions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid page ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/document/abc/versions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });
});

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
        .mockResolvedValueOnce([]);  // UPDATE pages

      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', 'Bearer valid-token')
        .send({ doc_id: 1, html_content: '<p>new</p>' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
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

  // ── POST /api/document/:pageId/publish ────────────────────

  describe('POST /api/document/:pageId/publish', () => {
    it('publishes a version with write access (no team)', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, version: 2, project_id: 1, team_id: null, project_creator: 1 }]) // fetch page with write access
        .mockResolvedValueOnce([])  // UPDATE pages (bump version)
        .mockResolvedValueOnce([]); // INSERT version

      const res = await request(app)
        .post('/api/document/1/publish')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'Release v1', notes: 'Initial publish' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.version).toBe(3);
    });

    it('publishes when user has can_publish permission', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, version: 2, project_id: 1, team_id: 5, project_creator: 99 }]) // page with team
        .mockResolvedValueOnce([])   // org owner check (not owner)
        .mockResolvedValueOnce([{ can_publish: true, role: 'member' }]) // team member with can_publish
        .mockResolvedValueOnce([])   // UPDATE pages
        .mockResolvedValueOnce([]);  // INSERT version

      const res = await request(app)
        .post('/api/document/1/publish')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects publish without can_publish permission', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, version: 2, project_id: 1, team_id: 5, project_creator: 99 }]) // page with team
        .mockResolvedValueOnce([])   // org owner check (not owner)
        .mockResolvedValueOnce([{ can_publish: false, role: 'member' }]); // team member without can_publish

      const res = await request(app)
        .post('/api/document/1/publish')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('permission to publish');
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no page found

      const res = await request(app)
        .post('/api/document/1/publish')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid page ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/document/abc/publish')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('rejects title exceeding 255 characters', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/document/1/publish')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'a'.repeat(256) });

      expect(res.status).toBe(400);
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

  // ── GET /api/document/:pageId/versions/:versionId ─────────

  describe('GET /api/document/:pageId/versions/:versionId', () => {
    it('returns a specific version with read access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // read access check
        .mockResolvedValueOnce([{ id: 5, version_number: 2, title: 'v2', html_content: '<p>old</p>', saved_at: '2026-01-01', created_by: 'user' }]);

      const res = await request(app)
        .get('/api/document/1/versions/5')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.version.html_content).toBe('<p>old</p>');
    });

    it('returns 404 when version not found', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // read access
        .mockResolvedValueOnce([]);           // version not found

      const res = await request(app)
        .get('/api/document/1/versions/999')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects without read access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // no access

      const res = await request(app)
        .get('/api/document/1/versions/5')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid IDs', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/document/abc/versions/xyz')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/document/:pageId/versions/:versionId/restore ─

  describe('POST /api/document/:pageId/versions/:versionId/restore', () => {
    it('restores a version with write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, html_content: '<p>current</p>', version: 3 }])  // write access + current page
        .mockResolvedValueOnce([{ html_content: '<p>restored</p>' }])  // target version
        .mockResolvedValueOnce([])   // UPDATE pages
        .mockResolvedValueOnce([]);  // INSERT version snapshot

      const res = await request(app)
        .post('/api/document/1/versions/5/restore')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.version).toBe(4);
    });

    it('returns 404 when target version not found', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, html_content: '<p>current</p>', version: 3 }])  // write access
        .mockResolvedValueOnce([]);  // version not found

      const res = await request(app)
        .post('/api/document/1/versions/999/restore')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // no access

      const res = await request(app)
        .post('/api/document/1/versions/5/restore')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid IDs', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/document/abc/versions/xyz/restore')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/document/:pageId/versions/:versionId ──────

  describe('DELETE /api/document/:pageId/versions/:versionId', () => {
    it('allows the version author to delete', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 5, created_by: TEST_USER.id, project_id: 1 }])  // version found, user is author
        .mockResolvedValueOnce([]);  // DELETE

      const res = await request(app)
        .delete('/api/document/1/versions/5')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('allows team owner to delete', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 5, created_by: 999, project_id: 1 }])  // version found, different author
        .mockResolvedValueOnce([{ can_delete_version: false, role: 'owner' }])  // team member is owner
        .mockResolvedValueOnce([]);  // DELETE

      const res = await request(app)
        .delete('/api/document/1/versions/5')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('allows member with can_delete_version permission', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 5, created_by: 999, project_id: 1 }])  // version found
        .mockResolvedValueOnce([{ can_delete_version: true, role: 'member' }])  // has perm
        .mockResolvedValueOnce([]);  // DELETE

      const res = await request(app)
        .delete('/api/document/1/versions/5')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects without permission', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 5, created_by: 999, project_id: 1 }])  // version found
        .mockResolvedValueOnce([{ can_delete_version: false, role: 'member' }]);  // no perm

      const res = await request(app)
        .delete('/api/document/1/versions/5')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('returns 404 when version not found', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // not found

      const res = await request(app)
        .delete('/api/document/1/versions/999')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects invalid IDs', async () => {
      mockAuthenticated();

      const res = await request(app)
        .delete('/api/document/abc/versions/xyz')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── GET /api/document/:pageId/export ──────────────────────

  describe('GET /api/document/:pageId/export', () => {
    it('exports as HTML', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1, title: 'My Doc', html_content: '<p>Hello</p>' }]);

      const res = await request(app)
        .get('/api/document/1/export?format=html')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['content-disposition']).toContain('My Doc.html');
      expect(res.text).toContain('<p>Hello</p>');
    });

    it('exports as Markdown', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1, title: 'My Doc', html_content: '<h1>Title</h1><p>Text</p>' }]);

      const res = await request(app)
        .get('/api/document/1/export?format=md')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.headers['content-disposition']).toContain('My Doc.md');
    });

    it('exports as plain text', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1, title: 'My Doc', html_content: '<p>Hello World</p>' }]);

      const res = await request(app)
        .get('/api/document/1/export?format=txt')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.headers['content-disposition']).toContain('My Doc.txt');
      expect(res.text).toContain('Hello World');
    });

    it('exports as DOCX', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1, title: 'My Doc', html_content: '<p>Hello</p>' }]);

      const res = await request(app)
        .get('/api/document/1/export?format=docx')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('wordprocessingml.document');
      expect(res.headers['content-disposition']).toContain('My Doc.docx');
    });

    it('rejects invalid format', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/document/1/export?format=pdf')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid format');
    });

    it('returns 404 when document not found', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // not found

      const res = await request(app)
        .get('/api/document/1/export?format=html')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects invalid page ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/document/abc/export?format=html')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('escapes document title in HTML export to prevent XSS', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{
        id: 1,
        title: '</title><script>alert("xss")</script>',
        html_content: '<p>Hello</p>',
      }]);

      const res = await request(app)
        .get('/api/document/1/export?format=html')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.text).not.toContain('<script>');
      expect(res.text).toContain('&lt;script&gt;');
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

vi.mock('../../routes/oauth.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    decryptToken: vi.fn((token) => token ? 'mock-github-token' : null),
  };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Document Routes', () => {
  beforeEach(() => {
    resetMocks();
    mockFetch.mockReset();
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
        archive_id: 1,
        name: 'author',
        email: 'author@test.com',
        archive_name: 'My Archive',
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

    it('returns markdown_content when present', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{
        id: 1,
        html_content: '<h1>Hello</h1>',
        markdown_content: '# Hello',
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
        title: 'MD Doc',
        version: 1,
        archive_id: 1,
        name: 'author',
        email: 'author@test.com',
        archive_name: 'Archive',
      }]);

      const res = await request(app)
        .get('/api/document?doc_id=1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.document.markdown_content).toBe('# Hello');
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
        .mockResolvedValueOnce([{ id: 1, old_content: '<p>old</p>', version: 2, archive_id: 1 }]) // fetch log
        .mockResolvedValueOnce([]);  // UPDATE logs

      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', 'Bearer valid-token')
        .send({ doc_id: 1, html_content: '<p>new</p>' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no log found (access denied)

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

    it('rejects oversized content (>2MB)', async () => {
      mockAuthenticated();
      // Content exactly at 2MB + 1 byte — the JSON body including wrapper fields
      // exceeds the express.json({ limit: '2mb' }) parser, which also returns 413
      const hugeContent = 'x'.repeat(2 * 1024 * 1024 + 1);

      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', 'Bearer valid-token')
        .send({ doc_id: 1, html_content: hugeContent });

      expect(res.status).toBe(413);
    });

    it('saves markdown_content alongside html_content', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, old_content: '<p>old</p>', version: 2, archive_id: 1 }])
        .mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', 'Bearer valid-token')
        .send({ doc_id: 1, html_content: '<h1>Hello</h1>', markdown_content: '# Hello' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify the UPDATE query includes markdown_content
      const updateCall = c2_query.mock.calls.find(c => c[0].includes('UPDATE'));
      expect(updateCall).toBeTruthy();
    });

    it('saves with null markdown_content (rich text mode)', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, old_content: '<p>old</p>', version: 2, archive_id: 1 }])
        .mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', 'Bearer valid-token')
        .send({ doc_id: 1, html_content: '<p>rich text</p>', markdown_content: null });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('creates a notification for a newly @mentioned user with read access', async () => {
      mockAuthenticated();
      c2_query
        // 1: write-access fetch returning the existing doc
        .mockResolvedValueOnce([{ id: 1, old_content: '<p>old</p>', version: 2, archive_id: 1, title: 'Doc Title' }])
        // 2: UPDATE
        .mockResolvedValueOnce({ affectedRows: 1 })
        // 3: getRecipientUser SELECT
        .mockResolvedValueOnce([{ id: 7, name: 'Bob', email: 'b@x.com', is_admin: false }])
        // 4: checkLogReadAccess SELECT — returns the log (has access)
        .mockResolvedValueOnce([{ id: 1 }])
        // 5: coalesce SELECT — returns no recent duplicate
        .mockResolvedValueOnce([])
        // 6: INSERT into notifications
        .mockResolvedValueOnce({ insertId: 100 })
        // 7: getRecipient for email — returns user with no prefs (defaults apply)
        .mockResolvedValueOnce([{ id: 7, name: 'Bob', email: 'b@x.com', notification_prefs: null }]);

      const html = '<p>Hello <span data-mention-user-id="7" data-mention-username="bob">@bob</span></p>';
      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', 'Bearer valid-token')
        .send({ doc_id: 1, html_content: html });

      expect(res.status).toBe(200);
      // Find the INSERT into notifications call
      const insertCall = c2_query.mock.calls.find(c => /INSERT INTO notifications/i.test(c[0]));
      expect(insertCall).toBeTruthy();
      expect(insertCall[1]).toContain(7); // recipient
      expect(insertCall[1]).toContain('mention');
    });

    it('does NOT notify when the mentioned user has no read access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, old_content: '<p>old</p>', version: 2, archive_id: 1, title: 'Private Doc' }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce([{ id: 9, name: 'Eve', email: 'e@x.com', is_admin: false }])
        // Read access check — returns empty (denied)
        .mockResolvedValueOnce([]);

      const html = '<p><span data-mention-user-id="9" data-mention-username="eve">@eve</span></p>';
      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', 'Bearer valid-token')
        .send({ doc_id: 1, html_content: html });

      expect(res.status).toBe(200);
      const insertCall = c2_query.mock.calls.find(c => /INSERT INTO notifications/i.test(c[0]));
      expect(insertCall).toBeFalsy();
    });

    it('does NOT notify on a re-save with no new mentions', async () => {
      mockAuthenticated();
      const html = '<p><span data-mention-user-id="7" data-mention-username="bob">@bob</span></p>';
      c2_query
        .mockResolvedValueOnce([{ id: 1, old_content: html, version: 2, archive_id: 1, title: 'D' }])
        .mockResolvedValueOnce({ affectedRows: 1 });

      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', 'Bearer valid-token')
        .send({ doc_id: 1, html_content: html });

      expect(res.status).toBe(200);
      const insertCall = c2_query.mock.calls.find(c => /INSERT INTO notifications/i.test(c[0]));
      expect(insertCall).toBeFalsy();
    });
  });

  // ── PUT /api/document/:logId/title ───────────────────────

  describe('PUT /api/document/:logId/title', () => {
    it('updates title with write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // log found with write access
        .mockResolvedValueOnce([]);            // UPDATE logs

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

    it('rejects invalid log ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/document/abc/title')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'Test' });

      expect(res.status).toBe(400);
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no log found

      const res = await request(app)
        .put('/api/document/1/title')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'Test' });

      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/document/:logId/publish ────────────────────

  describe('POST /api/document/:logId/publish', () => {
    it('publishes a version with write access (no squad)', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, version: 2, archive_id: 1, squad_id: null, archive_creator: 1 }]) // fetch log with write access
        .mockResolvedValueOnce([])  // UPDATE logs (bump version)
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
        .mockResolvedValueOnce([{ id: 1, version: 2, archive_id: 1, squad_id: 5, archive_creator: 99 }]) // log with squad
        .mockResolvedValueOnce([])   // workspace owner check (not owner)
        .mockResolvedValueOnce([{ can_publish: true, role: 'member' }]) // squad member with can_publish
        .mockResolvedValueOnce([])   // UPDATE logs
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
        .mockResolvedValueOnce([{ id: 1, version: 2, archive_id: 1, squad_id: 5, archive_creator: 99 }]) // log with squad
        .mockResolvedValueOnce([])   // workspace owner check (not owner)
        .mockResolvedValueOnce([{ can_publish: false, role: 'member' }]); // squad member without can_publish

      const res = await request(app)
        .post('/api/document/1/publish')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('permission to publish');
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no log found

      const res = await request(app)
        .post('/api/document/1/publish')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid log ID', async () => {
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

    it('creates a GitHub release when create_github_release is set', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, version: 4, archive_id: 1, squad_id: null, archive_creator: 1 }])
        .mockResolvedValueOnce([]) // UPDATE logs
        .mockResolvedValueOnce({ insertId: 77 }) // INSERT version
        .mockResolvedValueOnce([{ encrypted_token: 'token-cipher' }]) // SELECT oauth token
        .mockResolvedValueOnce([]); // UPDATE versions with release info

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 1234567,
          tag_name: 'v5',
          html_url: 'https://github.com/u/r/releases/tag/v5',
        }),
      });

      const res = await request(app)
        .post('/api/document/1/publish')
        .set('Authorization', 'Bearer valid-token')
        .send({
          title: 'Release v5',
          notes: 'Major update',
          create_github_release: true,
          target_repo: 'u/r',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.github_release).toMatchObject({ id: 1234567, tag_name: 'v5' });
      expect(res.body.github_release_error).toBeNull();

      const releaseUpdateCall = c2_query.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('UPDATE versions')
      );
      expect(releaseUpdateCall).toBeTruthy();
      expect(releaseUpdateCall[1][0]).toBe(1234567);
    });

    it('reports github_release_error when GitHub API fails', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, version: 4, archive_id: 1, squad_id: null, archive_creator: 1 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ insertId: 77 })
        .mockResolvedValueOnce([{ encrypted_token: 'token-cipher' }]);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ message: 'Tag already exists' }),
      });

      const res = await request(app)
        .post('/api/document/1/publish')
        .set('Authorization', 'Bearer valid-token')
        .send({
          create_github_release: true,
          target_repo: 'u/r',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.github_release).toBeNull();
      expect(res.body.github_release_error).toMatch(/Tag already exists/);
    });

    it('rejects create_github_release without target_repo', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/document/1/publish')
        .set('Authorization', 'Bearer valid-token')
        .send({ create_github_release: true });

      expect(res.status).toBe(400);
    });
  });

  // ── GET /api/document/:logId/versions ────────────────────

  describe('GET /api/document/:logId/versions', () => {
    it('returns versions for accessible log', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // log access check
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

    it('rejects invalid log ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/document/abc/versions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── GET /api/document/:logId/versions/:versionId ─────────

  describe('GET /api/document/:logId/versions/:versionId', () => {
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

  // ── POST /api/document/:logId/versions/:versionId/restore ─

  describe('POST /api/document/:logId/versions/:versionId/restore', () => {
    it('restores a version with write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, html_content: '<p>current</p>', version: 3 }])  // write access + current log
        .mockResolvedValueOnce([{ html_content: '<p>restored</p>' }])  // target version
        .mockResolvedValueOnce([])   // UPDATE logs
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

  // ── DELETE /api/document/:logId/versions/:versionId ──────

  describe('DELETE /api/document/:logId/versions/:versionId', () => {
    it('allows the version author to delete', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 5, created_by: TEST_USER.id, archive_id: 1 }])  // version found, user is author
        .mockResolvedValueOnce([]);  // DELETE

      const res = await request(app)
        .delete('/api/document/1/versions/5')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('allows squad owner to delete', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 5, created_by: 999, archive_id: 1 }])  // version found, different author
        .mockResolvedValueOnce([{ can_delete_version: false, role: 'owner' }])  // squad member is owner
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
        .mockResolvedValueOnce([{ id: 5, created_by: 999, archive_id: 1 }])  // version found
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
        .mockResolvedValueOnce([{ id: 5, created_by: 999, archive_id: 1 }])  // version found
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

  // ── GET /api/document/:logId/export ──────────────────────

  describe('GET /api/document/:logId/export', () => {
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

    it('rejects invalid log ID', async () => {
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

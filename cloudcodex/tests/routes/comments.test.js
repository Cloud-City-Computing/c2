import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER, TEST_USER_2 } from '../helpers.js';

const COMMENT_ROW = {
  id: 10, log_id: 1, user_id: TEST_USER.id, content: 'Looks good',
  tag: 'comment', status: 'open', selection_start: 0, selection_end: 10,
  selected_text: 'Hello World', resolved_by: null, resolved_at: null,
  created_at: '2026-01-01', updated_at: '2026-01-01',
  user_name: TEST_USER.name, user_email: TEST_USER.email,
  resolved_by_name: null,
};

const REPLY_ROW = {
  id: 20, comment_id: 10, user_id: TEST_USER.id, content: 'Thanks!',
  created_at: '2026-01-02', updated_at: '2026-01-02',
  user_name: TEST_USER.name, user_email: TEST_USER.email,
};

describe('Comment Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── GET /api/logs/:logId/comments ─────────────────────────

  describe('GET /api/logs/:logId/comments', () => {
    it('returns comments with replies', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])          // checkLogReadAccess
        .mockResolvedValueOnce([COMMENT_ROW])         // SELECT comments
        .mockResolvedValueOnce([REPLY_ROW]);          // SELECT replies

      const res = await request(app)
        .get('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.comments).toHaveLength(1);
      expect(res.body.comments[0].content).toBe('Looks good');
      expect(res.body.comments[0].replies).toHaveLength(1);
      expect(res.body.comments[0].replies[0].content).toBe('Thanks!');
    });

    it('returns empty list when no comments', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])   // checkLogReadAccess
        .mockResolvedValueOnce([]);            // no comments

      const res = await request(app)
        .get('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.comments).toEqual([]);
    });

    it('filters by status query param', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([{ ...COMMENT_ROW, status: 'resolved' }])
        .mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/logs/1/comments?status=resolved')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      // Verify the SQL query included status filter
      const queryCall = c2_query.mock.calls[1];
      expect(queryCall[0]).toContain('c.status = ?');
      expect(queryCall[1]).toContain('resolved');
    });

    it('ignores invalid status filter', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([])

      const res = await request(app)
        .get('/api/logs/1/comments?status=bogus')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      // Should not include status filter in query
      const queryCall = c2_query.mock.calls[1];
      expect(queryCall[0]).not.toContain('c.status = ?');
    });

    it('rejects without read access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // checkLogReadAccess → denied

      const res = await request(app)
        .get('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid log ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/logs/abc/comments')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/logs/1/comments')
        .set('Authorization', 'Bearer bad-token');

      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/logs/:logId/comments/count ───────────────────

  describe('GET /api/logs/:logId/comments/count', () => {
    it('returns open comment count', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])     // checkLogReadAccess
        .mockResolvedValueOnce([{ count: 5 }]);  // COUNT(*)

      const res = await request(app)
        .get('/api/logs/1/comments/count')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(5);
    });

    it('returns 0 when no open comments', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([{ count: 0 }]);

      const res = await request(app)
        .get('/api/logs/1/comments/count')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
    });

    it('rejects without read access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/logs/1/comments/count')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid log ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/logs/0/comments/count')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/logs/:logId/comments ────────────────────────

  describe('POST /api/logs/:logId/comments', () => {
    it('creates a comment', async () => {
      mockAuthenticated();
      const created = { ...COMMENT_ROW, id: 11, content: 'New comment' };
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])              // checkLogReadAccess
        .mockResolvedValueOnce({ insertId: 11 })          // INSERT
        .mockResolvedValueOnce([created]);                 // SELECT back

      const res = await request(app)
        .post('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'New comment', tag: 'suggestion' });

      expect(res.status).toBe(201);
      expect(res.body.comment.content).toBe('New comment');
      expect(res.body.comment.replies).toEqual([]);
    });

    it('creates a comment with selection data', async () => {
      mockAuthenticated();
      const created = { ...COMMENT_ROW, selected_text: 'selected' };
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce({ insertId: 10 })
        .mockResolvedValueOnce([created]);

      const res = await request(app)
        .post('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token')
        .send({
          content: 'About this text',
          selection_start: 5,
          selection_end: 13,
          selected_text: 'selected',
        });

      expect(res.status).toBe(201);
      // Verify selection fields were passed to INSERT
      const insertCall = c2_query.mock.calls[1];
      expect(insertCall[1]).toContain(5);
      expect(insertCall[1]).toContain(13);
    });

    it('defaults tag to comment', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce({ insertId: 11 })
        .mockResolvedValueOnce([COMMENT_ROW]);

      await request(app)
        .post('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'No tag specified' });

      const insertCall = c2_query.mock.calls[1];
      expect(insertCall[1]).toContain('comment');
    });

    it('rejects empty content', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1 }]);

      const res = await request(app)
        .post('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: '' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/content.*required/i);
    });

    it('rejects missing content', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1 }]);

      const res = await request(app)
        .post('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token')
        .send({ tag: 'question' });

      expect(res.status).toBe(400);
    });

    it('rejects content over max length', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1 }]);

      const res = await request(app)
        .post('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'x'.repeat(10001) });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/too long/i);
    });

    it('rejects invalid tag', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1 }]);

      const res = await request(app)
        .post('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'Test', tag: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid tag/);
    });

    it('rejects negative selection_start', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1 }]);

      const res = await request(app)
        .post('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'Test', selection_start: -1 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/selection_start/i);
    });

    it('rejects non-integer selection_end', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1 }]);

      const res = await request(app)
        .post('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'Test', selection_end: 1.5 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/selection_end/i);
    });

    it('rejects without read access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'Blocked' });

      expect(res.status).toBe(403);
    });

    it('rejects invalid log ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/logs/abc/comments')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'Test' });

      expect(res.status).toBe(400);
    });
  });

  // ── PUT /api/comments/:commentId ────────────────────────────

  describe('PUT /api/comments/:commentId', () => {
    it('updates content for author', async () => {
      mockAuthenticated();
      const updated = { ...COMMENT_ROW, content: 'Edited' };
      c2_query
        .mockResolvedValueOnce([COMMENT_ROW])    // SELECT comment (ownership check)
        .mockResolvedValueOnce([])                // UPDATE
        .mockResolvedValueOnce([updated]);        // SELECT updated

      const res = await request(app)
        .put('/api/comments/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'Edited' });

      expect(res.status).toBe(200);
      expect(res.body.comment.content).toBe('Edited');
    });

    it('updates tag for author', async () => {
      mockAuthenticated();
      const updated = { ...COMMENT_ROW, tag: 'question' };
      c2_query
        .mockResolvedValueOnce([COMMENT_ROW])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([updated]);

      const res = await request(app)
        .put('/api/comments/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ tag: 'question' });

      expect(res.status).toBe(200);
      expect(res.body.comment.tag).toBe('question');
    });

    it('rejects edit by non-author', async () => {
      mockAuthenticated(TEST_USER_2);
      c2_query.mockResolvedValueOnce([COMMENT_ROW]); // comment owned by TEST_USER

      const res = await request(app)
        .put('/api/comments/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'Hacked' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/own comments/i);
    });

    it('returns 404 when comment not found', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .put('/api/comments/999')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'Ghost' });

      expect(res.status).toBe(404);
    });

    it('rejects empty content', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([COMMENT_ROW]);

      const res = await request(app)
        .put('/api/comments/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: '   ' });

      expect(res.status).toBe(400);
    });

    it('rejects invalid tag', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([COMMENT_ROW]);

      const res = await request(app)
        .put('/api/comments/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ tag: 'mood' });

      expect(res.status).toBe(400);
    });

    it('rejects when nothing to update', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([COMMENT_ROW]);

      const res = await request(app)
        .put('/api/comments/10')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Nothing to update/i);
    });

    it('rejects invalid comment ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/comments/abc')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'Test' });

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/comments/:commentId/resolve ───────────────────

  describe('POST /api/comments/:commentId/resolve', () => {
    it('resolves a comment', async () => {
      mockAuthenticated();
      const resolved = { ...COMMENT_ROW, status: 'resolved', resolved_by: TEST_USER.id, resolved_by_name: TEST_USER.name };
      c2_query
        .mockResolvedValueOnce([COMMENT_ROW])   // SELECT comment
        .mockResolvedValueOnce([{ id: 1 }])     // checkLogReadAccess
        .mockResolvedValueOnce([])               // UPDATE
        .mockResolvedValueOnce([resolved]);      // SELECT updated

      const res = await request(app)
        .post('/api/comments/10/resolve')
        .set('Authorization', 'Bearer valid-token')
        .send({ status: 'resolved' });

      expect(res.status).toBe(200);
      expect(res.body.comment.status).toBe('resolved');
    });

    it('dismisses a comment', async () => {
      mockAuthenticated();
      const dismissed = { ...COMMENT_ROW, status: 'dismissed' };
      c2_query
        .mockResolvedValueOnce([COMMENT_ROW])
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([dismissed]);

      const res = await request(app)
        .post('/api/comments/10/resolve')
        .set('Authorization', 'Bearer valid-token')
        .send({ status: 'dismissed' });

      expect(res.status).toBe(200);
      expect(res.body.comment.status).toBe('dismissed');
    });

    it('rejects invalid status', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([COMMENT_ROW]);

      const res = await request(app)
        .post('/api/comments/10/resolve')
        .set('Authorization', 'Bearer valid-token')
        .send({ status: 'open' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/resolved.*dismissed/i);
    });

    it('rejects missing status', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/comments/10/resolve')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 404 when comment not found', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/comments/999/resolve')
        .set('Authorization', 'Bearer valid-token')
        .send({ status: 'resolved' });

      expect(res.status).toBe(404);
    });

    it('rejects without log access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([COMMENT_ROW])  // comment found
        .mockResolvedValueOnce([]);             // checkLogReadAccess → denied

      const res = await request(app)
        .post('/api/comments/10/resolve')
        .set('Authorization', 'Bearer valid-token')
        .send({ status: 'resolved' });

      expect(res.status).toBe(403);
    });

    it('rejects invalid comment ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/comments/abc/resolve')
        .set('Authorization', 'Bearer valid-token')
        .send({ status: 'resolved' });

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/comments/:commentId/reopen ────────────────────

  describe('POST /api/comments/:commentId/reopen', () => {
    it('reopens a resolved comment', async () => {
      mockAuthenticated();
      const resolvedComment = { ...COMMENT_ROW, status: 'resolved' };
      c2_query
        .mockResolvedValueOnce([resolvedComment])  // SELECT comment
        .mockResolvedValueOnce([{ id: 1 }])        // checkLogReadAccess
        .mockResolvedValueOnce([]);                 // UPDATE

      const res = await request(app)
        .post('/api/comments/10/reopen')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when comment not found', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/comments/999/reopen')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects without log access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([COMMENT_ROW])
        .mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/comments/10/reopen')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid comment ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/comments/0/reopen')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/comments/:commentId ─────────────────────────

  describe('DELETE /api/comments/:commentId', () => {
    it('deletes comment for author', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([COMMENT_ROW])   // SELECT comment
        .mockResolvedValueOnce([]);              // DELETE

      const res = await request(app)
        .delete('/api/comments/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects delete by non-author', async () => {
      mockAuthenticated(TEST_USER_2);
      c2_query.mockResolvedValueOnce([COMMENT_ROW]);

      const res = await request(app)
        .delete('/api/comments/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/own comments/i);
    });

    it('returns 404 when comment not found', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .delete('/api/comments/999')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects invalid comment ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .delete('/api/comments/abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/logs/:logId/comments ──────────────────────

  describe('DELETE /api/logs/:logId/comments', () => {
    it('clears all comments with write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])    // checkLogWriteAccess
        .mockResolvedValueOnce([]);             // DELETE

      const res = await request(app)
        .delete('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .delete('/api/logs/1/comments')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/write access/i);
    });

    it('rejects invalid log ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .delete('/api/logs/-1/comments')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/comments/:commentId/replies ───────────────────

  describe('POST /api/comments/:commentId/replies', () => {
    it('creates a reply', async () => {
      mockAuthenticated();
      const newReply = { ...REPLY_ROW, id: 21, content: 'Good point' };
      c2_query
        .mockResolvedValueOnce([COMMENT_ROW])     // SELECT comment
        .mockResolvedValueOnce([{ id: 1 }])       // checkLogReadAccess
        .mockResolvedValueOnce({ insertId: 21 })   // INSERT reply
        .mockResolvedValueOnce([newReply]);         // SELECT reply back

      const res = await request(app)
        .post('/api/comments/10/replies')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'Good point' });

      expect(res.status).toBe(201);
      expect(res.body.reply.content).toBe('Good point');
    });

    it('rejects empty reply content', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([COMMENT_ROW])
        .mockResolvedValueOnce([{ id: 1 }]);

      const res = await request(app)
        .post('/api/comments/10/replies')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: '' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/content.*required/i);
    });

    it('rejects reply over max length', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([COMMENT_ROW])
        .mockResolvedValueOnce([{ id: 1 }]);

      const res = await request(app)
        .post('/api/comments/10/replies')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'y'.repeat(10001) });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/too long/i);
    });

    it('returns 404 when comment not found', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/comments/999/replies')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'Reply to ghost' });

      expect(res.status).toBe(404);
    });

    it('rejects without log access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([COMMENT_ROW])
        .mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/comments/10/replies')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'Blocked reply' });

      expect(res.status).toBe(403);
    });

    it('rejects invalid comment ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/comments/abc/replies')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: 'Test' });

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/replies/:replyId ────────────────────────────

  describe('DELETE /api/replies/:replyId', () => {
    it('deletes reply for author', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([REPLY_ROW])    // SELECT reply
        .mockResolvedValueOnce([]);             // DELETE

      const res = await request(app)
        .delete('/api/replies/20')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects delete by non-author', async () => {
      mockAuthenticated(TEST_USER_2);
      c2_query.mockResolvedValueOnce([REPLY_ROW]); // reply owned by TEST_USER

      const res = await request(app)
        .delete('/api/replies/20')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/own replies/i);
    });

    it('returns 404 when reply not found', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .delete('/api/replies/999')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects invalid reply ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .delete('/api/replies/abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });
});

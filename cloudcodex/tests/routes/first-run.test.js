/**
 * Cloud Codex - Tests for routes/first-run.js
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

beforeEach(() => {
  resetMocks();
  mockAuthenticated();
});

describe('GET /api/first-run', () => {
  it('requires authentication', async () => {
    mockUnauthenticated();
    const res = await request(app).get('/api/first-run');
    expect(res.status).toBe(401);
  });

  it('short-circuits in one query once the user is onboarded', async () => {
    c2_query.mockResolvedValueOnce([{ onboarded_at: new Date() }]);

    const res = await request(app)
      .get('/api/first-run')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.needsOnboarding).toBe(false);
    expect(res.body.squad).toBeUndefined();
    expect(c2_query).toHaveBeenCalledTimes(1);
  });

  it('returns the squad, archive and log a fresh user should be shown', async () => {
    c2_query.mockResolvedValueOnce([{ onboarded_at: null }]);
    c2_query.mockResolvedValueOnce([{ id: 3, name: 'General' }]);
    c2_query.mockResolvedValueOnce([{ id: 5, name: 'Getting Started' }]);
    c2_query.mockResolvedValueOnce([{ id: 9, title: 'Welcome to Cloud Codex' }]);
    c2_query.mockResolvedValueOnce([{ n: 2 }]);

    const res = await request(app)
      .get('/api/first-run')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      needsOnboarding: true,
      isAdmin: false,
      squad: { id: 3, name: 'General' },
      archive: { id: 5, name: 'Getting Started' },
      log: { id: 9, title: 'Welcome to Cloud Codex' },
      pendingSquadInvites: 2,
    });
  });

  it('resolves the archive through the ownership fragment with all seven params, plus the squad ordering param', async () => {
    c2_query.mockResolvedValueOnce([{ onboarded_at: null }]);
    c2_query.mockResolvedValueOnce([{ id: 3, name: 'General' }]);
    c2_query.mockResolvedValueOnce([]);
    c2_query.mockResolvedValueOnce([{ n: 0 }]);

    await request(app).get('/api/first-run').set('Authorization', 'Bearer valid-token');

    const archiveCall = c2_query.mock.calls[2];
    expect(archiveCall[0]).toContain('FROM archives');
    // The seven ownership params, in the fragment's own order, plus the
    // squad id bound after them because the ORDER BY placeholder sits
    // textually after the WHERE fragment in the final SQL string.
    expect(archiveCall[1]).toEqual([
      Boolean(TEST_USER.is_admin),
      JSON.stringify(TEST_USER.id),
      TEST_USER.id,
      TEST_USER.id, // workspace owner, matched on users.id not an email
      TEST_USER.id,
      TEST_USER.id,
      TEST_USER.id,
      3,
    ]);
  });

  it('excludes system archives from the lookup, even for an admin whose bypass clause would otherwise match every row', async () => {
    mockAuthenticated({ ...TEST_USER, is_admin: true });
    c2_query.mockResolvedValueOnce([{ onboarded_at: null }]);
    c2_query.mockResolvedValueOnce([]);
    c2_query.mockResolvedValueOnce([{ id: 8, name: 'Getting Started' }]);
    c2_query.mockResolvedValueOnce([{ id: 20, title: 'Welcome to Cloud Codex' }]);
    c2_query.mockResolvedValueOnce([{ n: 0 }]);

    const res = await request(app)
      .get('/api/first-run')
      .set('Authorization', 'Bearer valid-token');

    const archiveCall = c2_query.mock.calls[2];
    expect(archiveCall[0]).toContain('`system` = FALSE');
    expect(res.body.archive).toEqual({ id: 8, name: 'Getting Started' });
  });

  it('orders the archive query toward the resolved squad by binding its id after the ownership params', async () => {
    c2_query.mockResolvedValueOnce([{ onboarded_at: null }]);
    c2_query.mockResolvedValueOnce([{ id: 3, name: 'General' }]);
    c2_query.mockResolvedValueOnce([{ id: 5, name: 'Getting Started' }]);
    c2_query.mockResolvedValueOnce([{ id: 9, title: 'Welcome to Cloud Codex' }]);
    c2_query.mockResolvedValueOnce([{ n: 0 }]);

    await request(app).get('/api/first-run').set('Authorization', 'Bearer valid-token');

    const archiveCall = c2_query.mock.calls[2];
    expect(archiveCall[0]).toContain('ORDER BY (p.squad_id = ?) DESC');
    expect(archiveCall[1]).toHaveLength(8);
    expect(archiveCall[1][7]).toBe(3);
  });

  it('falls back to the oldest readable non-system archive when the user has no squad, binding null rather than excluding everything', async () => {
    c2_query.mockResolvedValueOnce([{ onboarded_at: null }]);
    c2_query.mockResolvedValueOnce([]);
    c2_query.mockResolvedValueOnce([{ id: 11, name: 'Shared Archive' }]);
    c2_query.mockResolvedValueOnce([{ id: 40, title: 'Welcome to Cloud Codex' }]);
    c2_query.mockResolvedValueOnce([{ n: 0 }]);

    const res = await request(app)
      .get('/api/first-run')
      .set('Authorization', 'Bearer valid-token');

    const archiveCall = c2_query.mock.calls[2];
    expect(archiveCall[1][7]).toBeNull();
    expect(res.body.archive).toEqual({ id: 11, name: 'Shared Archive' });
  });

  it('skips the log lookup and reports nulls when the user reaches no archive', async () => {
    c2_query.mockResolvedValueOnce([{ onboarded_at: null }]);
    c2_query.mockResolvedValueOnce([]);
    c2_query.mockResolvedValueOnce([]);
    c2_query.mockResolvedValueOnce([{ n: 0 }]);

    const res = await request(app)
      .get('/api/first-run')
      .set('Authorization', 'Bearer valid-token');

    expect(res.body.squad).toBeNull();
    expect(res.body.archive).toBeNull();
    expect(res.body.log).toBeNull();
    expect(c2_query.mock.calls.some(c => c[0].includes('FROM logs'))).toBe(false);
  });

  it('reports admin status from the session user', async () => {
    mockAuthenticated({ ...TEST_USER, is_admin: true });
    c2_query.mockResolvedValueOnce([{ onboarded_at: null }]);
    c2_query.mockResolvedValueOnce([]);
    c2_query.mockResolvedValueOnce([]);
    c2_query.mockResolvedValueOnce([{ n: 0 }]);

    const res = await request(app)
      .get('/api/first-run')
      .set('Authorization', 'Bearer valid-token');

    expect(res.body.isAdmin).toBe(true);
  });

  it('treats a missing user row as still needing onboarding', async () => {
    c2_query.mockResolvedValueOnce([]);
    c2_query.mockResolvedValueOnce([]);
    c2_query.mockResolvedValueOnce([]);
    c2_query.mockResolvedValueOnce([{ n: 0 }]);

    const res = await request(app)
      .get('/api/first-run')
      .set('Authorization', 'Bearer valid-token');

    expect(res.body.needsOnboarding).toBe(true);
  });
});

describe('POST /api/first-run/complete', () => {
  it('requires authentication', async () => {
    mockUnauthenticated();
    const res = await request(app).post('/api/first-run/complete');
    expect(res.status).toBe(401);
  });

  it('stamps onboarded_at only while it is still null', async () => {
    c2_query.mockResolvedValueOnce({ affectedRows: 1 });

    const res = await request(app)
      .post('/api/first-run/complete')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(c2_query.mock.calls[0][0]).toContain('onboarded_at IS NULL');
    expect(c2_query.mock.calls[0][1]).toEqual([TEST_USER.id]);
  });

  it('is idempotent when it stamps nothing', async () => {
    c2_query.mockResolvedValueOnce({ affectedRows: 0 });

    const res = await request(app)
      .post('/api/first-run/complete')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

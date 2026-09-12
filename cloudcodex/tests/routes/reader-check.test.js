import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, validateAndAutoLogin } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

/**
 * C2-5 — GET /api/workspaces/:workspaceId/reader-check
 *
 * The endpoint exists to close an enumeration in the SUITE: Cloud Command's
 * `c2_workspace_id` was caller-asserted, so any account that could make a Cloud
 * Command workspace could point it at any workspace here and read document
 * titles out of it. Cloud Command can only ask; the answer has to come from the
 * system that owns the rules.
 *
 * WHAT THIS FILE IS REALLY GUARDING is the MACHINE-ONLY property. The endpoint
 * answers a question about a THIRD PARTY, so a session must not reach it — and
 * the test that proves that has to be written carefully, or it proves nothing.
 * See the comment on the session case.
 */

const SERVICE_TOKEN = 'cloud-command-service-token-00000000';
const SERVICE_ROW = { id: 9, name: 'cloud-command', email: 'svc@example.com', is_admin: 0 };

/** One row of the shape the reader-check query returns. MySQL gives 0/1. */
const answer = ({ isAdmin = 0, ownsIt = 0, inASquad = 0 } = {}) => [{ isAdmin, ownsIt, inASquad }];

describe('GET /api/workspaces/:workspaceId/reader-check (C2-5)', () => {
  beforeEach(() => {
    resetMocks();
    process.env.SERVICE_TOKEN = SERVICE_TOKEN;
    process.env.SERVICE_TOKEN_USER = 'svc@example.com';
    // No session row backs this token, so a 200 below can only come from the
    // machine path.
    mockUnauthenticated();
  });

  afterEach(() => {
    delete process.env.SERVICE_TOKEN;
    delete process.env.SERVICE_TOKEN_USER;
  });

  function ask(workspaceId, email, token = SERVICE_TOKEN) {
    return request(app)
      .get(`/api/workspaces/${workspaceId}/reader-check?email=${encodeURIComponent(email)}`)
      .set('Authorization', `Bearer ${token}`);
  }

  describe('who can read a workspace, derived from the rules this product already has', () => {
    it('says true for the workspace OWNER', async () => {
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);        // principal lookup
      c2_query.mockResolvedValueOnce(answer({ ownsIt: 1 }));

      const res = await ask(7, 'owner@example.com');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ canRead: true });
    });

    it('says true for a member of any SQUAD in that workspace', async () => {
      // Deliberately NOT "has read access to an archive". A person who belongs
      // to the workspace but has no archive grants yet should still be able to
      // connect it; the per-archive grants still apply to every search after.
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);
      c2_query.mockResolvedValueOnce(answer({ inASquad: 1 }));

      const res = await ask(7, 'member@example.com');

      expect(res.body).toEqual({ canRead: true });
    });

    it('says true for an ADMIN, who reads every archive in the install', async () => {
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);
      c2_query.mockResolvedValueOnce(answer({ isAdmin: 1 }));

      const res = await ask(7, 'root@example.com');

      expect(res.body).toEqual({ canRead: true });
    });

    it('says false for a real user with no connection to that workspace', async () => {
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);
      c2_query.mockResolvedValueOnce(answer());

      const res = await ask(7, 'stranger@example.com');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ canRead: false });
    });
  });

  describe('it does not become an account-existence oracle', () => {
    it('answers an UNKNOWN email identically to an unauthorised one', async () => {
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);
      c2_query.mockResolvedValueOnce([]); // no users row at all

      const unknown = await ask(7, 'nobody@example.com');

      c2_query.mockResolvedValueOnce([SERVICE_ROW]);
      c2_query.mockResolvedValueOnce(answer());
      const unauthorised = await ask(7, 'stranger@example.com');

      // Same status AND same body. A difference in either would tell whoever
      // holds the service token which addresses have accounts here.
      expect(unknown.status).toBe(unauthorised.status);
      expect(unknown.body).toEqual(unauthorised.body);
      expect(unknown.body).toEqual({ canRead: false });
    });

    it('answers false for a workspace that does not exist, rather than 404', async () => {
      // The absence of a workspace is not a fact this endpoint should disclose
      // either: a 404 here maps the id space for the caller.
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);
      c2_query.mockResolvedValueOnce(answer());

      const res = await ask(999999, 'someone@example.com');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ canRead: false });
    });
  });

  describe('machine-only, which is the whole security property', () => {
    it('REFUSES a logged-in session, whatever their role', async () => {
      /*
       * THE PRINCIPAL ROW IS QUEUED DELIBERATELY, and is unused by the passing
       * path. Without it this test is a FALSE GREEN: with no row queued the
       * machine credential lookup finds nothing and the request is refused
       * anyway, so the 401 would prove nothing about requireMachine — the route
       * could have been written with machineOrAuth and still pass.
       *
       * With the row queued, a route that fell through to a session would find
       * a valid authenticated user and answer 200.
       */
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);
      mockAuthenticated(TEST_USER);

      const res = await request(app)
        .get('/api/workspaces/7/reader-check?email=someone@example.com')
        .set('Authorization', 'Bearer a-real-session-token');

      expect(res.status).toBe(401);
      expect(res.body.canRead).toBeUndefined();
    });

    it('REFUSES an admin session too, because the tier is not the point', async () => {
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);
      mockAuthenticated({ ...TEST_USER, is_admin: 1 });

      const res = await request(app)
        .get('/api/workspaces/7/reader-check?email=someone@example.com')
        .set('Authorization', 'Bearer an-admin-session-token');

      expect(res.status).toBe(401);
    });

    it('refuses an unauthenticated caller', async () => {
      const res = await request(app).get(
        '/api/workspaces/7/reader-check?email=someone@example.com'
      );

      expect(res.status).toBe(401);
    });

    it('never consults the session validator on the machine path', async () => {
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);
      c2_query.mockResolvedValueOnce(answer({ ownsIt: 1 }));

      await ask(7, 'owner@example.com');

      expect(validateAndAutoLogin).not.toHaveBeenCalled();
    });
  });

  describe('the inputs', () => {
    it('refuses a non-numeric workspace id', async () => {
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);

      const res = await ask('not-a-number', 'someone@example.com');

      expect(res.status).toBe(400);
    });

    it('refuses a missing email', async () => {
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);

      const res = await request(app)
        .get('/api/workspaces/7/reader-check')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`);

      expect(res.status).toBe(400);
    });

    it('refuses an absurdly long email rather than passing it to the database', async () => {
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);

      const res = await ask(7, `${'a'.repeat(300)}@example.com`);

      expect(res.status).toBe(400);
    });
  });

  describe('the query itself', () => {
    it('binds the workspace id as a NUMBER and the email as a string', async () => {
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);
      c2_query.mockResolvedValueOnce(answer({ ownsIt: 1 }));

      await ask(7, 'Owner@Example.com');

      // The reader-check query is the second call; the first is the principal
      // lookup the machine credential makes.
      const [sql, params] = c2_query.mock.calls[1];
      expect(params).toEqual([7, 7, 'Owner@Example.com']);
      // workspaces.owner_id is an INT foreign key. Binding a string against it
      // matches nothing and silently denies access with nothing logged, which
      // is the class tests/helpers.js's own owner-predicate guard exists for.
      expect(typeof params[0]).toBe('number');
      // Case-insensitively, so the intent survives a collation change rather
      // than depending on MySQL's default.
      expect(sql).toMatch(/LOWER\(u\.email\)\s*=\s*LOWER\(\?\)/);
    });
  });
});

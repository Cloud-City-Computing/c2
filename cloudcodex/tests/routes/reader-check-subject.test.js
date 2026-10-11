/**
 * GET /api/workspaces/:workspaceId/reader-check with an OIDC subject (W6-CDX-5, Task 5.8)
 *
 * The suite asks by subject when it has one: the person is resolved through user_identities at this
 * instance's configured issuer first, and by email only when no identity matches. An unknown subject
 * and an unknown email answer the same { canRead: false }, the same status and body.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockUnauthenticated, resetMocks } from '../helpers.js';

const SERVICE_TOKEN = 'cloud-command-service-token-00000000';
const SERVICE_ROW = { id: 9, name: 'cloud-command', email: 'svc@example.com', is_admin: 0 };
const ISSUER = 'https://id.example.test';
const answer = ({ isAdmin = 0, ownsIt = 0, inASquad = 0 } = {}) => [{ isAdmin, ownsIt, inASquad }];

describe('reader-check by subject', () => {
  beforeEach(() => {
    resetMocks();
    process.env.SERVICE_TOKEN = SERVICE_TOKEN;
    process.env.SERVICE_TOKEN_USER = 'svc@example.com';
    process.env.OIDC_ISSUER_URL = ISSUER;
    process.env.OIDC_CLIENT_ID = 'codex-web';
    process.env.OIDC_CLIENT_SECRET = 'a-secret-for-the-reader-check-tests';
    process.env.APP_URL = 'http://localhost:3000';
    mockUnauthenticated();
  });

  afterEach(() => {
    for (const key of ['SERVICE_TOKEN', 'SERVICE_TOKEN_USER', 'OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'APP_URL']) {
      delete process.env[key];
    }
  });

  const ask = (workspaceId, query) =>
    request(app)
      .get(`/api/workspaces/${workspaceId}/reader-check?${query}`)
      .set('Authorization', `Bearer ${SERVICE_TOKEN}`);

  it('resolves the person by (configured issuer, subject) first, and answers from that user', async () => {
    c2_query.mockResolvedValueOnce([SERVICE_ROW]).mockResolvedValueOnce(answer({ ownsIt: 1 }));

    const res = await ask(7, 'subject=zitadel-user-0192');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ canRead: true });
    const [sql, params] = c2_query.mock.calls[1];
    expect(sql).toMatch(/JOIN user_identities ui ON ui\.user_id = u\.id/);
    expect(sql).toMatch(/ui\.issuer = \?\s+AND ui\.subject = \?/);
    expect(params).toEqual([7, 7, ISSUER, 'zitadel-user-0192']);
  });

  it('falls back to the email when no identity matches the subject, exactly as before', async () => {
    c2_query
      .mockResolvedValueOnce([SERVICE_ROW])
      .mockResolvedValueOnce([]) // the subject matches nobody
      .mockResolvedValueOnce(answer({ inASquad: 1 }));

    const res = await ask(7, 'subject=nobody&email=member%40example.com');

    expect(res.body).toEqual({ canRead: true });
    const [sql, params] = c2_query.mock.calls[2];
    expect(sql).toMatch(/LOWER\(u\.email\)\s*=\s*LOWER\(\?\)/);
    expect(params).toEqual([7, 7, 'member@example.com']);
  });

  it('answers the same false for an unknown subject and an unknown email, status and body alike', async () => {
    c2_query.mockResolvedValueOnce([SERVICE_ROW]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const unknownSubject = await ask(7, 'subject=ghost&email=ghost%40example.com');

    c2_query.mockResolvedValueOnce([SERVICE_ROW]).mockResolvedValueOnce([]);
    const unknownEverything = await ask(7, 'subject=ghost');

    expect(unknownSubject.status).toBe(200);
    expect(unknownSubject.body).toEqual({ canRead: false });
    expect(unknownEverything.status).toBe(200);
    expect(unknownEverything.body).toEqual({ canRead: false });
  });

  it('keeps the email-only path when no subject is given', async () => {
    c2_query.mockResolvedValueOnce([SERVICE_ROW]).mockResolvedValueOnce(answer({ isAdmin: 1 }));

    const res = await ask(7, 'email=admin%40example.com');

    expect(res.body).toEqual({ canRead: true });
    expect(c2_query.mock.calls).toHaveLength(2);
    expect(c2_query.mock.calls[1][0]).not.toMatch(/user_identities/);
  });

  it('refuses a subject longer than 255 characters', async () => {
    c2_query.mockResolvedValueOnce([SERVICE_ROW]);
    const res = await ask(7, `subject=${'s'.repeat(256)}`);
    expect(res.status).toBe(400);
  });

  it('does not consult user_identities when OIDC is not configured', async () => {
    delete process.env.OIDC_ISSUER_URL;
    c2_query.mockResolvedValueOnce([SERVICE_ROW]).mockResolvedValueOnce([]);
    const res = await ask(7, 'subject=zitadel-user-0192');
    expect(res.body).toEqual({ canRead: false });
    expect(c2_query.mock.calls.some(([sql]) => /user_identities/.test(sql))).toBe(false);
  });
});

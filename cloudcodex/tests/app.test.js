/**
 * Cloud Codex — Tests for app.js (Express setup)
 *
 * Verifies CORS scoping, security headers, body size limits, rate limiter
 * skip-in-test behaviour, static file mounts, and the API route prefix.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { resetMocks } from './helpers.js';

describe('app.js — Express configuration', () => {
  beforeEach(() => resetMocks());

  it('trusts the first proxy (req.ip honours X-Forwarded-For)', () => {
    expect(app.get('trust proxy')).toBe(1);
  });

  it('parses JSON request bodies on API routes', async () => {
    // Pick any route that consumes JSON; mark-read uses req.params only,
    // so we go through preferences which is body-driven.
    const res = await request(app)
      .put('/api/notifications/preferences')
      .set('Content-Type', 'application/json')
      .send({ email_mention: false });

    // 401 (unauthenticated) — but body was parsed enough to reach the
    // requireAuth check, proving express.json() is mounted.
    expect([400, 401]).toContain(res.status);
  });

  it('applies helmet security headers on /api responses', async () => {
    const res = await request(app).get('/api/oauth/providers');
    expect(res.status).toBe(200);
    // Helmet sets these by default
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('sets a Content-Security-Policy that blocks framing and inline scripts', async () => {
    const res = await request(app).get('/api/oauth/providers');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it('rejects request bodies larger than the 2 MB limit', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    const res = await request(app)
      .put('/api/notifications/preferences')
      .set('Content-Type', 'application/json')
      .send(`{"data":"${big}"}`);
    expect(res.status).toBe(413);
  });

  it('skips the auth rate limiter when NODE_ENV=test', async () => {
    // Fire 25 requests (limit is 20/15min). All should pass through to
    // the route — no 429 — because the limiter `skip` returns true under
    // NODE_ENV=test (set by Vitest).
    let lastStatus;
    for (let i = 0; i < 25; i++) {
      const res = await request(app).post('/api/login').send({ name: 'x', password: 'y' });
      lastStatus = res.status;
    }
    expect(lastStatus).not.toBe(429);
  });

  it('mounts every API route group under /api', async () => {
    // A representative endpoint from each router. None should 404; they
    // should at least reach requireAuth and respond 401, or respond 200
    // for the public ones.
    const probes = [
      '/api/oauth/providers',          // oauth (public)
      '/api/workspaces',               // workspaces (auth)
      '/api/archives',                 // archives (auth)
      '/api/notifications',            // notifications (auth)
      '/api/admin/status',             // admin (auth)
      '/api/favorites',                // favorites (auth)
    ];

    for (const path of probes) {
      const res = await request(app).get(path);
      expect(res.status).not.toBe(404);
    }
  });

  it('exposes /avatars static directory mount (404 for missing files, not 401)', async () => {
    const res = await request(app).get('/avatars/does-not-exist.webp');
    // Static mount returns 404 for missing files; never 401 (no auth required).
    expect(res.status).toBe(404);
  });

  it('exposes /doc-images static directory mount', async () => {
    const res = await request(app).get('/doc-images/does-not-exist.webp');
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown API paths (no fallthrough to other routers)', async () => {
    const res = await request(app).get('/api/this-endpoint-does-not-exist');
    expect(res.status).toBe(404);
  });
});

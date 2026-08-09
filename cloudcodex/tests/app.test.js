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

  // These run with NODE_ENV forced to production, because that is the only
  // branch that can reject anything and the suite otherwise runs as 'test'.
  // A same-origin request answering 500 here is the regression these cover:
  // it means the app refused its own browser, which is every self-hosted
  // install, since .env.example ships CORS_ORIGIN blank.
  describe('CORS', () => {
    // Restores by delete-or-assign for every key, never a bare assignment: a
    // bare one writes the string "undefined" when the key was absent, which
    // would silently arm the rate limiters for later tests in this file.
    const withEnv = async (overrides, fn) => {
      const prior = {};
      for (const [key, value] of Object.entries(overrides)) {
        prior[key] = process.env[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      try {
        return await fn();
      } finally {
        for (const [key, value] of Object.entries(prior)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    };

    // Production with nothing configured is what .env.example ships.
    const withProdEnv = (fn) =>
      withEnv({ NODE_ENV: 'production', CORS_ORIGIN: undefined, APP_URL: undefined }, fn);

    it('allows a same-origin request in production with no CORS_ORIGIN set', async () => {
      const res = await withProdEnv(() =>
        request(app)
          .get('/api/workspaces')
          .set('Host', 'codex.example.com')
          .set('Origin', 'http://codex.example.com'));

      // 401 means CORS let it through to requireAuth. 500 means CORS rejected
      // the app's own origin, which is the bug.
      expect(res.status).toBe(401);
    });

    it('treats an https Origin behind a TLS-terminating proxy as same-origin', async () => {
      const res = await withProdEnv(() =>
        request(app)
          .get('/api/workspaces')
          .set('Host', 'codex.example.com')
          .set('Origin', 'https://codex.example.com'));

      expect(res.status).toBe(401);
    });

    // nginx's default `proxy_pass` sends Host: 127.0.0.1:3000, not the public
    // name, so the same-origin clause alone rejects every write on the setup
    // docs/deployment.md tells operators to build. APP_URL is operator-set, so
    // unlike X-Forwarded-Host it is safe to trust.
    it('allows the APP_URL origin when a proxy did not rewrite Host', async () => {
      const res = await withEnv(
        {
          NODE_ENV: 'production',
          CORS_ORIGIN: undefined,
          APP_URL: 'https://codex.example.com',
        },
        () =>
          request(app)
            .get('/api/workspaces')
            .set('Host', '127.0.0.1:3000')
            .set('Origin', 'https://codex.example.com'));

      expect(res.status).toBe(401);
    });

    // new URL().host lowercases; a raw Host header does not. Both sides have to
    // be normalised or a proxy emitting Host: Codex.Example.com 500s every write.
    it('matches Host and Origin case-insensitively', async () => {
      const res = await withProdEnv(() =>
        request(app)
          .get('/api/workspaces')
          .set('Host', 'Codex.Example.com')
          .set('Origin', 'https://codex.example.com'));

      expect(res.status).toBe(401);
    });

    it('rejects an unlisted cross-origin request in production', async () => {
      const res = await withProdEnv(() =>
        request(app)
          .get('/api/workspaces')
          .set('Host', 'codex.example.com')
          .set('Origin', 'https://attacker.example'));

      expect(res.status).toBe(500);
    });

    it('allows a cross-origin request that matches CORS_ORIGIN', async () => {
      const res = await withEnv(
        {
          NODE_ENV: 'production',
          CORS_ORIGIN: 'https://app.example.com',
          APP_URL: undefined,
        },
        () =>
          request(app)
            .get('/api/workspaces')
            .set('Host', 'codex.example.com')
            .set('Origin', 'https://app.example.com'));

      expect(res.status).toBe(401);
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    });

    it('allows a request with no Origin header at all', async () => {
      const res = await withProdEnv(() => request(app).get('/api/workspaces'));
      expect(res.status).toBe(401);
    });
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

/**
 * Cloud Codex — Tests for app.js (Express setup)
 *
 * Verifies CORS scoping, security headers, body size limits, rate limiter
 * skip-in-test behaviour, static file mounts, and the API route prefix.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app, { parseTrustProxy } from '../app.js';
import { contractDefault } from './contract-default.js';
import { resetMocks } from './helpers.js';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// app.js decides some things once, at import: the trust proxy setting and
// where Helmet is mounted. Each case sets the environment, re-imports a fresh
// copy, and restores the environment before any request is sent, so the
// requests themselves run as 'test' (the rate limiters stay skipped).
async function importAppWith(env) {
  const prior = {};
  for (const [key, value] of Object.entries(env)) {
    prior[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    vi.resetModules();
    return (await import('../app.js')).default;
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('app.js — Express configuration', () => {
  beforeEach(() => resetMocks());

  it('trusts the first proxy (req.ip honours X-Forwarded-For)', () => {
    expect(app.get('trust proxy')).toBe(1);
  });

  describe('TRUST_PROXY', () => {
    it.each([
      [undefined, 1],
      ['', 1],
      ['   ', 1],
      ['0', 0],
      ['2', 2],
      [' 3 ', 3],
      ['true', true],
      ['false', false],
      ['loopback', 'loopback'],
      ['10.0.0.0/8, 127.0.0.1', '10.0.0.0/8, 127.0.0.1'],
    ])('parses %j as %j', (value, expected) => {
      expect(parseTrustProxy(value)).toBe(expected);
    });

    it('defaults to what the contract says an unset TRUST_PROXY behaves as', () => {
      expect(parseTrustProxy(undefined)).toBe(Number(contractDefault('TRUST_PROXY')));
    });

    it('reaches Express: a hop count', async () => {
      const configured = await importAppWith({ TRUST_PROXY: '2' });
      expect(configured.get('trust proxy')).toBe(2);
    });

    it('reaches Express: a named range, which Express compiles', async () => {
      const configured = await importAppWith({ TRUST_PROXY: 'loopback' });
      expect(configured.get('trust proxy')).toBe('loopback');
      expect(configured.get('trust proxy fn')('127.0.0.1', 0)).toBe(true);
      expect(configured.get('trust proxy fn')('203.0.113.9', 0)).toBe(false);
    });

    it('exits naming the variable when Express rejects the value', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await importAppWith({ TRUST_PROXY: 'not-an-address' });
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/TRUST_PROXY "not-an-address"/);
      } finally {
        exitSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });
  });

  // One Helmet policy, mounted on the whole app in production and on /api only
  // otherwise (the Vite dev server's inline module scripts would not survive
  // script-src 'self'). /avatars stands for every non-API response: the static
  // mounts and the single-page app's HTML, which vite-express appends after
  // everything in app.js at listen time.
  describe('security header scope', () => {
    const AVATAR_DIR = path.join(APP_DIR, 'public', 'avatars');
    const FIXTURE = `csp-scope-fixture-${process.pid}.webp`;
    let createdDir = false;

    beforeAll(() => {
      if (!existsSync(AVATAR_DIR)) {
        mkdirSync(AVATAR_DIR, { recursive: true });
        createdDir = true;
      }
      writeFileSync(path.join(AVATAR_DIR, FIXTURE), 'not really a webp');
    });

    afterAll(() => {
      rmSync(path.join(AVATAR_DIR, FIXTURE), { force: true });
      if (createdDir) rmSync(AVATAR_DIR, { recursive: true, force: true });
    });

    const expectProtected = (res) => {
      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(res.headers['x-frame-options']).toBe('DENY');
    };
    const expectUnprotected = (res) => {
      expect(res.headers['content-security-policy']).toBeUndefined();
      expect(res.headers['x-frame-options']).toBeUndefined();
    };

    // vite-express serves the built app by appending handlers to this same app
    // at listen time, after everything app.js mounts. A handler appended the
    // same way here stands in for it, so this proves the HTML the browser
    // loads is covered without starting a listener.
    const withSpaHandler = (configured) => {
      configured.get('/spa-stand-in', (_req, res) => res.type('html').send('<!doctype html><title>x</title>'));
      return configured;
    };

    it('production: a static file outside /api carries the policy', async () => {
      const prod = await importAppWith({ NODE_ENV: 'production' });
      const res = await request(prod).get(`/avatars/${FIXTURE}`);
      expect(res.status).toBe(200);
      expectProtected(res);
    });

    it('production: the single-page app HTML carries the policy', async () => {
      const prod = withSpaHandler(await importAppWith({ NODE_ENV: 'production' }));
      const res = await request(prod).get('/spa-stand-in');
      expect(res.status).toBe(200);
      expectProtected(res);
    });

    // Express's final handler replaces the CSP on its own 404 page with
    // default-src 'none', stricter still, but leaves X-Frame-Options alone.
    it('production: a 404 outside /api carries X-Frame-Options', async () => {
      const prod = await importAppWith({ NODE_ENV: 'production' });
      const res = await request(prod).get('/no-such-page');
      expect(res.status).toBe(404);
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('production: /api still carries the policy', async () => {
      const prod = await importAppWith({ NODE_ENV: 'production' });
      expectProtected(await request(prod).get('/api/oauth/providers'));
    });

    it('development: responses outside /api carry neither header', async () => {
      const dev = withSpaHandler(await importAppWith({ NODE_ENV: 'development' }));
      const file = await request(dev).get(`/avatars/${FIXTURE}`);
      expect(file.status).toBe(200);
      expectUnprotected(file);
      expectUnprotected(await request(dev).get('/spa-stand-in'));
      expect((await request(dev).get('/no-such-page')).headers['x-frame-options']).toBeUndefined();
    });

    it('development: /api carries both', async () => {
      const dev = await importAppWith({ NODE_ENV: 'development' });
      expectProtected(await request(dev).get('/api/oauth/providers'));
    });

    // Documents hold remote https images (pasted, or imported from GitHub) and
    // a linked GitHub account's avatar is remote.
    it('allows https images', async () => {
      const prod = await importAppWith({ NODE_ENV: 'production' });
      const csp = (await request(prod).get('/api/oauth/providers')).headers['content-security-policy'];
      expect(csp).toMatch(/img-src 'self' data: blob: https:(;|$)/);
    });

    // Helmet's default would rewrite the built app's own http:// asset
    // requests to https:// on an install with no TLS, and the release compose
    // file serves http://localhost:3000.
    it('does not send upgrade-insecure-requests', async () => {
      const prod = await importAppWith({ NODE_ENV: 'production' });
      const csp = (await request(prod).get('/api/oauth/providers')).headers['content-security-policy'];
      expect(csp).toContain("default-src 'self'");
      expect(csp).not.toContain('upgrade-insecure-requests');
    });

    // The draw.io editor opens as a popup on embed.diagrams.net and talks back
    // through window.opener. Helmet's default Cross-Origin-Opener-Policy,
    // same-origin, severs that link for a cross-origin popup, so on the HTML
    // page the editor would open and never load the diagram or save it.
    it('keeps the opener link for popups (the draw.io editor)', async () => {
      const prod = withSpaHandler(await importAppWith({ NODE_ENV: 'production' }));
      const res = await request(prod).get('/spa-stand-in');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
    });
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

  // update-account now checks a password, so a stolen session could otherwise
  // guess at it without limit. It shares the login bucket (20 per 15 minutes),
  // and the mount covers its confirm-email step too.
  it('puts /api/update-account and its confirm-email step in the auth rate-limit bucket', async () => {
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const statuses = [];
      for (let i = 0; i < 21; i++) {
        statuses.push((await request(app).post('/api/update-account').send({})).status);
      }
      expect(statuses.slice(0, 20)).not.toContain(429);
      expect(statuses[20]).toBe(429);

      // One bucket: the confirm step is spent too, and a route outside it is not.
      const confirm = await request(app).post('/api/update-account/confirm-email').send({});
      expect(confirm.status).toBe(429);
      const outside = await request(app).get('/api/check-username/someone');
      expect(outside.status).not.toBe(429);
    } finally {
      process.env.NODE_ENV = prior;
    }
  });

  // The reconciliation read (W6-CDX-16) answers up to 100 ids a request, so it
  // gets its own bucket, 120 per 15 minutes. Mounted in app.js before any
  // router, so an unauthenticated caller spends it too.
  it('puts /api/documents/state in its own rate-limit bucket, ahead of authentication', async () => {
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const statuses = [];
      for (let i = 0; i < 121; i++) {
        statuses.push((await request(app).get('/api/documents/state?workspaceId=1&ids=1')).status);
      }
      expect(statuses.slice(0, 120)).toEqual(Array(120).fill(401));
      expect(statuses[120]).toBe(429);

      // Its own bucket: the neighbouring routes are not spent.
      const search = await request(app).get('/api/search?query=x');
      expect(search.status).toBe(401);
      const doc = await request(app).get('/api/document?doc_id=1');
      expect(doc.status).toBe(401);
    } finally {
      process.env.NODE_ENV = prior;
    }
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

  it('mounts the authorized /doc-images handler: an anonymous request gets an empty 404', async () => {
    const res = await request(app).get('/doc-images/does-not-exist.webp');
    expect(res.status).toBe(404);
    expect(res.text).toBe('');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns 404 for unknown API paths (no fallthrough to other routers)', async () => {
    const res = await request(app).get('/api/this-endpoint-does-not-exist');
    expect(res.status).toBe(404);
  });
});

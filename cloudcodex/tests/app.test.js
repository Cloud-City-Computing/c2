/**
 * Cloud Codex — Tests for app.js (Express setup)
 *
 * Verifies the trust proxy setting and the address the rate limiters key on,
 * CORS scoping, security headers, body size limits, rate limiter skip-in-test
 * behaviour, static file mounts, and the API route prefix.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import http from 'node:http';
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

  // GHSA-9fmx-frrf-xxmq. A hop count believes the X-Forwarded-For of whoever
  // connects, and the compose files published the app port on every
  // interface, so a client reaching the port directly chose its own address
  // and got a fresh rate-limit bucket per request. Trusting private ranges
  // instead was not enough: a client on the same LAN, VPN or VPC (AWS's
  // default VPC is 172.31.0.0/16, inside 172.16.0.0/12) was itself trusted, so
  // behind a proxy that appends it named its own key with the left entry. The
  // default now names each proxy by address: loopback, and the gateway of the
  // network the compose files pin, where a proxy on the host arrives from. Not
  // the default bridge's gateway: `docker run -p PORT:PORT` publishes on [::]
  // too, the default bridge is IPv4-only, so every IPv6 client arrives as that
  // gateway, and trusting it let each one choose its own key with no proxy.
  describe('TRUST_PROXY', () => {
    const UNSET = { TRUST_PROXY: undefined, TRUST_PROXY_ALLOW_HOP_COUNT: undefined };

    // Boot-path cases: importing app.js with the value set, with process.exit
    // stubbed so the refusal can be observed rather than ending the run.
    async function bootWith(env) {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const configured = await importAppWith({ ...UNSET, ...env });
        return { configured, exited: exitSpy.mock.calls, said: errorSpy.mock.calls.flat().join(' ') };
      } finally {
        exitSpy.mockRestore();
        errorSpy.mockRestore();
      }
    }

    it('defaults to what the contract says an unset TRUST_PROXY behaves as', async () => {
      const { configured, exited } = await bootWith({});
      expect(exited).toEqual([]);
      expect(configured.get('trust proxy')).toBe(contractDefault('TRUST_PROXY'));
      expect(parseTrustProxy(undefined)).toBe(contractDefault('TRUST_PROXY'));
    });

    it('the default names the proxies by address, not by range or count', () => {
      expect(contractDefault('TRUST_PROXY')).toBe('127.0.0.1/32, ::1/128, 172.29.0.1/32');
    });

    it.each([
      [undefined, '127.0.0.1/32, ::1/128, 172.29.0.1/32'],
      ['', '127.0.0.1/32, ::1/128, 172.29.0.1/32'],
      ['   ', '127.0.0.1/32, ::1/128, 172.29.0.1/32'],
      ['false', false],
      [' false ', false],
      ['loopback', 'loopback'],
      ['10.0.0.0/8, 127.0.0.1', '10.0.0.0/8, 127.0.0.1'],
    ])('accepts %j as %j', (value, expected) => {
      expect(parseTrustProxy(value)).toBe(expected);
    });

    // The peers the default must believe, and the ones it must not. A
    // dual-stack socket (Node's default listen, and so the Docker image)
    // reports an IPv4 peer in its IPv4-mapped form.
    describe('the default trust function', () => {
      const trust = () => app.get('trust proxy fn');

      it.each([
        ['127.0.0.1', 'loopback'],
        ['::1', 'IPv6 loopback'],
        ['::ffff:127.0.0.1', 'loopback on a dual-stack socket'],
        ['172.29.0.1', 'the gateway of the network the compose files pin, where nginx on the host arrives from'],
        ['::ffff:172.29.0.1', 'the same gateway on the container\'s dual-stack socket'],
      ])('trusts %s (%s)', (peer) => {
        expect(trust()(peer, 0)).toBe(true);
      });

      it.each([
        ['127.0.0.2', 'loopback, but not the one address a proxy on this host uses'],
        ['172.17.0.1', 'the default bridge\'s gateway, which every IPv6 client of `docker run -p` arrives as'],
        ['::ffff:172.17.0.1', 'the same on a dual-stack socket'],
        ['172.29.0.5', 'a sibling container on the pinned network, not its gateway'],
        ['::ffff:172.29.0.5', 'the same on a dual-stack socket'],
        ['172.31.44.9', 'a neighbour in AWS\'s default VPC'],
        ['172.18.0.1', 'the gateway of a compose network nobody pinned'],
        ['10.0.1.25', 'a private address, a load balancer until it is listed'],
        ['192.168.1.10', 'a machine on the same LAN'],
        ['169.254.10.1', 'IPv4 link-local'],
        ['fe80::1', 'IPv6 link-local'],
        ['fd12:3456::1', 'IPv6 unique local'],
        ['203.0.113.9', 'a public IPv4 client'],
        ['::ffff:203.0.113.9', 'the same client on a dual-stack socket'],
        ['8.8.8.8', 'a public IPv4 address'],
        ['2001:db8::1', 'a public IPv6 address'],
      ])('does not trust %s (%s)', (peer) => {
        expect(trust()(peer, 0)).toBe(false);
      });
    });

    // A hop count (any number, 0 included, whose meaning is spelled `false`)
    // or `true` believes the X-Forwarded-For of whoever connects.
    it.each(['1', '2', '0', ' 3 ', 'true'])('refuses %j unless TRUST_PROXY_ALLOW_HOP_COUNT=true', (value) => {
      expect(() => parseTrustProxy(value)).toThrow(`TRUST_PROXY "${value}"`);
      expect(() => parseTrustProxy(value)).toThrow('TRUST_PROXY_ALLOW_HOP_COUNT=true');
      expect(() => parseTrustProxy(value, 'false')).toThrow(`TRUST_PROXY "${value}"`);
      expect(() => parseTrustProxy(value, '')).toThrow(`TRUST_PROXY "${value}"`);
    });

    it.each([
      ['1', 1],
      ['2', 2],
      [' 3 ', 3],
      ['0', 0],
      ['true', true],
    ])('accepts %j as %j when TRUST_PROXY_ALLOW_HOP_COUNT=true', (value, expected) => {
      expect(parseTrustProxy(value, 'true')).toBe(expected);
    });

    it.each(['yes', 'TRUE', '1', 'on'])('refuses TRUST_PROXY_ALLOW_HOP_COUNT=%j, which is neither true nor false', (allow) => {
      expect(() => parseTrustProxy('1', allow)).toThrow(`TRUST_PROXY_ALLOW_HOP_COUNT "${allow}"`);
      // Even with TRUST_PROXY unset: a typo in the opt-in is never silent.
      expect(() => parseTrustProxy(undefined, allow)).toThrow(`TRUST_PROXY_ALLOW_HOP_COUNT "${allow}"`);
    });

    it('boot exits naming both variables when TRUST_PROXY is a hop count', async () => {
      const { exited, said } = await bootWith({ TRUST_PROXY: '1' });
      expect(exited).toEqual([[1]]);
      expect(said).toContain('TRUST_PROXY "1"');
      expect(said).toContain('TRUST_PROXY_ALLOW_HOP_COUNT=true');
    });

    it('boot exits naming the opt-in when it is neither true nor false', async () => {
      const { exited, said } = await bootWith({ TRUST_PROXY_ALLOW_HOP_COUNT: 'yes' });
      expect(exited).toEqual([[1]]);
      expect(said).toContain('TRUST_PROXY_ALLOW_HOP_COUNT "yes"');
    });

    it('reaches Express: a hop count the operator opted into', async () => {
      const { configured, exited } = await bootWith({ TRUST_PROXY: '2', TRUST_PROXY_ALLOW_HOP_COUNT: 'true' });
      expect(exited).toEqual([]);
      expect(configured.get('trust proxy')).toBe(2);
    });

    it('reaches Express: false', async () => {
      const { configured, exited } = await bootWith({ TRUST_PROXY: 'false' });
      expect(exited).toEqual([]);
      expect(configured.get('trust proxy')).toBe(false);
      expect(configured.get('trust proxy fn')('127.0.0.1', 0)).toBe(false);
    });

    it('reaches Express: a named range, which Express compiles', async () => {
      const { configured } = await bootWith({ TRUST_PROXY: 'loopback' });
      expect(configured.get('trust proxy')).toBe('loopback');
      expect(configured.get('trust proxy fn')('127.0.0.1', 0)).toBe(true);
      expect(configured.get('trust proxy fn')('203.0.113.9', 0)).toBe(false);
    });

    it('exits naming the variable when Express rejects the value', async () => {
      // A /33 is plain notation, so it gets past the entry check and it is
      // Express that refuses it.
      const { exited, said } = await bootWith({ TRUST_PROXY: '10.0.0.0/33' });
      expect(exited).toEqual([[1]]);
      expect(said).toMatch(/TRUST_PROXY "10\.0\.0\.0\/33" is not valid/);
    });

    // A list can trust every address, or public space, without saying `true`.
    // proxy-addr already throws on a /0, but not on two /1s, and it matches an
    // IPv4 client against an IPv6 subnet in its IPv4-mapped form, so
    // ::ffff:0:0/96 is every IPv4 address. Wider than an IPv4 /8, or an IPv6
    // /16 outside the private and link-local ranges, is refused unless the
    // operator has accepted that any client can choose its address.
    describe('a range wide enough to take in public addresses', () => {
      it.each([
        ['0.0.0.0/0', '0.0.0.0/0'],
        ['::/0', '::/0'],
        ['0.0.0.0/1', '0.0.0.0/1'],
        ['0.0.0.0/1, 128.0.0.0/1', '0.0.0.0/1'],
        ['loopback, 128.0.0.0/1', '128.0.0.0/1'],
        ['11.0.0.0/7', '11.0.0.0/7'],
        ['128.0.0.0/128.0.0.0', '128.0.0.0/128.0.0.0'],
        ['::ffff:0.0.0.0/96', '::ffff:0.0.0.0/96'],
        ['::ffff:0:0/96', '::ffff:0:0/96'],
        ['::FFFF:0.0.0.0/96', '::FFFF:0.0.0.0/96'],
        ['::ffff:0.0.0.0/100', '::ffff:0.0.0.0/100'],
        ['::/80', '::/80'],
        ['::/16', '::/16'],
        ['2000::/3', '2000::/3'],
        ['2000::/15', '2000::/15'],
        ['8000::/1', '8000::/1'],
      ])('refuses %j, naming %s', (value, entry) => {
        expect(() => parseTrustProxy(value)).toThrow(`TRUST_PROXY "${value}" trusts ${entry}`);
        expect(() => parseTrustProxy(value)).toThrow('TRUST_PROXY_ALLOW_HOP_COUNT=true');
      });

      it.each(['0.0.0.0/1', '0.0.0.0/1, 128.0.0.0/1', '::ffff:0.0.0.0/96', '2000::/3'])(
        'accepts %j when TRUST_PROXY_ALLOW_HOP_COUNT=true',
        (value) => {
          expect(parseTrustProxy(value, 'true')).toBe(value);
        },
      );

      it.each([
        '10.0.0.0/8',
        '172.16.0.0/12',
        '192.168.0.0/16',
        '100.64.0.0/10',
        '203.0.113.7',
        '10.0.0.0/255.0.0.0',
        '::1',
        'fc00::/7',
        'fd00::/8',
        'fe80::/10',
        'fe80::1%eth0/64',
        '2001:db8::/32',
        '2001::/16',
        '::ffff:10.0.0.0/104',
        '::ffff:10.0.0.5',
        'loopback, 10.0.1.25, 2001:db8::/48',
      ])('accepts %j, which is no wider than that', (value) => {
        expect(parseTrustProxy(value)).toBe(value);
      });

      it('boot exits naming the variable and the entry', async () => {
        const { exited, said } = await bootWith({ TRUST_PROXY: '::ffff:0.0.0.0/96' });
        expect(exited).toEqual([[1]]);
        expect(said).toContain('TRUST_PROXY "::ffff:0.0.0.0/96" trusts ::ffff:0.0.0.0/96');
      });
    });

    // proxy-addr's parser takes spellings Node's does not, and reads some of
    // them in ways nobody would guess: `0/1` is half of IPv4 and `010.0.0.0/8`
    // is octal, 8.0.0.0/8, public space. The width check can only be sound on
    // an entry it reads the same way, so an entry must be a subnet name or an
    // address in standard notation, with or without the opt-in.
    describe('an entry not written as a subnet name or a standard address', () => {
      it.each([
        ['not-an-address', 'not-an-address'],
        ['0/1', '0/1'],
        ['0x0/1', '0x0/1'],
        ['010.0.0.0/8', '010.0.0.0/8'],
        ['1, loopback', '1'],
        ['loopback,', ''],
        ['10.0.0.0/0xff000000', '10.0.0.0/0xff000000'],
        ['Loopback', 'Loopback'],
      ])('refuses %j, naming %j, even with the opt-in', (value, entry) => {
        for (const allow of [undefined, 'true']) {
          expect(() => parseTrustProxy(value, allow)).toThrow(`TRUST_PROXY "${value}" is not valid: "${entry}"`);
        }
      });

      it('boot exits naming the variable', async () => {
        const { exited, said } = await bootWith({ TRUST_PROXY: 'not-an-address' });
        expect(exited).toEqual([[1]]);
        expect(said).toMatch(/TRUST_PROXY "not-an-address" is not valid/);
      });
    });
  });

  // What the setting is for: the limiter's key. Supertest always connects from
  // 127.0.0.1, which the default trusts, so it cannot play a client arriving
  // from a public address, and the test host has none to connect from. These
  // serve the app on a real loopback socket and give each connection the peer
  // address under test before Express sees the request: req.ip, the limiter
  // and its store are the real code, and only the address the kernel reported
  // is replaced. Each case imports a fresh app, so it gets a fresh store.
  describe('the auth limiter key', () => {
    // The app logs a warning when an untrusted peer sends X-Forwarded-For,
    // which most cases here do on purpose; one case below asserts it.
    let errorSpy;
    beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => errorSpy.mockRestore());

    function servedFrom(peer, target) {
      return http.createServer((req, res) => {
        Object.defineProperty(req.socket, 'remoteAddress', { value: peer, configurable: true });
        target(req, res);
      });
    }

    // One POST /api/login per X-Forwarded-For value, from `peer`, with the
    // limiters armed (they skip under NODE_ENV=test). Returns the statuses.
    async function loginsFrom(target, peer, forwardedFor) {
      const server = servedFrom(peer, target);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const url = `http://127.0.0.1:${server.address().port}`;
      const prior = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const statuses = [];
        for (const xff of forwardedFor) {
          statuses.push((await request(url).post('/api/login').set('X-Forwarded-For', xff).send({})).status);
        }
        return statuses;
      } finally {
        process.env.NODE_ENV = prior;
        await new Promise((resolve) => server.close(resolve));
      }
    }

    const freshApp = () => importAppWith({ TRUST_PROXY: undefined, TRUST_PROXY_ALLOW_HOP_COUNT: undefined });
    const rotating = (n) => Array.from({ length: n }, (_, i) => `198.51.100.${i + 1}`);

    it.each(['203.0.113.9', '::ffff:203.0.113.9'])(
      'counts a public peer (%s) by its socket address, whatever X-Forwarded-For it sends',
      async (peer) => {
        const statuses = await loginsFrom(await freshApp(), peer, rotating(21));
        expect(statuses.slice(0, 20)).not.toContain(429);
        expect(statuses[20]).toBe(429);
      },
    );

    // A peer inside the pinned subnet that is not its gateway is a sibling
    // container, and a sibling is not a proxy: it is keyed on its own address
    // whatever chain it sends. Every entry changes on every request, the
    // rightmost included, so trusting the sibling at all (a hop count, or the
    // whole subnet) hands out a fresh key each time and this goes red.
    it.each(['172.29.0.5', '::ffff:172.29.0.5'])(
      'counts a non-gateway peer inside the pinned subnet (%s) by its own address',
      async (peer) => {
        const chains = Array.from({ length: 21 }, (_, i) => `198.51.100.${i + 1}, 10.0.5.${i + 1}`);
        const statuses = await loginsFrom(await freshApp(), peer, chains);
        expect(statuses.slice(0, 20)).not.toContain(429);
        expect(statuses[20]).toBe(429);
      },
    );

    // The review's repro. A client behind the proxy, nginx appending as
    // documented, sends a new left entry with every attempt. The proxy is
    // trusted, so the walk reads the entry nginx appended, the client's real
    // address, and stops there because that client is not a proxy: one key,
    // 429 on attempt 21. Under the old subnet default a private client was
    // itself trusted, the walk went on to the injected entry, and all 40
    // attempts got a fresh bucket.
    it.each([
      ['10.0.5.7', 'a LAN or VPN client'],
      ['172.31.44.9', 'a neighbour in AWS\'s default VPC'],
      ['192.168.1.50', 'a home-network client'],
      ['203.0.113.9', 'a public client'],
    ])('keys %s (%s) behind an appending proxy on its own address, whatever left entry it injects', async (client) => {
      const chains = Array.from({ length: 40 }, (_, i) => `198.51.100.${i + 1}, ${client}`);
      const statuses = await loginsFrom(await freshApp(), '172.29.0.1', chains);
      expect(statuses.slice(0, 20)).not.toContain(429);
      expect(statuses.slice(20)).toEqual(Array(20).fill(429));
    });

    it('logs once, naming TRUST_PROXY, when an untrusted peer sends X-Forwarded-For', async () => {
      await loginsFrom(await freshApp(), '203.0.113.9', rotating(3));
      const warnings = errorSpy.mock.calls.flat().filter((line) => String(line).includes('TRUST_PROXY'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('203.0.113.9');
    });

    it.each(['172.29.0.1', '::ffff:172.29.0.1', '127.0.0.1'])(
      'believes a trusted proxy\'s (%s) X-Forwarded-For: two clients behind it get separate buckets',
      async (peer) => {
        const target = await freshApp();
        const first = await loginsFrom(target, peer, Array(21).fill('198.51.100.1'));
        expect(first.slice(0, 20)).not.toContain(429);
        expect(first[20]).toBe(429);
        // Same proxy, another client: its own bucket, so the key is the
        // forwarded address and not the proxy's.
        const second = await loginsFrom(target, peer, ['198.51.100.2']);
        expect(second[0]).not.toBe(429);
      },
    );
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

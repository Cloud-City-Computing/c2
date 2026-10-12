/**
 * Tests for services/oidc.js: configuration, the signed flow cookie, and discovery that is never cached when it fails
 *
 * The protocol itself (code exchange, userinfo, the ladder) is exercised against an in-process issuer in
 * tests/routes/oidc-callback.real-issuer.test.js. These cases pin what the module decides on its own.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as client from 'openid-client';
import { contractDefault } from '../contract-default.js';

// Discovery is wrapped, not replaced: the real function runs, so a refused connection is a real rejection.
vi.mock('openid-client', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, discovery: vi.fn(actual.discovery) };
});

import {
  getOidcConfig,
  beginLogin,
  signFlowCookie,
  verifyFlowCookie,
  oidcFlowCookie,
  readOidcFlowCookie,
  resetOidcCache,
} from '../../services/oidc.js';

const SECRET = 'a-client-secret-for-the-tests-0123456789';
const OIDC_VARS = [
  'OIDC_ISSUER_URL',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_PROVIDER_NAME',
  'OIDC_LINK_BY_VERIFIED_EMAIL',
  'OIDC_SESSION_TTL_HOURS',
  'OIDC_ACCOUNT_URL',
  'APP_URL',
  'NODE_ENV',
];

let saved;

beforeEach(() => {
  saved = Object.fromEntries(OIDC_VARS.map(name => [name, process.env[name]]));
  for (const name of OIDC_VARS) delete process.env[name];
  resetOidcCache();
});

afterEach(() => {
  for (const name of OIDC_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  vi.clearAllMocks();
});

/** A complete, valid OIDC environment; `overrides` replaces or removes (null) single variables. */
function setOidcEnv(overrides = {}) {
  const env = {
    OIDC_ISSUER_URL: 'https://id.example.test',
    OIDC_CLIENT_ID: 'codex-web',
    OIDC_CLIENT_SECRET: SECRET,
    APP_URL: 'https://codex.example.test',
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) {
    if (value === null) delete process.env[name];
    else process.env[name] = value;
  }
}

describe('getOidcConfig', () => {
  it('returns null when no issuer is set, and when it is blank', () => {
    expect(getOidcConfig()).toBeNull();
    process.env.OIDC_ISSUER_URL = '   ';
    expect(getOidcConfig()).toBeNull();
  });

  it('names the missing variable when the issuer has no client id, no secret, or no APP_URL', () => {
    setOidcEnv({ OIDC_CLIENT_ID: null });
    expect(() => getOidcConfig()).toThrow(/OIDC_CLIENT_ID/);

    setOidcEnv({ OIDC_CLIENT_ID: 'codex-web', OIDC_CLIENT_SECRET: null });
    expect(() => getOidcConfig()).toThrow(/OIDC_CLIENT_SECRET/);

    setOidcEnv({ OIDC_CLIENT_SECRET: SECRET, APP_URL: null });
    expect(() => getOidcConfig()).toThrow(/APP_URL/);
  });

  it('accepts https, and plain http only on a loopback host', () => {
    for (const issuer of [
      'https://id.example.test',
      'http://localhost:8081',
      'http://127.0.0.1:18530',
      'http://[::1]:8081',
      'http://id.suite.localhost:18530',
    ]) {
      setOidcEnv({ OIDC_ISSUER_URL: issuer });
      expect(getOidcConfig().issuer, issuer).toBe(issuer);
    }
    for (const issuer of ['http://id.example.test', 'http://10.0.0.5', 'http://localhost.example.test', 'ftp://id.example.test']) {
      setOidcEnv({ OIDC_ISSUER_URL: issuer });
      expect(() => getOidcConfig(), issuer).toThrow(/OIDC_ISSUER_URL/);
    }
  });

  it('builds the redirect URI from APP_URL alone, dropping any path APP_URL carries', () => {
    setOidcEnv({ APP_URL: 'https://codex.example.test/some/path?x=1' });
    expect(getOidcConfig().redirectUri).toBe('https://codex.example.test/api/auth/oidc/callback');
  });

  it('defaults the label, the linking switch and the session lifetime', () => {
    setOidcEnv();
    const config = getOidcConfig();
    expect(config.providerName).toBe(contractDefault('OIDC_PROVIDER_NAME'));
    expect(config.linkByVerifiedEmail).toBe(contractDefault('OIDC_LINK_BY_VERIFIED_EMAIL') === '1');
    expect(config.sessionTtlHours).toBe(Number(contractDefault('OIDC_SESSION_TTL_HOURS')));
  });

  it('reads the label, the switch and the lifetime when set', () => {
    setOidcEnv({ OIDC_PROVIDER_NAME: 'Cloud City ID', OIDC_LINK_BY_VERIFIED_EMAIL: '0', OIDC_SESSION_TTL_HOURS: '8' });
    const config = getOidcConfig();
    expect(config.providerName).toBe('Cloud City ID');
    expect(config.linkByVerifiedEmail).toBe(false);
    expect(config.sessionTtlHours).toBe(8);
  });

  it('refuses a switch that is not 0 or 1, and a lifetime that is not a positive whole number of hours', () => {
    setOidcEnv({ OIDC_LINK_BY_VERIFIED_EMAIL: 'yes' });
    expect(() => getOidcConfig()).toThrow(/OIDC_LINK_BY_VERIFIED_EMAIL/);

    setOidcEnv({ OIDC_LINK_BY_VERIFIED_EMAIL: null, OIDC_SESSION_TTL_HOURS: '0' });
    expect(() => getOidcConfig()).toThrow(/OIDC_SESSION_TTL_HOURS/);

    setOidcEnv({ OIDC_SESSION_TTL_HOURS: 'a day' });
    expect(() => getOidcConfig()).toThrow(/OIDC_SESSION_TTL_HOURS/);
  });

  it('marks the flow cookie secure exactly when APP_URL is https', () => {
    setOidcEnv();
    expect(getOidcConfig().secure).toBe(true);
    setOidcEnv({ APP_URL: 'http://localhost:3000' });
    expect(getOidcConfig().secure).toBe(false);
  });
});

describe('getOidcConfig, accountUrl (OIDC_ACCOUNT_URL, W6-CDX-42)', () => {
  it('is null when unset and when blank', () => {
    setOidcEnv();
    expect(getOidcConfig().accountUrl).toBeNull();
    process.env.OIDC_ACCOUNT_URL = '  ';
    expect(getOidcConfig().accountUrl).toBeNull();
  });

  it('returns the https account page, as given', () => {
    setOidcEnv({ OIDC_ACCOUNT_URL: 'https://id.example.test/ui/console/users/me' });
    expect(getOidcConfig().accountUrl).toBe('https://id.example.test/ui/console/users/me');
  });

  it('accepts plain http outside production', () => {
    setOidcEnv({ OIDC_ACCOUNT_URL: 'http://id.localhost:8080/account' });
    expect(getOidcConfig().accountUrl).toBe('http://id.localhost:8080/account');
  });

  it('refuses plain http in production', () => {
    setOidcEnv({ OIDC_ACCOUNT_URL: 'http://id.example.test/account', NODE_ENV: 'production' });
    expect(() => getOidcConfig()).toThrow(/OIDC_ACCOUNT_URL must be https/);
  });

  it('refuses a value that is not a URL', () => {
    setOidcEnv({ OIDC_ACCOUNT_URL: 'id.example.test/account' });
    expect(() => getOidcConfig()).toThrow(/OIDC_ACCOUNT_URL is not a URL/);
  });

  it('refuses a URL with credentials', () => {
    setOidcEnv({ OIDC_ACCOUNT_URL: 'https://user:pass@id.example.test/account' });
    expect(() => getOidcConfig()).toThrow(/OIDC_ACCOUNT_URL must be https/);
  });
});

describe('the flow cookie', () => {
  const payload = () => ({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/a', exp: Date.now() + 60_000 });

  it('verifies what it signed, and nothing signed with another secret', () => {
    const original = payload();
    const value = signFlowCookie(original, SECRET);
    expect(verifyFlowCookie(value, SECRET)).toEqual(original);
    expect(verifyFlowCookie(value, 'another-secret-entirely-0123456789')).toBeNull();
  });

  it('refuses a missing, malformed, tampered or expired value without throwing', () => {
    expect(verifyFlowCookie(undefined, SECRET)).toBeNull();
    expect(verifyFlowCookie('no-dot-here', SECRET)).toBeNull();
    const value = signFlowCookie(payload(), SECRET);
    const [body, sig] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload(), returnTo: '/evil' })).toString('base64url');
    expect(verifyFlowCookie(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(verifyFlowCookie(`${body}.${'x'.repeat(sig.length)}`, SECRET)).toBeNull();
    const expired = signFlowCookie({ ...payload(), exp: Date.now() - 1 }, SECRET);
    expect(verifyFlowCookie(expired, SECRET)).toBeNull();
  });

  it('is __Host-oidcFlow at Path=/ on https, and oidcFlow at /api/auth/oidc over plain http', () => {
    setOidcEnv();
    const secure = oidcFlowCookie(getOidcConfig());
    expect(secure.name).toBe('__Host-oidcFlow');
    expect(secure.options).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, path: '/' });

    setOidcEnv({ APP_URL: 'http://localhost:3000' });
    const plain = oidcFlowCookie(getOidcConfig());
    expect(plain.name).toBe('oidcFlow');
    expect(plain.options).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: false, path: '/api/auth/oidc' });
  });

  it('is read by exact name, stripping only ASCII space and tab around the pair', () => {
    setOidcEnv();
    const config = getOidcConfig();
    expect(readOidcFlowCookie(`x=1; __Host-oidcFlow=abc ;y=2`, config)).toBe('abc');
    expect(readOidcFlowCookie('__Host-oidcFlowX=abc', config)).toBeUndefined();
    expect(readOidcFlowCookie('oidcFlow=abc', config)).toBeUndefined();
    expect(readOidcFlowCookie(undefined, config)).toBeUndefined();
  });
});

describe('discovery', () => {
  it('is not cached when it fails, so the next attempt discovers again', async () => {
    setOidcEnv({ OIDC_ISSUER_URL: 'http://127.0.0.1:1' });
    const config = getOidcConfig();

    await expect(beginLogin(config, { returnTo: '/' })).rejects.toThrow();
    await expect(beginLogin(config, { returnTo: '/' })).rejects.toThrow();

    expect(client.discovery).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { verifyMachineCredential } from '../../services/machine-auth.js';
import { resetMocks } from '../helpers.js';

/**
 * A non-admin user row of the shape the users table returns.
 * is_admin comes back from MySQL as 0/1, not a JS boolean.
 */
const SERVICE_ROW = { id: 7, name: 'cloud-command', email: 'svc@example.com', is_admin: 0 };
const ADMIN_ROW = { id: 8, name: 'root', email: 'svc@example.com', is_admin: 1 };

/**
 * Distinct per test on purpose: the module caches the resolved configuration
 * keyed by the raw env pair, so reusing one value across tests would make a
 * "logged the misconfiguration" assertion depend on test order.
 */
function configure(token, email = 'svc@example.com') {
  process.env.SERVICE_TOKEN = token;
  process.env.SERVICE_TOKEN_USER = email;
}

describe('verifyMachineCredential', () => {
  let errorSpy;

  beforeEach(() => {
    resetMocks();
    delete process.env.SERVICE_TOKEN;
    delete process.env.SERVICE_TOKEN_USER;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    delete process.env.SERVICE_TOKEN;
    delete process.env.SERVICE_TOKEN_USER;
  });

  describe('when machine auth is not configured', () => {
    it('returns null with neither variable set', async () => {
      expect(await verifyMachineCredential('a'.repeat(40))).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('returns null with only SERVICE_TOKEN set', async () => {
      process.env.SERVICE_TOKEN = 'unconfigured-user-token-0000000000000';

      expect(await verifyMachineCredential('unconfigured-user-token-0000000000000')).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('returns null with only SERVICE_TOKEN_USER set', async () => {
      process.env.SERVICE_TOKEN_USER = 'svc@example.com';

      expect(await verifyMachineCredential('anything')).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('returns null for a blank SERVICE_TOKEN even when the caller sends a blank token', async () => {
      configure('   ');

      expect(await verifyMachineCredential('   ')).toBeNull();
      expect(await verifyMachineCredential('')).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });
  });

  describe('token comparison', () => {
    it('rejects a token that does not match, without a database lookup', async () => {
      configure('correct-service-token-aaaaaaaaaaaaaaaa');

      expect(await verifyMachineCredential('wrong-service-token-aaaaaaaaaaaaaaaaaa')).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('rejects a token of a different length without throwing', async () => {
      configure('correct-service-token-bbbbbbbbbbbbbbbb');

      await expect(verifyMachineCredential('short')).resolves.toBeNull();
      await expect(verifyMachineCredential('x'.repeat(4096))).resolves.toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('rejects a null or undefined token', async () => {
      configure('correct-service-token-cccccccccccccccc');

      expect(await verifyMachineCredential(null)).toBeNull();
      expect(await verifyMachineCredential(undefined)).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('rejects a token that only differs by surrounding whitespace', async () => {
      configure('correct-service-token-dddddddddddddddd');

      expect(await verifyMachineCredential(' correct-service-token-dddddddddddddddd ')).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });
  });

  describe('minimum token length', () => {
    it('refuses a SERVICE_TOKEN shorter than 32 characters, even when the token matches', async () => {
      const short = 'a'.repeat(31);
      configure(short);

      expect(await verifyMachineCredential(short)).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      const logged = errorSpy.mock.calls.flat().join(' ');
      expect(logged).toMatch(/SERVICE_TOKEN/);
      expect(logged).not.toContain(short);
    });

    it('accepts a SERVICE_TOKEN of exactly 32 characters', async () => {
      const exact = 'b'.repeat(32);
      configure(exact);
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);

      const principal = await verifyMachineCredential(exact);

      expect(principal).not.toBeNull();
      expect(principal.id).toBe(7);
    });
  });

  describe('principal resolution', () => {
    it('refuses a deactivated SERVICE_TOKEN_USER, with a log line, and issues no principal', async () => {
      const token = 'valid-service-token-gggggggggggggggggggg';
      configure(token);
      c2_query.mockResolvedValueOnce([{ ...SERVICE_ROW, deactivated_at: new Date('2026-10-01T00:00:00Z') }]);

      expect(await verifyMachineCredential(token)).toBeNull();
      const [sql] = c2_query.mock.calls[0];
      expect(sql).toMatch(/deactivated_at IS NULL/);
      expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/deactivated/);
    });

    it('returns a principal whose is_admin is false', async () => {
      const token = 'valid-service-token-eeeeeeeeeeeeeeeeee';
      configure(token);
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);

      const principal = await verifyMachineCredential(token);

      expect(principal).toEqual({
        id: 7,
        name: 'cloud-command',
        email: 'svc@example.com',
        is_admin: false,
        is_machine: true,
      });
      expect(principal.is_admin).toBe(false);
    });

    it('looks the user up by email with a parameterized query', async () => {
      const token = 'valid-service-token-ffffffffffffffffff';
      configure(token, '  Svc@Example.com  ');
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);

      await verifyMachineCredential(token);

      const [sql, params] = c2_query.mock.calls[0];
      expect(sql).toMatch(/WHERE email = \?/);
      expect(sql).not.toMatch(/Svc@Example\.com/);
      expect(params).toEqual(['Svc@Example.com']);
    });

    it('refuses a configured user that is an admin', async () => {
      const token = 'valid-service-token-gggggggggggggggggg';
      configure(token);
      c2_query.mockResolvedValueOnce([ADMIN_ROW]);

      expect(await verifyMachineCredential(token)).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      const logged = errorSpy.mock.calls.flat().join(' ');
      expect(logged).toMatch(/admin/i);
      expect(logged).not.toContain(token);
    });

    it('refuses a configured user that is an admin by boolean true', async () => {
      const token = 'valid-service-token-hhhhhhhhhhhhhhhhhh';
      configure(token);
      c2_query.mockResolvedValueOnce([{ ...SERVICE_ROW, is_admin: true }]);

      expect(await verifyMachineCredential(token)).toBeNull();
    });

    it('returns null and says so when the configured user does not exist', async () => {
      const token = 'valid-service-token-iiiiiiiiiiiiiiiiii';
      configure(token, 'typo@exmaple.com');
      c2_query.mockResolvedValueOnce([]);

      expect(await verifyMachineCredential(token)).toBeNull();
      // Silence here reads to an operator exactly like a wrong secret.
      expect(errorSpy).toHaveBeenCalled();
      const logged = errorSpy.mock.calls.flat().join(' ');
      expect(logged).toMatch(/typo@exmaple\.com/);
      expect(logged).not.toContain(token);
    });

    it('forces is_admin false rather than copying the column', async () => {
      const token = 'valid-service-token-jjjjjjjjjjjjjjjjjj';
      configure(token);
      c2_query.mockResolvedValueOnce([{ ...SERVICE_ROW, is_admin: null }]);

      const principal = await verifyMachineCredential(token);

      expect(principal.is_admin).toBe(false);
      expect(principal.is_admin).not.toBeNull();
    });
  });
});

/**
 * W6-CDX-7: a client-credentials JWT from the issuer goes through the same seam. The JWKS is served
 * by a stubbed fetch (discovery plus the key set), so the real jose verification runs against a key
 * this file generated. The namespace import keeps the static-path tests above loading even before
 * the JWT exports exist.
 */
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { randomUUID, sign as cryptoSign } from 'node:crypto';
import * as machineAuth from '../../services/machine-auth.js';

const ISSUER = 'https://id.example.test';
const KID = 'machine-test-key';
const PROJECT_A = '392804036467752963';   // this instance's Zitadel project id
const PROJECT_B = '392804036534861827';   // a sibling instance's project id
const SUB_A = '392804036115431427';       // this instance's allowlisted service user
const SUB_OTHER = '999000111222333444';   // a service user not on the allowlist
const JWT_ENV = [
  'OIDC_ISSUER_URL', 'MACHINE_OIDC_AUDIENCE', 'MACHINE_OIDC_SUBJECTS',
  'SERVICE_TOKEN', 'SERVICE_TOKEN_USER',
];

let keys;
async function signingKeys() {
  if (!keys) {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
    keys = { privateKey, jwks: { keys: [jwk] } };
  }
  return keys;
}

/**
 * A token shaped like the one measured in P7: iss, aud, sub, client_id, exp, iat, nbf, jti.
 * The offsets are seconds from now, so expiry and skew are tested without fake timers.
 */
async function signToken({
  aud = PROJECT_A, sub = SUB_A, iss = ISSUER, expOffset = 3600, iatOffset = 0,
  key, alg = 'RS256', kid = KID,
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  const signingKey = key ?? (await signingKeys()).privateKey;
  return new SignJWT({ client_id: 'command-to-codex-test' })
    .setProtectedHeader({ alg, kid, typ: 'JWT' })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject(sub)
    .setIssuedAt(now + iatOffset)
    .setNotBefore(now)
    .setExpirationTime(now + expOffset)
    .setJti(randomUUID())
    .sign(signingKey);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Stubs the issuer's discovery document and key set. Overrides let a test break one endpoint.
 */
function stubIssuer({ discovery, jwks, discoveryStatus = 200, jwksStatus = 200, discoveryIssuer = ISSUER } = {}) {
  const fetchMock = vi.fn(async (url) => {
    const href = String(url);
    if (href === `${ISSUER}/.well-known/openid-configuration`) {
      if (discovery) return discovery();
      return json({ issuer: discoveryIssuer, jwks_uri: `${ISSUER}/oauth/v2/keys` }, discoveryStatus);
    }
    if (href === `${ISSUER}/oauth/v2/keys`) {
      if (jwks) return jwks();
      return json((await signingKeys()).jwks, jwksStatus);
    }
    throw new Error(`unexpected fetch ${href}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function configureJwt({ audience = PROJECT_A, subjects = SUB_A, user = 'svc@example.com' } = {}) {
  process.env.OIDC_ISSUER_URL = ISSUER;
  process.env.MACHINE_OIDC_AUDIENCE = audience;
  process.env.MACHINE_OIDC_SUBJECTS = subjects;
  process.env.SERVICE_TOKEN_USER = user;
}

describe('verifyMachineCredential, the client-credentials JWT branch (W6-CDX-7)', () => {
  let errorSpy;

  beforeEach(() => {
    resetMocks();
    for (const name of JWT_ENV) delete process.env[name];
    machineAuth.resetMachineJwtCache();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    for (const name of JWT_ENV) delete process.env[name];
  });

  it('returns the service user principal for a valid token for this instance', async () => {
    configureJwt();
    const fetchMock = stubIssuer();
    c2_query.mockResolvedValueOnce([SERVICE_ROW]);

    const principal = await verifyMachineCredential(await signToken());

    expect(principal).toEqual({
      id: 7, name: 'cloud-command', email: 'svc@example.com', is_admin: false, is_machine: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/.well-known/openid-configuration`, expect.anything());
    const [sql, params] = c2_query.mock.calls[0];
    expect(sql).toMatch(/WHERE email = \?/);
    expect(params).toEqual(['svc@example.com']);
  });

  it('refuses a token for this audience whose subject is not on the allowlist', async () => {
    configureJwt();
    stubIssuer();

    expect(await verifyMachineCredential(await signToken({ sub: SUB_OTHER }))).toBeNull();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('refuses another instance audience, even from an allowlisted subject', async () => {
    configureJwt();
    stubIssuer();

    expect(await verifyMachineCredential(await signToken({ aud: PROJECT_B }))).toBeNull();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('refuses a token past its expiry by more than the 60 second skew', async () => {
    configureJwt();
    stubIssuer();

    expect(await verifyMachineCredential(await signToken({ expOffset: -120 }))).toBeNull();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('accepts a token that expired within the 60 second skew', async () => {
    configureJwt();
    stubIssuer();
    c2_query.mockResolvedValueOnce([SERVICE_ROW]);

    expect(await verifyMachineCredential(await signToken({ expOffset: -30 }))).not.toBeNull();
  });

  it('refuses a token issued more than the skew in the future', async () => {
    configureJwt();
    stubIssuer();

    expect(await verifyMachineCredential(await signToken({ iatOffset: 300 }))).toBeNull();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('refuses a token from another issuer', async () => {
    configureJwt();
    stubIssuer();

    expect(await verifyMachineCredential(await signToken({ iss: 'https://elsewhere.example.test' }))).toBeNull();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('refuses a token signed by a key the issuer does not publish under that kid', async () => {
    configureJwt();
    stubIssuer();
    const other = await generateKeyPair('RS256');

    expect(await verifyMachineCredential(await signToken({ key: other.privateKey }))).toBeNull();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('refuses an HS256 token built from a secret', async () => {
    configureJwt();
    stubIssuer();
    const secret = new TextEncoder().encode('s'.repeat(48));

    expect(await verifyMachineCredential(await signToken({ key: secret, alg: 'HS256' }))).toBeNull();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('refuses an unsigned alg none token without fetching keys', async () => {
    configureJwt();
    const fetchMock = stubIssuer();
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${enc({ alg: 'none' })}.${enc({ iss: ISSUER, aud: PROJECT_A, sub: SUB_A })}.`;

    expect(await verifyMachineCredential(unsigned)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never sends a 64-character session token into the JWT branch', async () => {
    configureJwt();
    const fetchMock = stubIssuer();
    const session = 'a'.repeat(64);

    expect(await verifyMachineCredential(session)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('refuses a JWT whose service user is an admin', async () => {
    configureJwt();
    stubIssuer();
    c2_query.mockResolvedValueOnce([ADMIN_ROW]);

    expect(await verifyMachineCredential(await signToken())).toBeNull();
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toMatch(/admin/i);
  });

  it('refuses a JWT when SERVICE_TOKEN_USER matches no user', async () => {
    configureJwt({ user: 'typo@exmaple.com' });
    stubIssuer();
    c2_query.mockResolvedValueOnce([]);

    expect(await verifyMachineCredential(await signToken())).toBeNull();
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/typo@exmaple\.com/);
  });

  it('refuses a JWT without a SERVICE_TOKEN_USER, with no database lookup', async () => {
    configureJwt();
    delete process.env.SERVICE_TOKEN_USER;
    stubIssuer();

    expect(await verifyMachineCredential(await signToken())).toBeNull();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('keeps the JWT branch off when the subject allowlist is blank, so a JWS is refused as before', async () => {
    configureJwt({ subjects: ' , ' });
    const fetchMock = stubIssuer();

    expect(await verifyMachineCredential(await signToken())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('matches a dotted SERVICE_TOKEN by its digest before any routing to jose', async () => {
    const dotted = `${'a'.repeat(10)}.${'b'.repeat(10)}.${'c'.repeat(20)}`;
    configureJwt();
    process.env.SERVICE_TOKEN = dotted;
    const fetchMock = stubIssuer();
    c2_query.mockResolvedValueOnce([SERVICE_ROW]);

    expect((await verifyMachineCredential(dotted)).id).toBe(7);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes a JWS that misses a dotted SERVICE_TOKEN digest to jose', async () => {
    const dotted = `${'a'.repeat(10)}.${'b'.repeat(10)}.${'c'.repeat(20)}`;
    configureJwt();
    process.env.SERVICE_TOKEN = dotted;
    const fetchMock = stubIssuer();
    c2_query.mockResolvedValueOnce([SERVICE_ROW]);

    expect((await verifyMachineCredential(await signToken())).id).toBe(7);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('refuses a dotted SERVICE_TOKEN lookalike that is neither the digest nor a valid JWT, without a 503', async () => {
    const dotted = `${'a'.repeat(10)}.${'b'.repeat(10)}.${'c'.repeat(20)}`;
    configureJwt();
    process.env.SERVICE_TOKEN = dotted;
    stubIssuer();

    expect(await verifyMachineCredential(`${'x'.repeat(10)}.${'y'.repeat(10)}.${'z'.repeat(20)}`)).toBeNull();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('returns null, never a 503, for a token with an unknown crit header, and logs no outage', async () => {
    configureJwt();
    stubIssuer();
    const { privateKey } = await signingKeys();
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const header = b64({ alg: 'RS256', kid: KID, typ: 'JWT', crit: ['x-unknown'], 'x-unknown': 'v' });
    const body = b64({ iss: ISSUER, aud: PROJECT_A, sub: SUB_A, iat: now, nbf: now, exp: now + 3600 });
    const sig = cryptoSign('sha256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url');

    await expect(verifyMachineCredential(`${header}.${body}.${sig}`)).resolves.toBeNull();
    expect(c2_query).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(' ')).not.toMatch(/unavailable/);
  });

  it('still authenticates the static token when the JWT variables are set but the token is opaque', async () => {
    configureJwt();
    const staticToken = 'opaque-static-token-with-no-dots-0123456789abcdef';
    process.env.SERVICE_TOKEN = staticToken;
    stubIssuer();
    c2_query.mockResolvedValueOnce([SERVICE_ROW]);

    expect((await verifyMachineCredential(staticToken)).id).toBe(7);
  });

  describe('when the issuer cannot be reached (fails closed, never null)', () => {
    it('rejects with MachineAuthUnavailable when discovery cannot connect', async () => {
      configureJwt();
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));

      const err = await verifyMachineCredential(await signToken()).catch((e) => e);
      expect(err).toBeInstanceOf(machineAuth.MachineAuthUnavailable);
      expect(err.code).toBe('MACHINE_AUTH_UNAVAILABLE');
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('rejects when discovery answers a server error', async () => {
      configureJwt();
      stubIssuer({ discoveryStatus: 503 });

      await expect(verifyMachineCredential(await signToken())).rejects.toBeInstanceOf(machineAuth.MachineAuthUnavailable);
    });

    it('rejects when the discovery document names another issuer', async () => {
      configureJwt();
      stubIssuer({ discoveryIssuer: 'https://elsewhere.example.test' });

      await expect(verifyMachineCredential(await signToken())).rejects.toBeInstanceOf(machineAuth.MachineAuthUnavailable);
    });

    it('rejects when the key set endpoint answers a server error', async () => {
      configureJwt();
      stubIssuer({ jwksStatus: 500 });

      await expect(verifyMachineCredential(await signToken())).rejects.toBeInstanceOf(machineAuth.MachineAuthUnavailable);
    });

    it('rejects when the key set endpoint times out', async () => {
      configureJwt();
      stubIssuer({
        jwks: () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); },
      });

      await expect(verifyMachineCredential(await signToken())).rejects.toBeInstanceOf(machineAuth.MachineAuthUnavailable);
    });

    it('does not keep a failed discovery, so the next call discovers again', async () => {
      configureJwt();
      let calls = 0;
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed');
        if (String(url).endsWith('openid-configuration')) {
          return json({ issuer: ISSUER, jwks_uri: `${ISSUER}/oauth/v2/keys` });
        }
        return json((await signingKeys()).jwks);
      }));
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);
      const token = await signToken();

      await expect(verifyMachineCredential(token)).rejects.toBeInstanceOf(machineAuth.MachineAuthUnavailable);
      // Within the 30 second window the outage is answered from memory; past it, discovery runs again.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 30_001);
      expect((await verifyMachineCredential(token)).id).toBe(7);
    });

    it('answers 1,000 bearers during an outage with one fetch and one log line per 30 second window', async () => {
      configureJwt();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
      const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed'); });
      vi.stubGlobal('fetch', fetchMock);
      const bearer = 'aaaa.bbbb.cccc';
      let refused = 0;

      for (let i = 0; i < 1000; i += 1) {
        await verifyMachineCredential(bearer).catch((err) => {
          if (err instanceof machineAuth.MachineAuthUnavailable) refused += 1;
        });
      }
      expect(refused).toBe(1000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date(Date.now() + 30_001));
      await verifyMachineCredential(bearer).catch(() => {});
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledTimes(2);
    });

    it('opens the same window when the key set fetch fails after discovery succeeded', async () => {
      configureJwt();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
      const fetchMock = stubIssuer({ jwksStatus: 500 });
      const token = await signToken();

      await expect(verifyMachineCredential(token)).rejects.toBeInstanceOf(machineAuth.MachineAuthUnavailable);
      const callsAfterFirst = fetchMock.mock.calls.length;
      await expect(verifyMachineCredential(token)).rejects.toBeInstanceOf(machineAuth.MachineAuthUnavailable);
      expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('logs the failure without the token', async () => {
      configureJwt();
      stubIssuer({ discoveryStatus: 500 });
      const token = await signToken();

      await verifyMachineCredential(token).catch(() => {});
      const logged = errorSpy.mock.calls.flat().join(' ');
      expect(logged).toMatch(/machine-auth/);
      expect(logged).not.toContain(token);
    });
  });
});

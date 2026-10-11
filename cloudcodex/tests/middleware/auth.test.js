import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { c2_query, validateAndAutoLogin, touchSession } from '../../mysql_connect.js';
import { requireAuth, machineOrAuth, extractSessionToken, bearerToken } from '../../middleware/auth.js';
import { resetMocks, TEST_USER } from '../helpers.js';

/**
 * Creates minimal mock req/res/next objects for middleware testing.
 */
function createMocks(overrides = {}) {
  const req = {
    headers: {},
    body: {},
    ...overrides,
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('extractSessionToken', () => {
  it('reads a bearer token from the Authorization header', () => {
    const { req } = createMocks({ headers: { authorization: 'Bearer header-token' } });
    expect(extractSessionToken(req)).toBe('header-token');
  });

  it('reads the sessionToken cookie when there is no Authorization header', () => {
    const { req } = createMocks({ headers: { cookie: 'theme=dark; sessionToken=cookie-token' } });
    expect(extractSessionToken(req)).toBe('cookie-token');
  });

  it('falls through to the cookie when the Authorization header is bearer-only', () => {
    const { req } = createMocks({
      headers: { authorization: 'Bearer ', cookie: 'sessionToken=cookie-token' },
    });
    expect(extractSessionToken(req)).toBe('cookie-token');
  });

  it('returns null when the cookie header carries no sessionToken', () => {
    const { req } = createMocks({ headers: { cookie: 'theme=dark; density=compact' } });
    expect(extractSessionToken(req)).toBeNull();
  });

  it('returns null when the request carries neither', () => {
    const { req } = createMocks();
    expect(extractSessionToken(req)).toBeNull();
  });

  it('ignores a token posted in the body', () => {
    const { req } = createMocks({ body: { token: 'body-token' } });
    expect(extractSessionToken(req)).toBeNull();
  });

  describe('the __Host- cookie (W6-CDX-3)', () => {
    const prior = process.env.LEGACY_SESSION_COOKIE;
    afterEach(() => {
      if (prior === undefined) delete process.env.LEGACY_SESSION_COOKIE;
      else process.env.LEGACY_SESSION_COOKIE = prior;
    });

    it('reads the __Host-sessionToken cookie', () => {
      const { req } = createMocks({ headers: { cookie: 'theme=dark; __Host-sessionToken=host-token' } });
      expect(extractSessionToken(req)).toBe('host-token');
    });

    // The browser sends a tossed `Path=/api` legacy cookie ahead of the real
    // one; reading the first match would authenticate the tosser's session.
    it('prefers the prefixed cookie over a tossed legacy one sent first', () => {
      const { req } = createMocks({
        headers: { cookie: 'sessionToken=tossed; __Host-sessionToken=host-token' },
      });
      expect(extractSessionToken(req)).toBe('host-token');
    });

    it('reads a lone legacy cookie while LEGACY_SESSION_COOKIE is unset', () => {
      delete process.env.LEGACY_SESSION_COOKIE;
      const { req } = createMocks({ headers: { cookie: 'sessionToken=old-token' } });
      expect(extractSessionToken(req)).toBe('old-token');
    });

    it('authenticates nobody from a lone legacy cookie when LEGACY_SESSION_COOKIE=0', () => {
      process.env.LEGACY_SESSION_COOKIE = '0';
      const { req } = createMocks({ headers: { cookie: 'sessionToken=old-token' } });
      expect(extractSessionToken(req)).toBeNull();
    });

    it('still takes the bearer header first', () => {
      const { req } = createMocks({
        headers: { authorization: 'Bearer header-token', cookie: '__Host-sessionToken=host-token' },
      });
      expect(extractSessionToken(req)).toBe('header-token');
    });
  });
});

describe('bearerToken', () => {
  it('is the Authorization header\'s token', () => {
    const { req } = createMocks({ headers: { authorization: 'Bearer header-token' } });
    expect(bearerToken(req)).toBe('header-token');
  });

  it('is null for no header, and for a bare "Bearer " (which extractSessionToken falls through)', () => {
    expect(bearerToken(createMocks().req)).toBeNull();
    expect(bearerToken(createMocks({ headers: { authorization: 'Bearer ' } }).req)).toBeNull();
  });

  it('never reads the cookie', () => {
    const { req } = createMocks({ headers: { cookie: '__Host-sessionToken=host-token' } });
    expect(bearerToken(req)).toBeNull();
  });
});

describe('requireAuth Middleware', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('passes with valid Bearer token', async () => {
    validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);

    const { req, res, next } = createMocks({
      headers: { authorization: 'Bearer valid-token' },
    });

    requireAuth(req, res, next);
    // wait for async
    await vi.waitFor(() => expect(next).toHaveBeenCalled());

    expect(req.user).toEqual(TEST_USER);
    expect(req.sessionToken).toBe('valid-token');
  });

  it('rejects token in body (only Authorization header accepted)', () => {
    const { req, res, next } = createMocks({
      body: { token: 'body-token' },
    });

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.message).toMatch(/authentication required/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when no token provided', () => {
    const { req, res, next } = createMocks();

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.message).toMatch(/authentication required/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid token', async () => {
    validateAndAutoLogin.mockResolvedValueOnce(null);

    const { req, res, next } = createMocks({
      headers: { authorization: 'Bearer bad-token' },
    });

    requireAuth(req, res, next);
    await vi.waitFor(() => expect(res.statusCode).toBe(401));

    expect(res.body.message).toMatch(/invalid or expired/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls touchSession after successful auth', async () => {
    validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);

    const { req, res, next } = createMocks({
      headers: { authorization: 'Bearer valid-token' },
    });

    requireAuth(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());

    expect(touchSession).toHaveBeenCalledWith('valid-token');
  });
});

describe('machineOrAuth Middleware', () => {
  const SERVICE_TOKEN = 'middleware-service-token-0000000000';
  const SERVICE_ROW = { id: 9, name: 'cloud-command', email: 'svc@example.com', is_admin: 0 };

  beforeEach(() => {
    resetMocks();
    process.env.SERVICE_TOKEN = SERVICE_TOKEN;
    process.env.SERVICE_TOKEN_USER = 'svc@example.com';
  });

  afterEach(() => {
    delete process.env.SERVICE_TOKEN;
    delete process.env.SERVICE_TOKEN_USER;
  });

  it('attaches a machine principal for a valid service token', async () => {
    c2_query.mockResolvedValueOnce([SERVICE_ROW]);

    const { req, res, next } = createMocks({
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });

    machineOrAuth(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());

    expect(req.user).toEqual({
      id: 9,
      name: 'cloud-command',
      email: 'svc@example.com',
      is_admin: false,
      is_machine: true,
    });
    // A machine caller holds no session, so nothing to validate or refresh.
    expect(validateAndAutoLogin).not.toHaveBeenCalled();
    expect(touchSession).not.toHaveBeenCalled();
    expect(req.sessionToken).toBeUndefined();
  });

  it('falls through to requireAuth for an ordinary session token', async () => {
    validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);

    const { req, res, next } = createMocks({
      headers: { authorization: 'Bearer valid-token' },
    });

    machineOrAuth(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());

    expect(req.user).toEqual(TEST_USER);
    expect(req.sessionToken).toBe('valid-token');
    expect(validateAndAutoLogin).toHaveBeenCalledWith('valid-token');
  });

  it('returns 401 when the request carries no token at all', () => {
    const { req, res, next } = createMocks();

    machineOrAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('falls through to requireAuth when machine auth is unconfigured', async () => {
    delete process.env.SERVICE_TOKEN;
    delete process.env.SERVICE_TOKEN_USER;
    validateAndAutoLogin.mockResolvedValueOnce(null);

    const { req, res, next } = createMocks({
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });

    machineOrAuth(req, res, next);
    await vi.waitFor(() => expect(res.statusCode).toBe(401));

    expect(next).not.toHaveBeenCalled();
  });

  it('forwards a lookup failure to the error handler rather than authenticating', async () => {
    c2_query.mockRejectedValueOnce(new Error('db down'));

    const { req, res, next } = createMocks({
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });

    machineOrAuth(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());

    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(req.user).toBeUndefined();
  });
});

/**
 * W6-CDX-7: the JWT branch's failure answers. An issuer outage is a 503 on both machine middlewares
 * (the caller retries; it is never read as a revoked credential). A JWS that does not verify is a
 * refusal, a 401 from requireMachine and the ordinary session fallback from machineOrAuth.
 */
import { requireMachine } from '../../middleware/auth.js';
import { resetMachineJwtCache } from '../../services/machine-auth.js';

describe('machine JWT failures at the middleware (W6-CDX-7)', () => {
  const ISSUER = 'https://id.example.test';
  const MALFORMED_JWS = 'aaaa.bbbb.cccc';

  function discoveryResponse() {
    return new Response(
      JSON.stringify({ issuer: ISSUER, jwks_uri: `${ISSUER}/oauth/v2/keys` }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  beforeEach(() => {
    resetMocks();
    resetMachineJwtCache();
    process.env.OIDC_ISSUER_URL = ISSUER;
    process.env.MACHINE_OIDC_AUDIENCE = '392804036467752963';
    process.env.MACHINE_OIDC_SUBJECTS = '392804036115431427';
    process.env.SERVICE_TOKEN_USER = 'svc@example.com';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.MACHINE_OIDC_AUDIENCE;
    delete process.env.MACHINE_OIDC_SUBJECTS;
    delete process.env.SERVICE_TOKEN_USER;
  });

  it('machineOrAuth answers 503, and calls neither next nor the session path, when the issuer is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const { req, res, next } = createMocks({ headers: { authorization: `Bearer ${MALFORMED_JWS}` } });

    machineOrAuth(req, res, next);
    await vi.waitFor(() => expect(res.statusCode).toBe(503));

    expect(res.body.success).toBe(false);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('requireMachine answers 503 when the issuer is down, never a 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    const { req, res, next } = createMocks({ headers: { authorization: `Bearer ${MALFORMED_JWS}` } });

    requireMachine(req, res, next);
    await vi.waitFor(() => expect(res.statusCode).toBe(503));

    expect(next).not.toHaveBeenCalled();
  });

  it('requireMachine answers 401 for a JWS that does not verify, with the same body as no credential', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => discoveryResponse()));
    const { req, res, next } = createMocks({ headers: { authorization: `Bearer ${MALFORMED_JWS}` } });

    requireMachine(req, res, next);
    await vi.waitFor(() => expect(res.statusCode).toBe(401));

    expect(res.body).toEqual({ success: false, message: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('machineOrAuth falls through to the session check for a JWS that does not verify', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => discoveryResponse()));
    const { req, res, next } = createMocks({ headers: { authorization: `Bearer ${MALFORMED_JWS}` } });

    machineOrAuth(req, res, next);
    await vi.waitFor(() => expect(res.statusCode).toBe(401));

    expect(req.user).toBeUndefined();
  });
});

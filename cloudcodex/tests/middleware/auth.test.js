import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateAndAutoLogin, touchSession } from '../../mysql_connect.js';
import { requireAuth, extractSessionToken, bearerToken } from '../../middleware/auth.js';
import { resetMocks, TEST_USER } from '../helpers.js';
import { DEAD_SESSION_MESSAGE } from '../../services/session-messages.js';

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

// The dead-session refusal is the one string the client reads to end a session (momus item 3). The client
// copy must equal the server's, and the literal is pinned here so a rename on either side fails a test.
describe('requireAuth, a dead session (the shared message)', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('refuses an expired token with exactly the shared dead-session message', async () => {
    validateAndAutoLogin.mockResolvedValueOnce(null);
    const { req, res, next } = createMocks({ headers: { authorization: 'Bearer dead-token' } });
    requireAuth(req, res, next);
    await vi.waitFor(() => expect(res.statusCode).toBe(401));
    expect(res.body).toEqual({ success: false, message: DEAD_SESSION_MESSAGE });
    expect(DEAD_SESSION_MESSAGE).toBe('Invalid or expired session');
    expect(next).not.toHaveBeenCalled();
  });
});

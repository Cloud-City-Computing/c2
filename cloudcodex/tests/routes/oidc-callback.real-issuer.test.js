/**
 * The OIDC sign-in end to end, against an in-process issuer that speaks the wire protocol
 *
 * An HTTP issuer built with jose serves discovery, JWKS, the authorization endpoint, the token
 * endpoint and userinfo, on a loopback port. It checks PKCE, client authentication and the
 * redirect URI like a real one, and it puts identity claims (email, email_verified, name) ONLY at
 * userinfo, the way Cloud City ID does. The route is driven with Supertest: /start, then the
 * issuer's redirect followed by hand, then /callback. Every refusal is checked to mint no session.
 *
 * What this cannot show is a real Cloud City ID stack: that is recorded separately under
 * docs/research/ when someone runs it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';
import { resetOidcCache } from '../../services/oidc.js';
import { openIdToken, sealIdToken } from '../../services/id-token-seal.js';
import { resetLogoutTokenState } from '../../services/backchannel-logout.js';
import oidcRouter from '../../routes/oidc.js';
import authRouter from '../../routes/auth.js';
import { hashSessionToken } from '../../services/session-token.js';
import { errorHandler } from '../../routes/helpers/shared.js';

const CLIENT_ID = 'codex-web';
const CLIENT_SECRET = 'codex-client-secret-for-the-real-issuer-test';
const ENV_KEYS = [
  'OIDC_ISSUER_URL',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_PROVIDER_NAME',
  'OIDC_LINK_BY_VERIFIED_EMAIL',
  'OIDC_SESSION_TTL_HOURS',
  'APP_URL',
  'NODE_ENV',
];

// --- the in-process issuer ---

let issuerServer;
let issuerOrigin;
let signingKey;
let jwk;
/** The last ID token the issuer minted, so a sign-out test can check what was hinted. */
let lastIdToken;
/** Per-test behaviour: the claims the issuer will vouch for, and the faults to inject. */
let person;
let faults;
/** code -> { nonce, codeChallenge, redirectUri, claims } for the authorization codes it has issued. */
const codes = new Map();
/** access_token -> claims, for userinfo. */
const accessTokens = new Map();

function resetPerson() {
  person = { sub: 'zitadel-user-0192', email: 'ada@example.com', email_verified: true, name: 'Ada Lovelace' };
  faults = {};
}

async function handleIssuer(req, res) {
  const url = new URL(req.url, issuerOrigin);
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  if (url.pathname === '/.well-known/openid-configuration') {
    return send(200, {
      issuer: issuerOrigin,
      authorization_endpoint: `${issuerOrigin}/authorize`,
      token_endpoint: `${issuerOrigin}/token`,
      userinfo_endpoint: `${issuerOrigin}/userinfo`,
      jwks_uri: `${issuerOrigin}/jwks`,
      end_session_endpoint: `${issuerOrigin}/end-session`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    });
  }

  if (url.pathname === '/jwks') {
    if (faults.jwksDown) return send(500, { error: 'server_error' });
    return send(200, { keys: [jwk] });
  }

  if (url.pathname === '/authorize') {
    const p = url.searchParams;
    if (p.get('client_id') !== CLIENT_ID || p.get('code_challenge_method') !== 'S256') {
      return send(400, { error: 'invalid_request' });
    }
    const code = randomBytes(16).toString('hex');
    codes.set(code, {
      nonce: p.get('nonce'),
      codeChallenge: p.get('code_challenge'),
      redirectUri: p.get('redirect_uri'),
      claims: { ...person },
    });
    const back = new URL(p.get('redirect_uri'));
    back.searchParams.set('code', code);
    back.searchParams.set('state', faults.wrongState ? 'not-the-state' : p.get('state'));
    res.writeHead(302, { location: back.href });
    return res.end();
  }

  if (url.pathname === '/token' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    // Client authentication by Basic or by form, as a real issuer accepts either.
    const basic = (req.headers.authorization ?? '').replace(/^Basic /, '');
    const [basicId, basicSecret] = Buffer.from(basic, 'base64').toString('utf8').split(':');
    const id = basic ? basicId : form.get('client_id');
    const secret = basic ? basicSecret : form.get('client_secret');
    if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return send(401, { error: 'invalid_client' });

    const grant = codes.get(form.get('code'));
    codes.delete(form.get('code'));
    if (!grant) return send(400, { error: 'invalid_grant' });
    const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
    if (challenge !== grant.codeChallenge) return send(400, { error: 'invalid_grant', error_description: 'pkce' });
    if (form.get('redirect_uri') !== grant.redirectUri) return send(400, { error: 'invalid_grant' });

    const now = Math.floor(Date.now() / 1000);
    const idClaims = {
      sub: grant.claims.sub,
      sid: faults.emptySid ? '' : faults.longSid ? 'x'.repeat(300) : 'zitadel-session-7',
      nonce: faults.wrongNonce ? 'a-different-nonce' : grant.nonce,
      auth_time: now,
      azp: CLIENT_ID,
      client_id: CLIENT_ID,
    };
    const idToken = await new SignJWT(idClaims)
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })
      .setIssuer(issuerOrigin)
      .setAudience(CLIENT_ID)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(signingKey);
    lastIdToken = idToken;
    const accessToken = `at-${randomBytes(12).toString('hex')}`;
    accessTokens.set(accessToken, grant.claims);
    return send(200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 300,
      id_token: idToken,
    });
  }

  if (url.pathname === '/userinfo') {
    const claims = accessTokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!claims) return send(401, { error: 'invalid_token' });
    // Identity claims here only, as Cloud City ID does; email_verified is omitted when false.
    const out = { sub: claims.sub, name: claims.name };
    if (claims.email !== undefined) out.email = claims.email;
    if (claims.email_verified === true) out.email_verified = true;
    return send(200, out);
  }

  return send(404, { error: 'not_found' });
}

// --- the app under test ---

const app = express();
app.use('/api', authRouter);
app.use('/api', oidcRouter);
app.use('/api', errorHandler);

/** The flow cookie's Set-Cookie value, by name prefix. */
function cookieFrom(setCookie, name) {
  const found = (setCookie ?? []).find(c => c.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1).split(';')[0] : undefined;
}

/**
 * Starts a sign-in through the route, lets the issuer redirect the browser back, and returns the
 * callback's response plus the flow cookie name and value the browser held.
 */
async function signIn({ returnTo, cookieName, flowValueOverride } = {}) {
  const start = await request(app)
    .get('/api/auth/oidc/start')
    .query(returnTo === undefined ? {} : { returnTo });
  if (start.status !== 302) throw new Error(`start answered ${start.status}`);

  const name = cookieName;
  const flow = flowValueOverride ?? cookieFrom(start.headers['set-cookie'], name);

  const issued = await fetch(start.headers.location, { redirect: 'manual' });
  const back = new URL(issued.headers.get('location'));

  const callback = await request(app)
    .get(`${back.pathname}${back.search}`)
    .set('Cookie', flow === undefined ? '' : `${name}=${flow}`);
  return { start, callback, flow };
}

function setIssuerEnv(extra = {}) {
  const env = {
    OIDC_ISSUER_URL: issuerOrigin,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_CLIENT_SECRET: CLIENT_SECRET,
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
    ...extra,
  };
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
}

const saved = {};

beforeAll(async () => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'real-issuer-test-key', alg: 'RS256', use: 'sig' };
  issuerServer = http.createServer((req, res) => {
    handleIssuer(req, res).catch(err => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  await new Promise(resolve => issuerServer.listen(0, '127.0.0.1', resolve));
  const { port } = issuerServer.address();
  issuerOrigin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise(resolve => issuerServer.close(resolve));
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

beforeEach(() => {
  resetPerson();
  codes.clear();
  accessTokens.clear();
  resetOidcCache();
  setIssuerEnv();
  c2_query.mockReset();
  c2_query.mockResolvedValue([]);
  generateSessionToken.mockClear();
  resetLogoutTokenState();
});

afterEach(() => {
  resetOidcCache();
  resetLogoutTokenState();
});

/** Queues the ladder's reads for a linked identity whose email matches (the common sign-in). */
function queueLinkedHit({ userId = 42, identityId = 7, email = 'ada@example.com' } = {}) {
  c2_query
    .mockResolvedValueOnce([{ id: identityId, user_id: userId }]) // HIT
    .mockResolvedValueOnce([{ email }]) // USER_EMAIL
    .mockResolvedValueOnce({ affectedRows: 1 }); // TOUCH
}

describe('OIDC sign-in, end to end against an issuer that speaks the protocol', () => {
  it('signs a linked person in, honours the returnTo, and mints an OIDC session with its sid', async () => {
    queueLinkedHit();
    const { callback } = await signIn({ returnTo: '/w/ws1/board?x=1#top', cookieName: 'oidcFlow' });

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe('/w/ws1/board?x=1#top');
    expect(generateSessionToken).toHaveBeenCalledTimes(1);
    const [user, , , options] = generateSessionToken.mock.calls[0];
    expect(user).toEqual({ id: 42 });
    expect(options).toEqual({
      provider: 'oidc',
      identityId: 7,
      providerSid: 'zitadel-session-7',
      ttlHours: 24,
      oidcIdToken: expect.any(String),
    });
    // The ID token reaches the session only sealed: it opens to the JWT the issuer signed, and the
    // stored value is not that JWT (W6-CDX-6).
    expect(options.oidcIdToken).not.toMatch(/^eyJ/);
    expect(openIdToken(options.oidcIdToken, CLIENT_SECRET).split('.')).toHaveLength(3);
    const session = callback.headers['set-cookie'].find(c => c.startsWith('sessionToken='));
    expect(session).toBeDefined();
    expect(session).toMatch(/SameSite=Strict/);
  });

  it('clears the flow cookie on the callback, whatever the outcome', async () => {
    queueLinkedHit();
    const { callback } = await signIn({ cookieName: 'oidcFlow' });
    const cleared = callback.headers['set-cookie'].find(c => c.startsWith('oidcFlow='));
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('uses the __Host- flow cookie on an https APP_URL, and reads it back by that exact name', async () => {
    setIssuerEnv({ APP_URL: 'https://codex.example.test' });
    queueLinkedHit();
    const { start, callback } = await signIn({ cookieName: '__Host-oidcFlow' });
    expect(start.headers['set-cookie'].find(c => c.startsWith('__Host-oidcFlow='))).toMatch(/Secure/);
    expect(callback.status).toBe(302);
    expect(generateSessionToken).toHaveBeenCalledTimes(1);
  });

  it('replaces a hostile returnTo with "/", at login, and the callback lands on "/"', async () => {
    queueLinkedHit();
    const { callback } = await signIn({ returnTo: '//evil.example/x', cookieName: 'oidcFlow' });
    expect(callback.headers.location).toBe('/');
  });

  it('links a first sign-in by verified email, and makes no second-factor challenge', async () => {
    c2_query
      .mockResolvedValueOnce([]) // HIT: none
      .mockResolvedValueOnce([{ id: 42, email: 'ada@example.com', two_factor_method: 'none' }])
      .mockResolvedValueOnce([]) // SAME_ISSUER: none
      .mockResolvedValueOnce({ affectedRows: 1, insertId: 88 }); // LINK
    const { callback } = await signIn({ cookieName: 'oidcFlow' });
    expect(callback.headers.location).toBe('/');
    expect(generateSessionToken.mock.calls[0][3]).toEqual({
      provider: 'oidc',
      identityId: 88,
      providerSid: 'zitadel-session-7',
      ttlHours: 24,
      oidcIdToken: expect.any(String),
    });
  });

  it('refuses an email the issuer has not verified, before any read', async () => {
    person.email_verified = false;
    const { callback } = await signIn({ cookieName: 'oidcFlow' });
    expect(callback.headers.location).toBe('/?oauth_error=email_not_verified&oauth_provider=oidc');
    expect(c2_query).not.toHaveBeenCalled();
    expect(generateSessionToken).not.toHaveBeenCalled();
  });

  it('refuses an email the issuer omits entirely', async () => {
    delete person.email;
    delete person.email_verified;
    const { callback } = await signIn({ cookieName: 'oidcFlow' });
    expect(callback.headers.location).toBe('/?oauth_error=email_not_verified&oauth_provider=oidc');
    expect(generateSessionToken).not.toHaveBeenCalled();
  });

  it('refuses a tampered flow cookie as flow_expired, and mints nothing', async () => {
    // A payload the server never sealed, under the signature of a real one: the HMAC refuses it.
    const start = await request(app).get('/api/auth/oidc/start');
    const real = cookieFrom(start.headers['set-cookie'], 'oidcFlow');
    const [, signature] = real.split('.');
    const forged = Buffer.from(
      JSON.stringify({ state: 'x', nonce: 'y', codeVerifier: 'z', returnTo: '/', exp: Date.now() + 60000 })
    ).toString('base64url');
    const { callback } = await signIn({ cookieName: 'oidcFlow', flowValueOverride: `${forged}.${signature}` });
    expect(callback.headers.location).toBe('/?oauth_error=flow_expired&oauth_provider=oidc');
    expect(generateSessionToken).not.toHaveBeenCalled();
  });

  it('refuses a callback whose state the issuer changed, as exchange_failed', async () => {
    faults.wrongState = true;
    const { callback } = await signIn({ cookieName: 'oidcFlow' });
    expect(callback.headers.location).toBe('/?oauth_error=exchange_failed&oauth_provider=oidc');
    expect(generateSessionToken).not.toHaveBeenCalled();
  });

  it('refuses a nonce the issuer did not bind to this login, as exchange_failed', async () => {
    faults.wrongNonce = true;
    const { callback } = await signIn({ cookieName: 'oidcFlow' });
    expect(callback.headers.location).toBe('/?oauth_error=exchange_failed&oauth_provider=oidc');
    expect(generateSessionToken).not.toHaveBeenCalled();
  });

  it('refuses a second identity at the same issuer as identity_conflict', async () => {
    c2_query
      .mockResolvedValueOnce([]) // HIT: none
      .mockResolvedValueOnce([{ id: 42, email: 'ada@example.com', two_factor_method: 'none' }])
      .mockResolvedValueOnce([{ id: 3 }]); // SAME_ISSUER: another subject
    const { callback } = await signIn({ cookieName: 'oidcFlow' });
    expect(callback.headers.location).toBe('/?oauth_error=identity_conflict&oauth_provider=oidc');
    expect(generateSessionToken).not.toHaveBeenCalled();
  });

  it('signs in on the identity when the issuer reports an email another row holds, and writes no users row', async () => {
    // The issuer's email never moves the local account (W6-CDX-5, review item 1): the sign-in is keyed
    // on (issuer, subject), and the new address is only recorded on the identity row.
    person.email = 'taken@example.com';
    c2_query
      .mockResolvedValueOnce([{ id: 7, user_id: 42 }]) // HIT
      .mockResolvedValueOnce({ affectedRows: 1 }); // TOUCH, with the issuer's email
    const { callback } = await signIn({ cookieName: 'oidcFlow' });
    expect(callback.headers.location).toBe('/');
    expect(generateSessionToken.mock.calls[0][3]).toMatchObject({ provider: 'oidc', identityId: 7 });
    const writes = c2_query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE)/i.test(sql));
    expect(writes.map(([sql]) => sql)).toEqual([
      'UPDATE user_identities SET last_login_at = NOW(), email_at_last_signin = ? WHERE id = ?',
    ]);
  });

  it('does not create a session when the issuer has no account for the person', async () => {
    const { callback } = await signIn({ cookieName: 'oidcFlow' });
    expect(callback.headers.location).toBe('/?oauth_error=no_account&oauth_provider=oidc');
    expect(generateSessionToken).not.toHaveBeenCalled();
  });

  it('treats an empty sid as no sid', async () => {
    faults.emptySid = true;
    queueLinkedHit();
    await signIn({ cookieName: 'oidcFlow' });
    expect(generateSessionToken.mock.calls[0][3].providerSid).toBeNull();
  });

  it('sends a sign-in back to the sign-in screen when the issuer cannot be discovered', async () => {
    // A closed loopback port: discovery is refused, the attempt is named, and nothing is cached.
    setIssuerEnv({ OIDC_ISSUER_URL: 'http://127.0.0.1:1' });
    const start = await request(app).get('/api/auth/oidc/start');
    expect(start.status).toBe(302);
    expect(start.headers.location).toBe('/?oauth_error=exchange_failed&oauth_provider=oidc');
    expect(start.headers['set-cookie']).toBeUndefined();
  });

  it('answers 404 to the start route when OIDC is not configured', async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const start = await request(app).get('/api/auth/oidc/start');
    expect(start.status).toBe(404);
  });

  it('refuses a sid longer than the column holds, before any write, as invalid_sid', async () => {
    faults.longSid = true;
    queueLinkedHit();
    const { callback } = await signIn({ cookieName: 'oidcFlow' });
    expect(callback.headers.location).toBe('/?oauth_error=invalid_sid&oauth_provider=oidc');
    expect(generateSessionToken).not.toHaveBeenCalled();
    const writes = c2_query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql));
    expect(writes).toEqual([]);
  });

  it('answers the start route with a redirect to the issuer carrying PKCE and a fresh state', async () => {
    const start = await request(app).get('/api/auth/oidc/start');
    expect(start.status).toBe(302);
    const url = new URL(start.headers.location);
    expect(url.origin + url.pathname).toBe(`${issuerOrigin}/authorize`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/oidc/callback');
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(url.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(cookieFrom(start.headers['set-cookie'], 'oidcFlow')).toBeDefined();
  });
});

// --- sign-out that propagates (W6-CDX-6) ---

const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

/** Signs a logout token like the issuer does, with any claim overridden or removed (undefined). */
async function logoutToken(overrides = {}, { key = signingKey, kid = jwk.kid, alg = 'RS256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuerOrigin,
    aud: CLIENT_ID,
    iat: now,
    exp: now + 900,
    jti: randomBytes(12).toString('hex'),
    events: { [LOGOUT_EVENT]: {} },
    sid: 'zitadel-session-7',
    sub: person.sub,
    ...overrides,
  };
  for (const [name, value] of Object.entries(claims)) if (value === undefined) delete claims[name];
  return new SignJWT(claims).setProtectedHeader({ alg, kid, typ: 'logout+jwt' }).sign(key);
}

/** Delivers a logout token the way the issuer does: a form POST with only logout_token. */
function deliver(token) {
  return request(app).post('/api/auth/oidc/backchannel-logout').type('form').send({ logout_token: token });
}

/** A sign-in that mints an OIDC session, so the sealed ID token and the real issuer's JWT are both at hand. */
async function signInForSealedToken() {
  queueLinkedHit();
  await signIn({ cookieName: 'oidcFlow' });
  const [, , , options] = generateSessionToken.mock.calls[0];
  return { sealed: options.oidcIdToken, idToken: lastIdToken };
}

describe('POST /api/logout, the end-session URL (W6-CDX-6)', () => {
  beforeEach(() => {
    setIssuerEnv();
    c2_query.mockReset();
    c2_query.mockResolvedValue([]);
  });

  it('gives a local session no end-session URL: the local sign-out is all there is', async () => {
    c2_query.mockResolvedValueOnce([{ auth_provider: 'local', oidc_id_token: null }]);

    const res = await request(app).post('/api/logout').set('Authorization', 'Bearer local-token').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const del = c2_query.mock.calls.find(([sql]) => /DELETE FROM sessions/.test(sql));
    expect(del[1]).toEqual([hashSessionToken('local-token')]);
  });

  it('gives an OIDC session exactly client_id, id_token_hint (the stored token), post_logout_redirect_uri and state', async () => {
    const { sealed, idToken } = await signInForSealedToken();
    c2_query.mockReset();
    c2_query.mockResolvedValue([]);
    c2_query.mockResolvedValueOnce([{ auth_provider: 'oidc', oidc_id_token: sealed }]);

    const res = await request(app).post('/api/logout').set('Authorization', 'Bearer oidc-token').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.headers['cache-control']).toBe('no-store');
    const url = new URL(res.body.endSessionUrl);
    expect(url.origin + url.pathname).toBe(`${issuerOrigin}/end-session`);
    expect([...url.searchParams.keys()].sort()).toEqual(['client_id', 'id_token_hint', 'post_logout_redirect_uri', 'state']);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('id_token_hint')).toBe(idToken);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:3000/?signedOut=1');
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it('ends the local session and names no URL when the stored token will not open', async () => {
    const sealed = sealIdToken('a.b.c', 'a-different-client-secret');
    c2_query.mockResolvedValueOnce([{ auth_provider: 'oidc', oidc_id_token: sealed }]);

    const res = await request(app).post('/api/logout').set('Authorization', 'Bearer oidc-token').send({});

    expect(res.body).toEqual({ success: true, endSessionUrl: null });
    expect(c2_query.mock.calls.some(([sql]) => /DELETE FROM sessions/.test(sql))).toBe(true);
  });

  it('gives no URL for an OIDC session that has no stored token (signed in before W6-CDX-6)', async () => {
    c2_query.mockResolvedValueOnce([{ auth_provider: 'oidc', oidc_id_token: null }]);

    const res = await request(app).post('/api/logout').set('Authorization', 'Bearer oidc-token').send({});

    expect(res.body).toEqual({ success: true, endSessionUrl: null });
  });

  it('does not keep a discovery that failed: once the issuer answers, the next sign-out gets its URL', async () => {
    const { sealed, idToken } = await signInForSealedToken();
    c2_query.mockReset();
    c2_query.mockResolvedValue([]);

    // A new issuer is a new process's view: forget the configuration the sign-in discovered.
    resetOidcCache();
    process.env.OIDC_ISSUER_URL = 'http://127.0.0.1:1';
    c2_query.mockResolvedValueOnce([{ auth_provider: 'oidc', oidc_id_token: sealed }]);
    const down = await request(app).post('/api/logout').set('Authorization', 'Bearer t1').send({});
    expect(down.body).toEqual({ success: true, endSessionUrl: null });

    setIssuerEnv();
    c2_query.mockResolvedValueOnce([{ auth_provider: 'oidc', oidc_id_token: sealed }]);
    const up = await request(app).post('/api/logout').set('Authorization', 'Bearer t2').send({});
    expect(new URL(up.body.endSessionUrl).searchParams.get('id_token_hint')).toBe(idToken);
  });

  it('gives up on a discovery that never answers after the bound, and still signs out locally', async () => {
    const { sealed } = await signInForSealedToken();
    const silent = http.createServer(() => {});
    await new Promise(resolve => silent.listen(0, '127.0.0.1', resolve));
    resetOidcCache();
    process.env.OIDC_ISSUER_URL = `http://127.0.0.1:${silent.address().port}`;
    c2_query.mockReset();
    c2_query.mockResolvedValue([]);
    c2_query.mockResolvedValueOnce([{ auth_provider: 'oidc', oidc_id_token: sealed }]);
    try {
      const started = Date.now();
      const res = await request(app).post('/api/logout').set('Authorization', 'Bearer t3').send({});
      expect(res.body).toEqual({ success: true, endSessionUrl: null });
      expect(Date.now() - started).toBeLessThan(4500);
      expect(c2_query.mock.calls.some(([sql]) => /DELETE FROM sessions/.test(sql))).toBe(true);
    } finally {
      silent.closeAllConnections();
      await new Promise(resolve => silent.close(resolve));
    }
  }, 15000);
});

describe('POST /api/auth/oidc/backchannel-logout (W6-CDX-6)', () => {
  beforeEach(() => {
    setIssuerEnv();
    c2_query.mockReset();
    c2_query.mockResolvedValue([]);
  });

  it('ends the sessions of one sid, bounded by the token iat, and answers 200 with no-store', async () => {
    const token = await logoutToken();
    const iat = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).iat;
    c2_query.mockResolvedValueOnce([{ id: 'digest-a' }]);

    const res = await deliver(token);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const [selectSql, selectParams] = c2_query.mock.calls[0];
    expect(selectSql).toMatch(/provider_sid = \?/);
    expect(selectSql).toMatch(/auth_provider = 'oidc'/);
    expect(selectSql).toMatch(/UNIX_TIMESTAMP\(created_at\) <= \?/);
    expect(selectParams).toEqual(['zitadel-session-7', iat + 60]);
    const [delSql, delParams] = c2_query.mock.calls[1];
    expect(delSql).toMatch(/DELETE FROM sessions/);
    expect(delSql).toMatch(/auth_provider = 'oidc'/);
    expect(delParams).toEqual(['digest-a']);
  });

  it('ends every oidc session of the (issuer, sub) identity when the token names no sid', async () => {
    const token = await logoutToken({ sid: undefined });
    c2_query.mockResolvedValueOnce([{ id: 'digest-b' }]);

    const res = await deliver(token);

    expect(res.status).toBe(200);
    const [selectSql, selectParams] = c2_query.mock.calls[0];
    expect(selectSql).toMatch(/user_identities/);
    expect(selectSql).toMatch(/ui\.issuer = \?/);
    expect(selectSql).toMatch(/ui\.subject = \?/);
    expect(selectParams.slice(0, 2)).toEqual([issuerOrigin, person.sub]);
  });

  it.each([
    ['another issuer', { iss: 'https://id.elsewhere.test' }],
    ['another audience', { aud: 'some-other-client' }],
    ['an iat older than the five-minute window', { iat: Math.floor(Date.now() / 1000) - 900 }],
    ['an iat in the future past the skew', { iat: Math.floor(Date.now() / 1000) + 600 }],
    ['an expired exp', { exp: Math.floor(Date.now() / 1000) - 600 }],
    ['no exp', { exp: undefined }],
    ['no events member', { events: undefined }],
    ['a nonce (an ID token, not a logout token)', { nonce: 'n-1' }],
    ['neither sid nor sub', { sid: undefined, sub: undefined }],
    ['no jti', { jti: undefined }],
    ['a sub the callback would refuse', { sid: undefined, sub: 'has a space' }],
  ])('refuses a token with %s as 400, deleting nothing', async (_name, overrides) => {
    const res = await deliver(await logoutToken(overrides));

    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('refuses an HMAC-signed token (a symmetric algorithm) as 400', async () => {
    const hmacKey = new TextEncoder().encode('a-shared-secret-that-must-never-verify-a-logout');
    const token = await logoutToken({}, { key: hmacKey, alg: 'HS256' });
    expect((await deliver(token)).status).toBe(400);
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('refuses an unsigned token (alg none) as 400', async () => {
    const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const token = `${enc({ alg: 'none' })}.${enc({ iss: issuerOrigin, aud: CLIENT_ID, iat: now, exp: now + 900, jti: 'x', events: { [LOGOUT_EVENT]: {} }, sid: 's' })}.`;
    expect((await deliver(token)).status).toBe(400);
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('refuses a token signed by a key the issuer does not publish as 400', async () => {
    const other = await generateKeyPair('RS256', { extractable: true });
    expect((await deliver(await logoutToken({}, { key: other.privateKey }))).status).toBe(400);
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a form posting, and a request with no logout_token, as 400', async () => {
    const token = await logoutToken();
    expect((await request(app).post('/api/auth/oidc/backchannel-logout').send({ logout_token: token })).status).toBe(400);
    expect((await request(app).post('/api/auth/oidc/backchannel-logout').type('form').send({})).status).toBe(400);
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('answers 503, not 400, when the issuer\'s keys cannot be fetched, and records nothing', async () => {
    faults.jwksDown = true;
    const token = await logoutToken();
    const down = await deliver(token);
    expect(down.status).toBe(503);
    expect(down.headers['cache-control']).toBe('no-store');
    expect(c2_query).not.toHaveBeenCalled();

    faults.jwksDown = false;
    c2_query.mockResolvedValueOnce([{ id: 'digest-c' }]);
    expect((await deliver(token)).status).toBe(200);
  });

  it('records no jti when the delete fails, so the issuer\'s retry with the same token ends the session', async () => {
    const token = await logoutToken();
    c2_query.mockResolvedValueOnce([{ id: 'digest-d' }]);
    c2_query.mockRejectedValueOnce(new Error('connection lost'));
    const failed = await deliver(token);
    expect(failed.status).toBe(500);

    c2_query.mockResolvedValueOnce([{ id: 'digest-d' }]);
    const retried = await deliver(token);
    expect(retried.status).toBe(200);
    expect(c2_query.mock.calls.filter(([sql]) => /DELETE FROM sessions/.test(sql))).toHaveLength(2);
  });

  it('refuses a replay of a delivered token as 400, and deletes nothing the second time', async () => {
    const token = await logoutToken();
    c2_query.mockResolvedValueOnce([{ id: 'digest-e' }]);
    expect((await deliver(token)).status).toBe(200);
    c2_query.mockClear();

    expect((await deliver(token)).status).toBe(400);
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('refuses a form body over 16 KB as 400, before any verification', async () => {
    const big = 'x'.repeat(20 * 1024);
    const res = await request(app).post('/api/auth/oidc/backchannel-logout').type('form').send({ logout_token: big });
    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('answers 404 once OIDC is no longer configured, since the receiver has no issuer to check against', async () => {
    delete process.env.OIDC_ISSUER_URL;
    const res = await deliver(await logoutToken());
    expect(res.status).toBe(404);
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('refuses the 301st refused delivery from one address with 429 and no-store, and does not count successes', async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const bad = await logoutToken({ aud: 'wrong-client' });
      for (let i = 0; i < 300; i += 1) {
        expect((await deliver(bad)).status).toBe(400);
      }
      const limited = await deliver(bad);
      expect(limited.status).toBe(429);
      expect(limited.headers['cache-control']).toBe('no-store');
    } finally {
      process.env.NODE_ENV = saved;
    }
  }, 60000);
});

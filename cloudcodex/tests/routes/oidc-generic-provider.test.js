/**
 * The OIDC routes against a second issuer shape: nothing in them is specific to one provider
 *
 * The other real-issuer test puts identity claims only at userinfo and advertises end-session and
 * back-channel logout. This issuer is the other common shape: email, email_verified and name in the ID
 * token and at userinfo, no sid, no end_session_endpoint, and no back-channel logout advertised. The
 * sign-in, sign-out and back-channel paths must work on it unchanged; a provider that does not advertise
 * back-channel logout still gets its logout tokens honoured.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';
import { resetOidcCache } from '../../services/oidc.js';
import { resetLogoutTokenState } from '../../services/backchannel-logout.js';
import { startIssuer, buildOidcApp } from './oidc-issuer.js';

const CLIENT_ID = 'generic-web';
const CLIENT_SECRET = 'generic-client-secret-for-the-generic-provider-test';
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

const app = buildOidcApp();
let issuer;
const saved = {};

function setIssuerEnv() {
  const env = {
    OIDC_ISSUER_URL: issuer.origin,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_CLIENT_SECRET: CLIENT_SECRET,
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  };
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
}

/** The flow cookie's Set-Cookie value, by name. */
function cookieFrom(setCookie, name) {
  const found = (setCookie ?? []).find(c => c.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1).split(';')[0] : undefined;
}

/** Starts a sign-in, lets the issuer redirect back by hand, and posts the callback. */
async function signIn({ returnTo } = {}) {
  const start = await request(app)
    .get('/api/auth/oidc/start')
    .query(returnTo === undefined ? {} : { returnTo });
  if (start.status !== 302) throw new Error(`start answered ${start.status}`);
  const flow = cookieFrom(start.headers['set-cookie'], 'oidcFlow');
  const issued = await fetch(start.headers.location, { redirect: 'manual' });
  const back = new URL(issued.headers.get('location'));
  return request(app)
    .get(`${back.pathname}${back.search}`)
    .set('Cookie', `oidcFlow=${flow}`);
}

/** The ladder's reads for a linked identity whose verified email matches (the common sign-in). */
function queueLinkedHit() {
  c2_query
    .mockResolvedValueOnce([{ id: 7, user_id: 42 }]) // HIT
    .mockResolvedValueOnce([{ email: 'grace@example.com' }]) // USER_EMAIL
    .mockResolvedValueOnce({ affectedRows: 1 }); // TOUCH
}

beforeAll(async () => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  issuer = await startIssuer({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    claimsInIdToken: true,
    sid: null,
    endSession: false,
    backchannel: false,
  });
});

afterAll(async () => {
  await issuer.close();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

beforeEach(() => {
  issuer.setPerson({ sub: 'generic-user-0417', email: 'grace@example.com', email_verified: true, name: 'Grace Hopper' });
  resetOidcCache();
  resetLogoutTokenState();
  setIssuerEnv();
  c2_query.mockReset();
  c2_query.mockResolvedValue([]);
  generateSessionToken.mockClear();
});

afterEach(() => {
  resetOidcCache();
  resetLogoutTokenState();
});

describe('OIDC sign-in against an issuer with claims in the ID token and no sid', () => {
  it('signs a linked person in, honours the returnTo, and mints an OIDC session with no provider sid', async () => {
    queueLinkedHit();
    const callback = await signIn({ returnTo: '/w/ws1/board?x=1#top' });

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe('/w/ws1/board?x=1#top');
    expect(generateSessionToken).toHaveBeenCalledTimes(1);
    const [user, , , options] = generateSessionToken.mock.calls[0];
    expect(user).toEqual({ id: 42 });
    expect(options).toEqual({
      provider: 'oidc',
      identityId: 7,
      providerSid: null,
      ttlHours: 24,
      oidcIdToken: expect.any(String),
    });
    expect(callback.headers['set-cookie'].find(c => c.startsWith('sessionToken='))).toMatch(/SameSite=Strict/);
  });
});

describe('POST /api/logout against an issuer with no end_session_endpoint', () => {
  it('ends the local session and answers no end-session URL, so the client lands on /?signedOut=1', async () => {
    queueLinkedHit();
    await signIn();
    const sealed = generateSessionToken.mock.calls[0][3].oidcIdToken;
    c2_query.mockReset();
    c2_query.mockResolvedValue([]);
    c2_query.mockResolvedValueOnce([{ auth_provider: 'oidc', oidc_id_token: sealed }]);

    const res = await request(app).post('/api/logout').set('Authorization', 'Bearer generic-token').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, endSessionUrl: null });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(c2_query.mock.calls.some(([sql]) => /DELETE FROM sessions/.test(sql))).toBe(true);
  });
});

describe('POST /api/auth/oidc/backchannel-logout from an issuer that does not advertise it', () => {
  it('still ends the oidc sessions of the subject when a valid logout token names it', async () => {
    const token = await issuer.logoutToken();
    c2_query.mockResolvedValueOnce([{ id: 'digest-generic' }]);

    const res = await request(app)
      .post('/api/auth/oidc/backchannel-logout')
      .type('form')
      .send({ logout_token: token });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const [selectSql] = c2_query.mock.calls[0];
    expect(selectSql).toMatch(/user_identities/);
    const [delSql, delParams] = c2_query.mock.calls[1];
    expect(delSql).toMatch(/DELETE FROM sessions/);
    expect(delSql).toMatch(/auth_provider = 'oidc'/);
    expect(delParams).toEqual(['digest-generic']);
  });
});

describe('the claims a sign-in reads: the ID token, with userinfo overriding only what it returns', () => {
  afterEach(() => {
    issuer.setUserinfo(undefined);
    issuer.setOmitAccessToken(false);
  });

  it('signs in when userinfo is silent on verification of the same address and the ID token asserts it', async () => {
    issuer.setUserinfo({ sub: 'generic-user-0417', email: 'grace@example.com', name: 'Grace Hopper' });
    queueLinkedHit();
    const callback = await signIn({ returnTo: '/w/ws1/board' });

    expect(callback.headers.location).toBe('/w/ws1/board');
    expect(generateSessionToken).toHaveBeenCalledTimes(1);
  });

  it('refuses when userinfo says email_verified false, though the ID token says true: userinfo wins', async () => {
    issuer.setUserinfo({ sub: 'generic-user-0417', email: 'grace@example.com', email_verified: false, name: 'Grace Hopper' });
    const callback = await signIn({ returnTo: '/w/ws1/board' });

    expect(callback.headers.location).toBe('/?oauth_error=email_not_verified&oauth_provider=oidc');
    expect(generateSessionToken).not.toHaveBeenCalled();
  });

  it('refuses a userinfo whose sub is not the ID token sub (OIDC Core 5.3.2)', async () => {
    issuer.setUserinfo({ sub: 'someone-else', email: 'grace@example.com', email_verified: true, name: 'Grace Hopper' });
    const callback = await signIn({ returnTo: '/w/ws1/board' });

    expect(callback.headers.location).toBe('/?oauth_error=userinfo_subject&oauth_provider=oidc');
    expect(generateSessionToken).not.toHaveBeenCalled();
  });

  it('refuses a token response with no access token, since RFC 6749 requires one and the library enforces it', async () => {
    issuer.setOmitAccessToken(true);
    queueLinkedHit();
    const callback = await signIn({ returnTo: '/w/ws1/board' });

    expect(callback.headers.location).toBe('/?oauth_error=exchange_failed&oauth_provider=oidc');
    expect(generateSessionToken).not.toHaveBeenCalled();
  });
});

describe('email and email_verified are one unit: the pair comes from one source', () => {
  afterEach(() => {
    issuer.setUserinfo(undefined);
    issuer.setOmitAccessToken(false);
  });

  it('refuses a verified ID token email spliced onto a userinfo email with no email_verified', async () => {
    // The ID token vouches for grace@example.com; userinfo names a different address without a verified claim.
    issuer.setUserinfo({ sub: 'generic-user-0417', email: 'victim@y.example', name: 'Grace Hopper' });
    const callback = await signIn({ returnTo: '/w/ws1/board' });

    expect(callback.headers.location).toBe('/?oauth_error=email_not_verified&oauth_provider=oidc');
    expect(generateSessionToken).not.toHaveBeenCalled();
    expect(c2_query.mock.calls.some(([sql]) => /user_identities/.test(sql))).toBe(false);
  });

  it('refuses when the ID token says email_verified false and userinfo says true for the same address', async () => {
    issuer.setOmitAccessToken(false);
    issuer.setPerson({ sub: 'generic-user-0417', email: 'grace@example.com', email_verified: false, name: 'Grace Hopper' });
    issuer.setUserinfo({ sub: 'generic-user-0417', email: 'grace@example.com', email_verified: true, name: 'Grace Hopper' });
    const callback = await signIn({ returnTo: '/w/ws1/board' });

    expect(callback.headers.location).toBe('/?oauth_error=email_not_verified&oauth_provider=oidc');
    expect(generateSessionToken).not.toHaveBeenCalled();
  });

  it('signs in when the ID token and userinfo both say verified for the same address, in any letter case', async () => {
    issuer.setUserinfo({ sub: 'generic-user-0417', email: 'GRACE@example.com', email_verified: true, name: 'Grace Hopper' });
    queueLinkedHit();
    const callback = await signIn({ returnTo: '/w/ws1/board' });

    expect(callback.headers.location).toBe('/w/ws1/board');
    expect(generateSessionToken).toHaveBeenCalledTimes(1);
  });

  it('takes the ID token pair when userinfo returns no email', async () => {
    issuer.setUserinfo({ sub: 'generic-user-0417', name: 'Grace B. Hopper' });
    queueLinkedHit();
    const callback = await signIn({ returnTo: '/w/ws1/board' });

    expect(callback.headers.location).toBe('/w/ws1/board');
    expect(generateSessionToken).toHaveBeenCalledTimes(1);
  });
});

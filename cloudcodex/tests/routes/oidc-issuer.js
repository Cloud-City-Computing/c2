/**
 * An in-process OIDC issuer for route tests, configurable in the shapes providers actually send
 *
 * A loopback HTTP issuer built with jose: discovery, JWKS, authorize, token and userinfo, with PKCE,
 * client authentication and the redirect URI checked like a real one. What varies is what the issuer
 * puts where: identity claims in the ID token as well as at userinfo, or at userinfo only; a sid or no
 * sid; end_session_endpoint advertised or not; back-channel logout advertised or not. Logout tokens are
 * signed with the same key as the ID tokens.
 *
 * This is a test helper, not a test file: tests/routes/oidc-generic-provider.test.js drives it, and
 * tests/routes/oidc-callback.real-issuer.test.js keeps its own copy of the fuller issuer.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import oidcRouter from '../../routes/oidc.js';
import authRouter from '../../routes/auth.js';
import { errorHandler } from '../../routes/helpers/shared.js';

export const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

/**
 * @param {object} options
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {boolean} options.claimsInIdToken  email, email_verified and name in the ID token too
 * @param {string|null} options.sid          the sid the ID token carries, or null for none
 * @param {boolean} options.endSession       discovery advertises end_session_endpoint
 * @param {boolean} options.backchannel      discovery advertises backchannel_logout_supported
 */
export async function startIssuer(options) {
  const { clientId, clientSecret, claimsInIdToken, sid, endSession, backchannel } = options;
  const pair = await generateKeyPair('RS256', { extractable: true });
  const signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'generic-provider-test-key', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  const accessTokens = new Map();
  const state = { person: null, lastIdToken: null, userinfo: undefined, omitAccessToken: false };

  async function handle(req, res) {
    const url = new URL(req.url, origin);
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/.well-known/openid-configuration') {
      const discovery = {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        userinfo_endpoint: `${origin}/userinfo`,
        jwks_uri: `${origin}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      };
      if (endSession) discovery.end_session_endpoint = `${origin}/end-session`;
      if (backchannel) discovery.backchannel_logout_supported = true;
      return send(200, discovery);
    }

    if (url.pathname === '/jwks') return send(200, { keys: [jwk] });

    if (url.pathname === '/authorize') {
      const p = url.searchParams;
      if (p.get('client_id') !== clientId || p.get('code_challenge_method') !== 'S256') {
        return send(400, { error: 'invalid_request' });
      }
      const code = randomBytes(16).toString('hex');
      codes.set(code, {
        nonce: p.get('nonce'),
        codeChallenge: p.get('code_challenge'),
        redirectUri: p.get('redirect_uri'),
        claims: { ...state.person },
      });
      const back = new URL(p.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', p.get('state'));
      res.writeHead(302, { location: back.href });
      return res.end();
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      const basic = (req.headers.authorization ?? '').replace(/^Basic /, '');
      const [basicId, basicSecret] = Buffer.from(basic, 'base64').toString('utf8').split(':');
      const id = basic ? basicId : form.get('client_id');
      const secret = basic ? basicSecret : form.get('client_secret');
      if (id !== clientId || secret !== clientSecret) return send(401, { error: 'invalid_client' });

      const grant = codes.get(form.get('code'));
      codes.delete(form.get('code'));
      if (!grant) return send(400, { error: 'invalid_grant' });
      const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== grant.codeChallenge) return send(400, { error: 'invalid_grant' });
      if (form.get('redirect_uri') !== grant.redirectUri) return send(400, { error: 'invalid_grant' });

      const now = Math.floor(Date.now() / 1000);
      const idClaims = {
        sub: grant.claims.sub,
        nonce: grant.nonce,
        auth_time: now,
        azp: clientId,
      };
      if (sid !== null) idClaims.sid = sid;
      if (claimsInIdToken) {
        if (grant.claims.email !== undefined) idClaims.email = grant.claims.email;
        if (grant.claims.email_verified === true) idClaims.email_verified = true;
        if (grant.claims.name !== undefined) idClaims.name = grant.claims.name;
      }
      const idToken = await new SignJWT(idClaims)
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })
        .setIssuer(origin)
        .setAudience(clientId)
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(signingKey);
      state.lastIdToken = idToken;
      const accessToken = `at-${randomBytes(12).toString('hex')}`;
      accessTokens.set(accessToken, grant.claims);
      const tokenBody = { token_type: 'Bearer', expires_in: 300, id_token: idToken };
      if (!state.omitAccessToken) tokenBody.access_token = accessToken;
      return send(200, tokenBody);
    }

    if (url.pathname === '/userinfo') {
      const claims = accessTokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      if (!claims) return send(401, { error: 'invalid_token' });
      if (state.userinfo !== undefined) return send(200, state.userinfo);
      const out = { sub: claims.sub, name: claims.name };
      if (claims.email !== undefined) out.email = claims.email;
      if (claims.email_verified === true) out.email_verified = true;
      return send(200, out);
    }

    return send(404, { error: 'not_found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  return {
    origin,
    state,
    /** Sets the claims the next authorization vouches for. */
    setPerson(person) { state.person = { ...person }; },
    /** The body the userinfo endpoint returns, verbatim; undefined returns the claims the person has. */
    setUserinfo(body) { state.userinfo = body; },
    /** When true, the token response carries no access_token, so the sign-in has no userinfo to read. */
    setOmitAccessToken(omit) { state.omitAccessToken = omit; },
    /** A logout token the issuer would send: signed, naming the subject, with the sid when the issuer has one. */
    async logoutToken(overrides = {}) {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: origin,
        aud: clientId,
        iat: now,
        exp: now + 900,
        jti: randomBytes(12).toString('hex'),
        events: { [LOGOUT_EVENT]: {} },
        sid: sid ?? undefined,
        sub: state.person.sub,
        ...overrides,
      };
      for (const [name, value] of Object.entries(claims)) if (value === undefined) delete claims[name];
      return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'logout+jwt' }).sign(signingKey);
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** The app under test: the auth and OIDC routers, mounted as server.js mounts them. */
export function buildOidcApp() {
  const app = express();
  app.use('/api', authRouter);
  app.use('/api', oidcRouter);
  app.use('/api', errorHandler);
  return app;
}

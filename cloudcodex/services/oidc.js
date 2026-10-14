/**
 * The OIDC relying party: a real sign-in against any OIDC issuer this instance is configured for
 *
 * Authorization code with PKCE, through openid-client 6. This module answers "who is this
 * (issuer, subject), and what is their verified email", and nothing else: it never stores a
 * password, never stores a refresh token, and never decides what the person may do. The ID token
 * goes back to the callback, which seals it for sign-out (W6-CDX-6, services/id-token-seal.js). services/identity.js decides which local user the
 * identity is.
 *
 * State, nonce and the PKCE verifier travel in a signed, HTTP-only flow cookie, not in server
 * memory: there is no session yet at this point, so nowhere else holds them across the redirect
 * to the issuer and back. The cookie is HMAC-SHA256 over a base64url JSON payload, keyed by the
 * client secret, compared with timingSafeEqual, and good for ten minutes. It carries the returnTo,
 * validated at login and again at the callback (services/return-to.js).
 *
 * Identity claims come from the validated ID token, and userinfo overrides them field by field: OIDC Core
 * 1.0 (section 5.4) names the UserInfo endpoint as a source of the scope-based claims (email,
 * email_verified, name), and a provider may return only some of them there. The userinfo subject must
 * equal the ID token subject (OIDC Core 5.3.2).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import * as client from 'openid-client';
import { safeReturnTo } from './return-to.js';
import { COOKIE_OWS } from './session-cookie.js';

/** How long a flow cookie, and so a sign-in attempt, stays valid. */
export const FLOW_TTL_MS = 10 * 60 * 1000;

/** The redirect path the issuer returns to. Always built from APP_URL, never from a request. */
export const OIDC_CALLBACK_PATH = '/api/auth/oidc/callback';

/** Scope: identity claims come from userinfo, which needs `email` and `profile`. */
const SCOPE = 'openid email profile';

/** Seconds of clock skew tolerated when checking the ID token's time claims. */
const CLOCK_TOLERANCE_SECONDS = 60;

/**
 * The most characters a sealed flow cookie value may take. A browser keeps at most 4096 bytes per
 * cookie including its name and attributes; a validated returnTo (at most 2048 characters) seals to
 * well under this. A longer value falls back to sealing "/", so the sign-in still completes.
 */
export const FLOW_COOKIE_MAX_CHARS = 3800;

/** The most characters the sid column holds (user_identities and sessions.provider_sid). */
const MAX_SID_LENGTH = 255;

/** A `sub` this relying party will store: 1 to 255 printable ASCII characters, no whitespace. */
const SUBJECT_RE = /^[\x21-\x7e]{1,255}$/;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Whether a URL is plain http on a loopback host, the only plaintext issuer this module accepts:
 * localhost, 127.0.0.1, ::1, or a *.localhost name.
 * @param {URL} url
 * @returns {boolean}
 */
function isLoopbackHttp(url) {
  if (url.protocol !== 'http:') return false;
  const host = url.hostname;
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost');
}

/**
 * Whether the issuer is one this module may talk to: https, or plain http on loopback.
 * @param {URL} url
 * @returns {boolean}
 */
function isAcceptableIssuer(url) {
  return url.protocol === 'https:' || isLoopbackHttp(url);
}

/**
 * Reads and checks the OIDC settings, each by its literal variable name (the configuration
 * contract's scan sees only those). Returns null when no issuer is set, which turns OIDC off.
 * Throws, naming the variable, on any setting that would make a sign-in fail or be insecure.
 * @returns {null | {
 *   issuer: string, clientId: string, clientSecret: string, redirectUri: string,
 *   appUrl: string, secure: boolean, providerName: string, linkByVerifiedEmail: boolean,
 *   sessionTtlHours: number
 * }}
 */
export function getOidcConfig() {
  const issuerSetting = process.env.OIDC_ISSUER_URL;
  if (issuerSetting === undefined || issuerSetting.trim() === '') return null;
  const issuer = issuerSetting.trim();

  const clientId = process.env.OIDC_CLIENT_ID;
  if (clientId === undefined || clientId.trim() === '') {
    throw new Error('OIDC_ISSUER_URL is set, but OIDC_CLIENT_ID is not; set both, or unset OIDC_ISSUER_URL.');
  }
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  if (clientSecret === undefined || clientSecret === '') {
    throw new Error('OIDC_ISSUER_URL is set, but OIDC_CLIENT_SECRET is not; set both, or unset OIDC_ISSUER_URL.');
  }

  let issuerUrl;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new Error('OIDC_ISSUER_URL is not a URL; use the issuer\'s https address.');
  }
  if (!isAcceptableIssuer(issuerUrl)) {
    throw new Error(
      'OIDC_ISSUER_URL must be https, or plain http on localhost, 127.0.0.1, ::1 or a *.localhost name.'
    );
  }

  const appUrlSetting = process.env.APP_URL;
  if (appUrlSetting === undefined || appUrlSetting.trim() === '') {
    throw new Error('APP_URL is required when OIDC_ISSUER_URL is set: the sign-in redirects back to it.');
  }
  let appUrl;
  try {
    appUrl = new URL(appUrlSetting);
  } catch {
    throw new Error('APP_URL is not a URL; set it to the address people use to reach this instance.');
  }

  const providerName = process.env.OIDC_PROVIDER_NAME || 'SSO';

  const linkSetting = process.env.OIDC_LINK_BY_VERIFIED_EMAIL;
  if (linkSetting !== undefined && linkSetting !== '' && linkSetting !== '0' && linkSetting !== '1') {
    throw new Error('OIDC_LINK_BY_VERIFIED_EMAIL must be 1 (link by verified email) or 0 (do not).');
  }
  const linkByVerifiedEmail = linkSetting !== '0';

  const ttlSetting = process.env.OIDC_SESSION_TTL_HOURS;
  let sessionTtlHours = 24;
  if (ttlSetting !== undefined && ttlSetting !== '') {
    if (!/^[1-9][0-9]*$/.test(ttlSetting)) {
      throw new Error('OIDC_SESSION_TTL_HOURS must be a positive whole number of hours.');
    }
    sessionTtlHours = Number(ttlSetting);
  }

  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri: new URL(OIDC_CALLBACK_PATH, appUrl).href,
    appUrl: appUrl.origin,
    secure: appUrl.protocol === 'https:',
    providerName,
    linkByVerifiedEmail,
    sessionTtlHours,
  };
}

/**
 * The flow cookie's name and attributes. On https it is __Host-oidcFlow at Path=/ (a browser keeps
 * a __Host- cookie only with Secure, Path=/ and no Domain, so another host cannot plant one). Over
 * plain http it is oidcFlow at /api/auth/oidc, the same rule as the OAuth state cookie.
 * SameSite=Lax, because the callback is a cross-site top-level navigation from the issuer.
 * @param {{ secure: boolean }} config
 * @returns {{ name: string, options: { httpOnly: true, sameSite: 'lax', secure: boolean, path: string } }}
 */
export function oidcFlowCookie(config) {
  if (config.secure) {
    return { name: '__Host-oidcFlow', options: { httpOnly: true, sameSite: 'lax', secure: true, path: '/' } };
  }
  return {
    name: 'oidcFlow',
    options: { httpOnly: true, sameSite: 'lax', secure: false, path: '/api/auth/oidc' },
  };
}

/**
 * The flow cookie's value from a Cookie header, by exact name. Only ASCII space and tab are
 * stripped around the pair (COOKIE_OWS), never Unicode whitespace.
 * @param {string | undefined} cookieHeader
 * @param {{ secure: boolean }} config
 * @returns {string | undefined}
 */
export function readOidcFlowCookie(cookieHeader, config) {
  if (typeof cookieHeader !== 'string') return undefined;
  const name = oidcFlowCookie(config).name;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).replace(COOKIE_OWS, '') !== name) continue;
    return part.slice(eq + 1).replace(COOKIE_OWS, '');
  }
  return undefined;
}

/**
 * Signs the flow payload. Exported for tests and the callback route.
 * @param {{ state: string, nonce: string, codeVerifier: string, returnTo: string, exp: number }} payload
 * @param {string} clientSecret
 * @returns {string}
 */
export function signFlowCookie(payload, clientSecret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${signBody(body, clientSecret)}`;
}

function signBody(body, clientSecret) {
  return createHmac('sha256', clientSecret).update(body).digest('base64url');
}

/**
 * Verifies a flow cookie value. Returns the payload, or null (never throws) for a missing,
 * malformed, badly signed, tampered or expired value. The caller answers all of them alike.
 * @param {string | undefined} value
 * @param {string} clientSecret
 * @returns {null | { state: string, nonce: string, codeVerifier: string, returnTo: string, exp: number }}
 */
export function verifyFlowCookie(value, clientSecret) {
  if (typeof value !== 'string') return null;
  try {
    const [body, signature] = value.split('.');
    if (!body || !signature) return null;
    const provided = Buffer.from(signature, 'utf8');
    const wanted = Buffer.from(signBody(body, clientSecret), 'utf8');
    if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
    if (typeof payload.state !== 'string' || typeof payload.nonce !== 'string') return null;
    if (typeof payload.codeVerifier !== 'string' || typeof payload.returnTo !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * The discovered configuration, cached for the process. A failed discovery is not kept: the entry
 * is cleared on rejection, so one outage does not refuse every later sign-in until a restart.
 */
let cachedConfiguration;

/**
 * @param {{ issuer: string, clientId: string, clientSecret: string }} config
 * @returns {Promise<client.Configuration>}
 */
export function loadConfiguration(config) {
  if (cachedConfiguration === undefined) {
    const issuer = new URL(config.issuer);
    const metadata = { client_secret: config.clientSecret, [client.clockTolerance]: CLOCK_TOLERANCE_SECONDS };
    const options = isLoopbackHttp(issuer) ? { execute: [client.allowInsecureRequests] } : undefined;
    const pending = client.discovery(issuer, config.clientId, metadata, undefined, options);
    cachedConfiguration = pending;
    pending.catch(() => {
      if (cachedConfiguration === pending) cachedConfiguration = undefined;
    });
  }
  return cachedConfiguration;
}

/** Test-only: forget the discovered configuration, so the next call discovers again. */
export function resetOidcCache() {
  cachedConfiguration = undefined;
}

/**
 * A sign-in that the callback refused, with a code the route maps to a redirect. The message never
 * carries token material, only what failed.
 */
export class OidcLoginError extends Error {
  /**
   * @param {string} code - exchange_failed, no_id_token, invalid_subject, userinfo_failed,
   *   userinfo_subject, email_not_verified or flow_expired
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'OidcLoginError';
    this.code = code;
  }
}

/**
 * The authorization request: a fresh state, nonce and PKCE pair per login, with the returnTo
 * validated and sealed in the flow cookie.
 * @param {ReturnType<typeof getOidcConfig>} config
 * @param {{ returnTo?: unknown }} options
 * @returns {Promise<{ url: string, flowCookie: string }>}
 */
export async function beginLogin(config, { returnTo }) {
  const configuration = await loadConfiguration(config);

  const state = client.randomState();
  const nonce = client.randomNonce();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  const url = client.buildAuthorizationUrl(configuration, {
    redirect_uri: config.redirectUri,
    scope: SCOPE,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const flow = { state, nonce, codeVerifier, exp: Date.now() + FLOW_TTL_MS };
  let flowCookie = signFlowCookie({ ...flow, returnTo: safeReturnTo(returnTo) }, config.clientSecret);
  if (flowCookie.length > FLOW_COOKIE_MAX_CHARS) {
    flowCookie = signFlowCookie({ ...flow, returnTo: '/' }, config.clientSecret);
  }
  return { url: url.href, flowCookie };
}

/**
 * Completes the code exchange and returns the verified identity. Throws OidcLoginError for every
 * refusal the callback answers. Discovery and token errors are reported by name only.
 *
 * The email must be present and verified, and it is checked before the caller reads the database.
 * An issuer that omits email_verified, or sends anything but true, is refused.
 *
 * @param {ReturnType<typeof getOidcConfig>} config
 * @param {URL} currentUrl - the callback URL with its query, as the issuer redirected to it
 * @param {string | undefined} flowCookieValue
 * @returns {Promise<{ issuer: string, subject: string, email: string, emailVerified: true,
 *   name: string | null, sid: string | null, idToken: string, returnTo: string }>}
 */
export async function completeLogin(config, currentUrl, flowCookieValue) {
  const flow = verifyFlowCookie(flowCookieValue, config.clientSecret);
  if (flow === null) {
    throw new OidcLoginError('flow_expired', 'The sign-in attempt expired or was tampered with.');
  }

  let configuration;
  try {
    configuration = await loadConfiguration(config);
  } catch (cause) {
    throw new OidcLoginError('exchange_failed', `OIDC discovery failed (${errorName(cause)}).`);
  }

  let tokens;
  try {
    tokens = await client.authorizationCodeGrant(configuration, currentUrl, {
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      pkceCodeVerifier: flow.codeVerifier,
      idTokenExpected: true,
    });
  } catch (cause) {
    throw new OidcLoginError('exchange_failed', `The OIDC token exchange failed (${errorName(cause)}).`);
  }

  const claims = tokens.claims();
  if (claims === undefined || tokens.id_token === undefined) {
    throw new OidcLoginError('no_id_token', 'The issuer returned no ID token.');
  }

  const rawSubject = claims.sub;
  if (typeof rawSubject !== 'string' || !SUBJECT_RE.test(rawSubject)) {
    throw new OidcLoginError('invalid_subject', 'The issuer returned a subject this server cannot store.');
  }

  let userInfo;
  if (tokens.access_token !== undefined) {
    try {
      // The subject check is ours, below, so a mismatch has its own refusal rather than userinfo_failed.
      userInfo = await client.fetchUserInfo(configuration, tokens.access_token, client.skipSubjectCheck);
    } catch (cause) {
      throw new OidcLoginError('userinfo_failed', `The OIDC userinfo request failed (${errorName(cause)}).`);
    }
  }

  // OIDC Core 5.3.2: userinfo describes the same end-user as the ID token, or it is not this sign-in.
  if (userInfo !== undefined && userInfo.sub !== rawSubject) {
    throw new OidcLoginError('userinfo_subject', 'The userinfo subject does not match the ID token subject.');
  }
  // The profile merges per field: the ID token's validated claims, with userinfo overriding the fields it
  // returns. The email and its verification are one unit and never merge (see the pair below).
  const profileFromUserInfo = definedFields(userInfo ?? {});
  delete profileFromUserInfo.email;
  delete profileFromUserInfo.email_verified;
  const source = { ...claims, ...profileFromUserInfo };
  const name = typeof source.name === 'string' ? source.name : null;

  // email and email_verified are one unit, taken from one source. When userinfo returns an email, that email
  // and its verification come from userinfo: a missing email_verified there means unverified. If the ID
  // token carries the same address (case-insensitive), the result is verified only when both sources say
  // true. Otherwise the ID token's verification covers a different address, so it never applies. Without a
  // userinfo email, the ID token pair is used whole.
  const idEmail = typeof claims.email === 'string' ? claims.email : '';
  const idVerified = claims.email_verified === true;
  let email = idEmail;
  let emailVerified = idVerified;
  if (userInfo !== undefined && typeof userInfo.email === 'string' && userInfo.email !== '') {
    email = userInfo.email;
    const sameAddress = idEmail !== '' && idEmail.toLowerCase() === email.toLowerCase();
    emailVerified = userInfo.email_verified === true && (sameAddress ? idVerified : true);
  }
  if (email === '' || !emailVerified) {
    throw new OidcLoginError('email_not_verified', 'The issuer did not return a verified email address.');
  }
  // An empty sid is no sid; the column's length rule would refuse it as a constraint error.
  const sid = typeof claims.sid === 'string' && claims.sid !== '' ? claims.sid : null;
  // provider_sid is VARCHAR(255). An oversize sid is refused here, before the identity is resolved
  // and before any write, rather than failing the link INSERT halfway through the sign-in.
  if (sid !== null && sid.length > MAX_SID_LENGTH) {
    throw new OidcLoginError('invalid_sid', 'The issuer returned a session id this server cannot store.');
  }

  return {
    issuer: claims.iss,
    subject: rawSubject,
    email,
    emailVerified: true,
    name,
    sid,
    // The raw ID token. The callback seals it before it reaches the database (W6-CDX-6); this module
    // never writes it, and no refusal or log line carries it.
    idToken: tokens.id_token,
    // Validated again at the callback: a seal written under an older rule cannot redirect anywhere
    // the current rule refuses.
    returnTo: safeReturnTo(flow.returnTo),
  };
}

/**
 * The fields of a userinfo response that it actually returned: an undefined field overrides nothing.
 * @param {Record<string, unknown>} userInfo
 * @returns {Record<string, unknown>}
 */
function definedFields(userInfo) {
  return Object.fromEntries(Object.entries(userInfo).filter(([, value]) => value !== undefined));
}

/**
 * The name of an error, for logs: never its message, which can carry the issuer's wording or
 * a token.
 * @param {unknown} cause
 * @returns {string}
 */
export function errorName(cause) {
  if (cause instanceof Error) {
    const code = typeof cause.code === 'string' ? cause.code : null;
    return code ? `${cause.name}/${code}` : cause.name;
  }
  return 'unknown error';
}

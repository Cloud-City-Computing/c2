/**
 * The OIDC sign-in routes: GET /api/auth/oidc/start and GET /api/auth/oidc/callback
 *
 * Mounted by app.js only when OIDC_ISSUER_URL is set (getOidcConfig), so an install that sets none
 * of the OIDC variables has no such route. The protocol lives in services/oidc.js and the ladder that
 * decides which local user the identity is lives in services/identity.js; this file wires them,
 * sets the session the way the Google callback does, and turns every refusal into
 * /?oauth_error=<code>&oauth_provider=oidc, the code the sign-in screen reads.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { generateSessionToken } from '../mysql_connect.js';
import { asyncHandler, errorHandler } from './helpers/shared.js';
import { resolveIdentity } from '../services/identity.js';
import { sessionCookieName } from '../services/session-cookie.js';
import { safeReturnTo } from '../services/return-to.js';
import { sealIdToken } from '../services/id-token-seal.js';
import {
  verifyLogoutToken,
  revokeForLogoutToken,
  rememberJti,
  LogoutTokenUnavailable,
} from '../services/backchannel-logout.js';
import { closeSocketsForSessions as closeCollabSockets } from '../services/collab.js';
import { closeSocketsForSessions as closeUserChannelSockets } from '../services/user-channel.js';
import {
  getOidcConfig,
  beginLogin,
  completeLogin,
  oidcFlowCookie,
  readOidcFlowCookie,
  OidcLoginError,
  errorName,
  FLOW_TTL_MS,
} from '../services/oidc.js';

const router = express.Router();

/*
 * Its own bucket, never authLimiter: every logout token arrives from the issuer's one address, and a
 * deprovisioning sweep sends a burst of them. Only a refused delivery (a 400) counts, so a verified
 * delivery, a 503 the issuer retries, and a 429 never spend the budget (Command's back-channel ADR).
 * The key is req.ip, which honours X-Forwarded-For only from a TRUST_PROXY peer, so behind the host
 * proxy one client's failures cannot exhaust another's budget.
 */
const backchannelLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode !== 400,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'Too many logout deliveries, please try again later' },
});

const parseLogoutForm = express.urlencoded({ extended: false, limit: '16kb' });

/** Every answer on the back-channel receiver carries no-store, the 429 and the 400 included. */
function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/** An unparseable or oversize body is one refused delivery, not a server fault. */
function parseOrRefuse(req, res, next) {
  parseLogoutForm(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: 'Invalid logout token' });
    return next();
  });
}

/**
 * GET /api/auth/oidc/start?returnTo=
 * Sets the signed flow cookie (state, nonce, PKCE verifier and the validated returnTo) and sends the
 * browser to the issuer. A discovery failure goes back to the sign-in screen, not to a 500.
 */
router.get('/auth/oidc/start', asyncHandler(async (req, res) => {
  const config = getOidcConfig();
  if (config === null) {
    return res.status(404).json({ success: false, message: 'OIDC sign-in is not configured' });
  }

  let begun;
  try {
    begun = await beginLogin(config, { returnTo: safeReturnTo(req.query.returnTo) });
  } catch (cause) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}: OIDC sign-in unavailable (${errorName(cause)})`);
    return res.redirect('/?oauth_error=exchange_failed&oauth_provider=oidc');
  }

  const { name, options } = oidcFlowCookie(config);
  res.cookie(name, begun.flowCookie, { ...options, maxAge: FLOW_TTL_MS });
  res.redirect(begun.url);
}));

/**
 * GET /api/auth/oidc/callback
 * Completes the code exchange, decides the local user through the seam, and mints one session for
 * this sign-in with its identity and the issuer's sid. OIDC sessions skip local two-factor: the
 * issuer's own MFA governs a linked identity.
 */
router.get('/auth/oidc/callback', asyncHandler(async (req, res) => {
  const config = getOidcConfig();
  if (config === null) return res.redirect('/?oauth_error=exchange_failed&oauth_provider=oidc');

  const { name, options } = oidcFlowCookie(config);
  const flowValue = readOidcFlowCookie(req.headers.cookie, config);
  // The flow is single-use: cleared on every outcome, so a refused attempt cannot be replayed.
  res.clearCookie(name, options);

  // The callback URL is rebuilt from the configured redirect URI, never from the request's Host.
  const current = new URL(config.redirectUri);
  current.search = new URL(req.originalUrl, config.redirectUri).search;

  let identity;
  try {
    identity = await completeLogin(config, current, flowValue);
  } catch (err) {
    if (!(err instanceof OidcLoginError)) throw err;
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}: OIDC sign-in refused (${err.code})`);
    return res.redirect(`/?oauth_error=${err.code}&oauth_provider=oidc`);
  }

  const resolved = await resolveIdentity(
    {
      provider: 'oidc',
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      name: identity.name,
    },
    { linkByVerifiedEmail: config.linkByVerifiedEmail, autoCreate: false }
  );
  if (!resolved.ok) {
    return res.redirect(`/?oauth_error=${resolved.reason}&oauth_provider=oidc`);
  }

  const sessionToken = await generateSessionToken({ id: resolved.userId }, req.ip, req.headers['user-agent'], {
    provider: 'oidc',
    identityId: resolved.identityId,
    providerSid: identity.sid,
    ttlHours: config.sessionTtlHours,
    // Sealed, never the raw token: sign-out sends it as id_token_hint (W6-CDX-6).
    oidcIdToken: sealIdToken(identity.idToken, config.clientSecret),
  });

  // The session cookie is set exactly as the Google callback sets it (services/session-cookie.js).
  res.cookie(sessionCookieName({ secure: config.secure }), sessionToken, {
    maxAge: config.sessionTtlHours * 60 * 60 * 1000,
    httpOnly: false, // The page reads it to authenticate its WebSockets
    secure: config.secure,
    sameSite: 'strict',
    path: '/',
  });

  res.redirect(identity.returnTo);
}));

/**
 * POST /api/auth/oidc/backchannel-logout
 * The issuer's back-channel logout (OIDC Back-Channel Logout 1.0). Mounted only with OIDC. A verified
 * token ends the oidc sessions it names and closes their sockets; an invalid one is 400 and final for
 * the issuer; a key the relying party cannot fetch is 503, which the issuer retries. The jti is
 * recorded only after the delete commits, so a retry of a delivery that failed still runs.
 */
router.post(
  '/auth/oidc/backchannel-logout',
  noStore,
  backchannelLimiter,
  parseOrRefuse,
  asyncHandler(async (req, res) => {
    const config = getOidcConfig();
    if (config === null) return res.status(404).json({ success: false, message: 'OIDC sign-in is not configured' });

    let claims;
    try {
      claims = await verifyLogoutToken(config, req.body?.logout_token);
    } catch (err) {
      if (!(err instanceof LogoutTokenUnavailable)) throw err;
      console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}: back-channel logout deferred (${err.message})`);
      return res.status(503).json({ success: false, message: 'Logout token could not be checked, try again' });
    }
    if (claims === null) return res.status(400).json({ success: false, message: 'Invalid logout token' });

    const deleted = await revokeForLogoutToken(claims);
    rememberJti(claims.jti);
    closeCollabSockets(deleted);
    closeUserChannelSockets(deleted);
    return res.status(200).end();
  })
);

router.use(errorHandler);

export default router;

/**
 * Express application setup for Cloud Codex
 *
 * Extracted from server.js to allow importing the app in tests
 * without starting the ViteExpress listener.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import searchRoutes from './routes/search.js';
import documentRoutes from './routes/documents.js';
import uploadRoutes from './routes/upload.js';
import archivesRouter from './routes/archives.js';
import workspacesRouter from './routes/workspaces.js';
import squadsRouter from './routes/squads.js';
import commentsRouter from './routes/comments.js';
import avatarsRouter from './routes/avatars.js';
import docImagesRouter from './routes/doc-images.js';
import adminRouter from './routes/admin.js';
import oauthRouter from './routes/oauth.js';
import githubRouter from './routes/github.js';
import favoritesRouter from './routes/favorites.js';
import notificationsRouter from './routes/notifications.js';
import activityRouter from './routes/activity.js';
import watchesRouter from './routes/watches.js';
import firstRunRouter from './routes/first-run.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// What an unset or blank TRUST_PROXY trusts: a peer on loopback, a link-local
// address or a private range (10/8, 172.16/12, 192.168/16, fc00::/7). That is
// where a reverse proxy on the same host connects from over the Docker bridge,
// and where a cloud load balancer's private address does. Any other peer is
// counted by its own socket address, whatever X-Forwarded-For it sends
// (GHSA-9fmx-frrf-xxmq: the old default, 1, believed that header from anyone).
const DEFAULT_TRUST_PROXY = 'loopback, linklocal, uniquelocal';

/**
 * Express's `trust proxy` value from TRUST_PROXY. Unset or blank is the
 * trusted-subnet default above, `false` trusts no proxy, and anything else (a
 * subnet name, an address or CIDR list) is passed to Express, which validates
 * it. A hop count, 0 included, or `true` is refused unless
 * TRUST_PROXY_ALLOW_HOP_COUNT is `true`: either believes the X-Forwarded-For of
 * whoever connects, so a client that can reach the app's port directly picks
 * its own address and a fresh rate-limit bucket per request.
 * @param { String | undefined } value TRUST_PROXY
 * @param { String | undefined } allowHopCount TRUST_PROXY_ALLOW_HOP_COUNT
 * @returns { Number | Boolean | String }
 * @throws { Error } a sentence naming the variable, on a refused value
 */
export function parseTrustProxy(value, allowHopCount) {
  const allow = (allowHopCount ?? '').trim();
  if (allow !== '' && allow !== 'true' && allow !== 'false') {
    throw new Error(`TRUST_PROXY_ALLOW_HOP_COUNT "${allowHopCount}" is not true or false.`);
  }
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return DEFAULT_TRUST_PROXY;
  if (trimmed === 'false') return false;
  const hopCount = /^\d+$/.test(trimmed);
  if (!hopCount && trimmed !== 'true') return trimmed;
  if (allow !== 'true') {
    throw new Error(`TRUST_PROXY "${value}" ${hopCount ? 'is a hop count' : 'trusts every hop'}, which believes `
      + 'the X-Forwarded-For of whoever connects, so any client that can reach the app\'s port directly '
      + 'can choose its own address and step around the rate limiters. Leave it unset to trust a proxy on '
      + 'loopback or a private network, list the proxy\'s addresses or subnets, use false for no proxy, '
      + 'or set TRUST_PROXY_ALLOW_HOP_COUNT=true to accept that.');
  }
  return hopCount ? Number(trimmed) : true;
}

// Decides req.ip, which is what the rate limiters count. A refused value, or
// one Express cannot compile, stops the boot with a sentence naming the
// variable rather than a stack trace.
try {
  const setting = parseTrustProxy(process.env.TRUST_PROXY, process.env.TRUST_PROXY_ALLOW_HOP_COUNT);
  try {
    app.set('trust proxy', setting);
  } catch (err) {
    throw new Error(`TRUST_PROXY "${process.env.TRUST_PROXY}" is not valid: ${err.message}.`, { cause: err });
  }
} catch (err) {
  console.error(`✖ ${err.message}`);
  console.error('  See TRUST_PROXY and TRUST_PROXY_ALLOW_HOP_COUNT in .env.example.');
  process.exit(1);
}

// CORS: restrict the API to same-origin requests, plus an explicit allowlist.
//
// The request-taking form of cors() is used because deciding this needs the
// Host header, and the origin-only callback never sees the request. Browsers
// send an Origin header on same-origin POST/PUT/DELETE, so a rule written
// against Origin alone cannot tell the app's own login form apart from another
// site's, and the previous version rejected both: a production instance with
// no CORS_ORIGIN set answered its own login request with a 500, which is every
// self-hosted install following .env.example.
app.use('/api', cors((req, cb) => {
  const origin = req.headers.origin;
  const options = { credentials: true };

  // No Origin header: a same-origin GET, a server-to-server call, curl.
  if (!origin) return cb(null, { ...options, origin: true });

  const hostOf = (value) => {
    try {
      // Lowercased by the URL parser. req.headers.host is not, so both sides of
      // every comparison below go through here.
      return new URL(value).host || null;
    } catch {
      return null;
    }
  };

  const originHost = hostOf(origin);

  // Same origin. Compared on host rather than the whole URL so that an install
  // behind a TLS-terminating proxy, where the browser sends an https Origin and
  // the app sees a plain http request, is still recognised as itself.
  //
  // Deliberately the raw Host header and NOT req.hostname: req.hostname honours
  // X-Forwarded-Host from any peer `trust proxy` believes, which by default is
  // anything on a private network or the same host, and more if TRUST_PROXY
  // says so, and any of those can send the header itself. That would turn
  // this clause into "allow any origin that asks".
  const rawHost = req.headers.host ? hostOf(`http://${req.headers.host}`) : null;
  if (originHost && rawHost && originHost === rawHost) {
    return cb(null, { ...options, origin: true });
  }

  // The configured public origin. A reverse proxy that does not rewrite Host
  // (nginx's default `proxy_pass` sends Host: 127.0.0.1:3000, not the public
  // name) would otherwise make the app reject its own browser again, which is
  // the same outage this middleware was rewritten to fix. APP_URL is already
  // required, and unlike X-Forwarded-Host it is operator-set, not caller-set.
  const appHost = process.env.APP_URL ? hostOf(process.env.APP_URL) : null;
  if (originHost && appHost && originHost === appHost) {
    return cb(null, { ...options, origin: true });
  }

  // Explicitly allowed cross-origin caller.
  const allowed = process.env.CORS_ORIGIN;
  if (allowed && origin === allowed) return cb(null, { ...options, origin: true });

  // In development only, allow localhost origins on any port, so the Vite dev
  // server on 5173 can call the API on 3000.
  if (process.env.NODE_ENV !== 'production' && originHost) {
    const hostname = originHost.split(':')[0];
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return cb(null, { ...options, origin: true });
    }
  }

  cb(new Error('Not allowed by CORS'));
}));

// Security headers. One policy. In production it covers every response, the
// single-page app's HTML and static files included, because this mount comes
// before the /avatars and /doc-images mounts and before the handlers
// vite-express appends at listen time. In development it stays on /api so the
// Vite dev server's inline module scripts still load.
//
// Helmet 8 merges these over its default directives, so a default that must
// not apply is switched off by name (null).
const HELMET_OPTIONS = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Documents may hold any https image (pasted, or imported from GitHub),
      // and the linked GitHub account's avatar is remote; an image cannot run
      // script.
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      // TLS is the proxy's job. The default would send the built app's own
      // http:// asset requests to https:// on an install without TLS, and the
      // release compose file serves http://localhost:3000.
      upgradeInsecureRequests: null,
    },
  },
  // The draw.io editor is a popup on embed.diagrams.net that talks back
  // through window.opener. Helmet's default, same-origin, severs that link for
  // a cross-origin popup the page opens, so the editor would never receive the
  // diagram or return it. This keeps the link for popups the page opens and
  // still isolates the page from any window that opens it.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  xFrameOptions: { action: 'deny' },
};
app.use(process.env.NODE_ENV === 'production' ? '/' : '/api', helmet(HELMET_OPTIONS));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'Too many attempts, please try again later' },
});

app.use(express.json({ limit: '2mb' }));

// Apply auth rate limiter
app.use('/api/login', authLimiter);
app.use('/api/create-account', authLimiter);
app.use('/api/forgot-password', authLimiter);
app.use('/api/reset-password', authLimiter);
app.use('/api/2fa/verify', authLimiter);
app.use('/api/2fa/totp/confirm', authLimiter);
app.use('/api/2fa/disable/confirm', authLimiter);
app.use('/api/oauth/google/callback', authLimiter);
// update-account checks the current password for an email or password change,
// which would otherwise let a stolen session guess at it without limit. A
// path mount also matches /api/update-account/confirm-email, whose code check
// needs the same bound, so that step is covered without a second mount (a
// second one would count each confirm twice).
app.use('/api/update-account', authLimiter);
/*
 * C2-5's reader check. An oracle answering a boolean invites enumeration even
 * behind a credential -- if the service token ever leaks, an unbounded one
 * hands the holder a membership map of the whole install at whatever rate they
 * can issue requests. The same bucket the login surface uses.
 *
 * A path pattern rather than an exact path, because the workspace id is a route
 * parameter: express matches `/api/workspaces/7/reader-check` against this.
 */
app.use(/^\/api\/workspaces\/\d+\/reader-check$/, authLimiter);

// Rate limiting for user search (prevents user enumeration)
const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'Too many search requests, please try again later' },
});
app.use('/api/users/search', searchLimiter);

// Serve uploaded avatars as static files
app.use('/avatars', express.static(path.join(__dirname, 'public', 'avatars'), {
  maxAge: '7d',
  immutable: true,
}));

// Serve document images as static files (extracted from embedded base64)
app.use('/doc-images', express.static(path.join(__dirname, 'public', 'doc-images'), {
  maxAge: '30d',
  immutable: true,
}));

// Mount route groups
app.use('/api', authRoutes);
app.use('/api', searchRoutes);
app.use('/api', archivesRouter);
app.use('/api', documentRoutes);
app.use('/api', uploadRoutes);
app.use('/api', workspacesRouter);
app.use('/api', squadsRouter);
app.use('/api', commentsRouter);
app.use('/api', avatarsRouter);
app.use('/api', docImagesRouter);
app.use('/api', adminRouter);
app.use('/api', oauthRouter);
app.use('/api', githubRouter);
app.use('/api', favoritesRouter);
app.use('/api', notificationsRouter);
app.use('/api', activityRouter);
app.use('/api', firstRunRouter);
app.use('/api', watchesRouter);

export default app;

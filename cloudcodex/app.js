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

// Trust the first proxy in a request (required for correct client IP behind Docker/reverse proxies)
// Needed for rate limiting, sessions, and req.ip to work properly
app.set('trust proxy', 1);

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

  let originHost = null;
  try {
    originHost = new URL(origin).host;
  } catch { /* malformed Origin header */ }

  // Same origin. Compared on host rather than the whole URL so that an install
  // behind a TLS-terminating proxy, where the browser sends an https Origin and
  // the app sees a plain http request, is still recognised as itself.
  if (originHost && req.headers.host && originHost === req.headers.host) {
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

// Security headers (scoped to API routes so Vite dev server isn't affected)
app.use('/api', helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));

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

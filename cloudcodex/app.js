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
import projectsRouter from './routes/projects.js';
import organizationsRouter from './routes/organizations.js';
import teamsRouter from './routes/teams.js';
import commentsRouter from './routes/comments.js';
import avatarsRouter from './routes/avatars.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// CORS: restrict API to same-origin requests only
app.use('/api', cors({
  origin: (origin, cb) => {
    // Allow requests with no Origin header (same-origin, server-to-server, etc.)
    if (!origin) return cb(null, true);
    // Allow if an explicit allowlist is configured
    const allowed = process.env.CORS_ORIGIN;
    if (allowed && origin === allowed) return cb(null, true);
    // In development only, allow localhost origins on any port
    if (process.env.NODE_ENV !== 'production') {
      try {
        const parsed = new URL(origin);
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
          return cb(null, true);
        }
      } catch { /* invalid origin */ }
    }
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
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

// Mount route groups
app.use('/api', authRoutes);
app.use('/api', searchRoutes);
app.use('/api', projectsRouter);
app.use('/api', documentRoutes);
app.use('/api', uploadRoutes);
app.use('/api', organizationsRouter);
app.use('/api', teamsRouter);
app.use('/api', commentsRouter);
app.use('/api', avatarsRouter);

export default app;

/**
 * Main Express API for Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import ViteExpress from 'vite-express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { verifyEmailConnection } from './services/email.js';

import authRoutes from './routes/auth.js';
import searchRoutes from './routes/search.js';
import documentRoutes from './routes/documents.js';
import projectsRouter from './routes/projects.js';
import organizationsRouter from './routes/organizations.js';
import teamsRouter from './routes/teams.js';

const app = express();

// Security headers (scoped to API routes so Vite dev server isn't affected)
app.use('/api', helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
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
  message: { success: false, message: 'Too many attempts, please try again later' },
});

app.use(express.json({ limit: '2mb' }));

// Apply auth rate limiter
app.use('/api/login', authLimiter);
app.use('/api/create-account', authLimiter);
app.use('/api/forgot-password', authLimiter);
app.use('/api/2fa/verify', authLimiter);
app.use('/api/2fa/totp/confirm', authLimiter);
app.use('/api/2fa/disable/confirm', authLimiter);

// Rate limiting for user search (prevents user enumeration)
const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many search requests, please try again later' },
});
app.use('/api/users/search', searchLimiter);

// Mount route groups
app.use('/api', authRoutes);
app.use('/api', searchRoutes);
app.use('/api', projectsRouter);
app.use('/api', documentRoutes);
app.use('/api', organizationsRouter);
app.use('/api', teamsRouter);

ViteExpress.listen(app, 3000, async () => {
  console.log('CloudCodex API Server is running on http://localhost:3000');
  const emailOk = await verifyEmailConnection();
  console.log(emailOk ? '✔ SMTP connection verified' : '✖ SMTP connection failed — check .env credentials');
});

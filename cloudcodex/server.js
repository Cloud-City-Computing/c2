/**
 * Main Express API for Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import ViteExpress from 'vite-express';
import { verifyEmailConnection } from './services/email.js';
import app from './app.js';

ViteExpress.listen(app, 3000, async () => {
  console.log('CloudCodex API Server is running on http://localhost:3000');
  const emailOk = await verifyEmailConnection();
  console.log(emailOk ? '✔ SMTP connection verified' : '✖ SMTP connection failed — check .env credentials');
});

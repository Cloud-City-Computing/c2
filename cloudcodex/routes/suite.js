/**
 * Cloud Codex - Suite mode routes
 *
 * GET /api/suite is public and answers whether suite mode is on and the suite's name, never the
 * Cloud Command URL. GET /api/suite/links needs a session and answers that URL, or 404 when
 * suite mode is off.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { readSuiteConfig } from '../services/suite.js';
import { errorHandler } from './helpers/shared.js';

const router = express.Router();

// Synchronous: the config is read from the environment, so there is nothing to await.
router.get('/suite', (req, res) => {
  const suite = readSuiteConfig();
  res.json({ enabled: suite.enabled, name: suite.name });
});

router.get('/suite/links', requireAuth, (req, res) => {
  const suite = readSuiteConfig();
  if (!suite.enabled) return res.status(404).json({ success: false, message: 'Suite mode is off' });
  res.json({ commandWorkspaceUrl: suite.commandWorkspaceUrl });
});

router.use(errorHandler);

export default router;

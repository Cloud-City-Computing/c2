/**
 * Main Express API for Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import ViteExpress from 'vite-express';
import { initMail } from './services/email.js';
import { setupCollabServer } from './services/collab.js';
import { setupUserChannelServer } from './services/user-channel.js';
import { c2_query } from './mysql_connect.js';
import { ensureAdminUser, bootstrapInstance } from './routes/admin.js';
import app from './app.js';

// ─── Require Admin credentials before starting ──────────────
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.ADMIN_EMAIL) {
  console.error('✖ Missing required admin configuration: ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL');
  console.error('  Copy .env.example to .env and fill in your admin credentials.');
  process.exit(1);
}

const server = ViteExpress.listen(app, 3000, async () => {
  console.log('CloudCodex API Server is running on http://localhost:3000');

  const mail = await initMail();
  if (mail.enabled) {
    console.log('✔ SMTP connection verified');
  } else {
    console.error(
      `✖ Email disabled: ${mail.reason}. ` +
      'Invites will show copyable links; password reset is unavailable.'
    );
  }

  // Ensure the admin super user exists in the database
  const adminId = await ensureAdminUser();
  await bootstrapInstance(adminId);
});

// Attach WebSocket collaborative editing server to the HTTP server
setupCollabServer(server);
console.log('✔ Collaborative editing WebSocket server attached');

// Attach user-scoped notification WebSocket server (for inbox push)
setupUserChannelServer(server);
console.log('✔ Notification WebSocket server attached');

// Daily prune of activity_log entries older than 365 days.
// Single-process architecture (per CLAUDE.md) — revisit if we ever scale out.
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
async function pruneOldActivity() {
  try {
    const result = await c2_query(
      `DELETE FROM activity_log WHERE created_at < (NOW() - INTERVAL 365 DAY)`,
      []
    );
    if (result?.affectedRows) {
      console.error(`[${new Date().toISOString()}] activity prune: removed ${result.affectedRows} rows`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] activity prune failed:`, err);
  }
}
setInterval(pruneOldActivity, ONE_DAY_MS).unref();
// Run once shortly after boot so a long-uptime process gets cleaned without waiting 24h
setTimeout(pruneOldActivity, 60 * 1000).unref();

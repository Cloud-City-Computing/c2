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

// ─── Decide capability and seed BEFORE the port opens ───────
//
// ViteExpress.listen() binds the socket and starts accepting requests before
// it runs its callback, so anything awaited in there serves traffic with the
// answer still undecided: a correctly configured instance would report
// isMailEnabled() === false while initMail() is in flight (forgot-password
// unavailable, invitations not emailed), and a first boot would serve an
// empty app until the seed landed. These are top-level awaits instead.

let mail;
try {
  mail = await initMail();
} catch (err) {
  console.error(`[${new Date().toISOString()}] mail capability check failed:`, err);
  mail = { enabled: false, reason: 'mail capability check threw' };
}
if (mail.enabled) {
  console.log('✔ SMTP connection verified');
} else {
  console.error(
    `✖ Email disabled: ${mail.reason}. ` +
    'Invites will show copyable links; password reset is unavailable.'
  );
}

// Ensure the admin super user exists in the database, then seed a starter
// workspace on a first boot. Neither may take the process down: a DB blip
// here would otherwise mean the app never listens at all. A failed seed
// leaves the instance empty but usable, and because the guard is on an
// empty database the next restart retries.
let adminId = null;
try {
  adminId = await ensureAdminUser();
} catch (err) {
  console.error(`[${new Date().toISOString()}] admin user sync failed:`, err);
}
try {
  await bootstrapInstance(adminId);
} catch (err) {
  console.error(`[${new Date().toISOString()}] instance bootstrap failed:`, err);
}

const server = ViteExpress.listen(app, 3000, () => {
  console.log('CloudCodex API Server is running on http://localhost:3000');
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

/**
 * Main Express API for Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import ViteExpress from 'vite-express';
import { initMail } from './services/email.js';
import { setupCollabServer, flushPendingSaves, closeAll as closeCollabSockets } from './services/collab.js';
import { setupUserChannelServer, closeAll as closeUserChannelSockets } from './services/user-channel.js';
import { c2_query, openConnection, endPool } from './mysql_connect.js';
import { ensureAdminUser, bootstrapInstance } from './routes/admin.js';
import { parseAuthProviders } from './services/identity.js';
import { acquireInstanceLock } from './services/instance-lock.js';
import { createShutdown } from './services/shutdown.js';
import { readiness } from './routes/health.js';
import app from './app.js';

// ─── Stop signals, from the first line of the boot ──────────
//
// The image runs `node server.js` directly, so Node is PID 1, and the kernel
// drops any signal PID 1 has no handler for: a SIGTERM during the boot awaits
// below (the lock, the SMTP verify, the admin sync) would otherwise be
// ignored until Docker's SIGKILL. So the handlers go in first. Before the
// server listens there is nothing to flush and the lock goes with the
// process, so a stop then exits at once. Once it listens, the first signal
// runs the bounded shutdown (services/shutdown.js) and a second one, a
// second Ctrl-C say, ends the process at once with 1.
const stopLog = (line) => console.error(`[${new Date().toISOString()}] ${line}`);
let shutdown = null;          // set once the server is up
let signalsSeen = 0;
function onStopSignal(signal) {
  signalsSeen++;
  if (signalsSeen > 1) {
    stopLog(`second ${signal} before the shutdown finished; stopping at once`);
    process.exit(1);
    return;
  }
  if (!shutdown) {
    stopLog(`stopped on ${signal} during boot`);
    process.exit(0);
    return;
  }
  return shutdown(signal);
}
process.on('SIGTERM', () => onStopSignal('SIGTERM'));
process.on('SIGINT', () => onStopSignal('SIGINT'));

// ─── Require Admin credentials before starting ──────────────
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.ADMIN_EMAIL) {
  console.error('✖ Missing required admin configuration: ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL');
  console.error('  Copy .env.example to .env and fill in your admin credentials.');
  process.exit(1);
}

// ─── Require APP_URL in production ──────────────────────────
//
// Invitation, password-reset and notification links are built from APP_URL,
// and unset it falls back to http://localhost:3000 (routes/helpers/shared.js).
// That default is right for development and silently wrong anywhere else: a
// production instance would email links pointing at the reader's own machine.
if (process.env.NODE_ENV === 'production') {
  const appUrl = process.env.APP_URL;
  const isHttpUrl = (value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  };
  if (appUrl === undefined || appUrl.trim() === '') {
    console.error('✖ APP_URL is required in production: set it to the address people use to reach this instance.');
    process.exit(1);
  } else if (!isHttpUrl(appUrl)) {
    console.error(
      `✖ APP_URL "${appUrl}" is not an http or https URL: ` +
      'set it to the address people use to reach this instance, such as https://docs.example.com.'
    );
    process.exit(1);
  } else if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$|\.localhost$/.test(new URL(appUrl).hostname)) {
    // Allowed, since an evaluation run on one machine is legitimate, but a
    // copied .env.example on a public host would otherwise go unnoticed.
    console.error(
      `⚠ APP_URL "${appUrl}" points at this machine, so emailed links open nowhere else. ` +
      'Set it to the public address unless this instance is only used here.'
    );
  }
}

// ─── Validate the sign-in provider list ─────────────────────
//
// AUTH_PROVIDERS is optional and unset means today's set. A value that names
// an unknown provider, or one that is not configured, stops the boot here
// rather than starting an instance whose sign-in page disagrees with it.
try {
  parseAuthProviders();
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exit(1);
}

// ─── One process per schema: take the instance lock ─────────
//
// Before anything writes, so a second process refuses before its admin sync
// or seed can race the first one's. Collab state is an in-memory Y.Doc per
// open document, and a second process would hold a second copy of each
// (services/instance-lock.js). A refusal, or no database to take it from,
// ends the boot: under a supervisor that is a restart, not an outage. So does
// finding, after a lost connection, that another process took the lock
// meanwhile: this one stops, through the shutdown once it is serving.
let instanceLock = null;
const onSuperseded = () => {
  stopLog('another process took the instance lock while this one had lost it; stopping, so one process serves this database');
  if (shutdown) {
    shutdown('the lost instance lock', { code: 1 });
  } else {
    process.exit(1);
  }
};
try {
  instanceLock = await acquireInstanceLock({ connect: openConnection, log: stopLog, onSuperseded });
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exit(1);
}
readiness.lock = instanceLock;

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

// ─── Resolve the port ───────────────────────────────────────
//
// PORT is honoured so an instance can run somewhere other than 3000, which a
// self-hoster needs the moment something else already owns that port. An
// invalid value fails loudly instead of falling back, because a typo that
// quietly starts the app somewhere other than where the operator asked is the
// same defect wearing a friendlier face.
const DEFAULT_PORT = 3000;
let port = DEFAULT_PORT;
const configuredPort = process.env.PORT;
if (configuredPort !== undefined && configuredPort.trim() !== '') {
  const parsed = Number(configuredPort);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    console.error(`✖ Invalid PORT "${configuredPort}": expected an integer between 0 and 65535.`);
    console.error(`  Leave PORT unset to use the default (${DEFAULT_PORT}).`);
    process.exit(1);
  } else {
    port = parsed;
  }
}

const server = ViteExpress.listen(app, port, () => {
  // `server.listening` is the guard, and it is not paranoia. Express 5 aliases
  // this callback onto the socket's 'error' event
  // (express/lib/application.js: `server.once('error', done)`), so it runs on a
  // FAILED bind too. That is why this file used to log
  // "running on http://localhost:3000" while the port was owned by an
  // unrelated application and requests to that URL reached someone else.
  // Express 4 had no such aliasing, so the bug arrived with the framework, not
  // with vite-express.
  //
  // The 'listening' event is the other honest signal, but it is the WRONG one
  // here: vite-express registers first and injects the Vite middleware
  // asynchronously, so 'listening' fires roughly twelve seconds before the dev
  // server can actually serve a page. This callback runs after that injection,
  // so it reports readiness rather than merely binding.
  if (!server.listening) return;

  // Report the port actually bound, not the one requested. They differ when
  // PORT is 0, which asks the OS to pick a free one, and reporting the
  // request rather than the result is the same class of lie this fixes.
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;
  console.log(`CloudCodex API Server is running on http://localhost:${boundPort}`);

  // What the process trusts about the client address, and where that came
  // from. Both ways the boundary fails are silent (every client behind an
  // unlisted proxy in one rate-limit bucket, or a key anyone can choose) and
  // /healthz and /readyz show neither, so the log is where an operator checks it.
  // Printed here, after the bind, so a crash loop does not scroll it away.
  const trusted = app.get('trust proxy');
  const source = (process.env.TRUST_PROXY ?? '').trim() === '' ? 'the default' : 'from TRUST_PROXY';
  console.error(`✔ Trusting proxies (${source}): ${trusted === false ? 'none, X-Forwarded-For is ignored' : trusted}`);
});

// Without a handler, a bind failure is an unhandled 'error' event. A process
// that cannot accept requests is not degraded, it is useless, so say which
// port and why, then exit non-zero and let the supervisor report it.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`✖ Port ${port} is already in use.`);
    console.error('  Set PORT in .env to a free port, or stop whatever is holding it.');
  } else {
    console.error(`[${new Date().toISOString()}] HTTP server error:`, err);
  }
  process.exit(1);
});

// Attach WebSocket collaborative editing server to the HTTP server
setupCollabServer(server);
console.log('✔ Collaborative editing WebSocket server attached');

// Attach user-scoped notification WebSocket server (for inbox push)
setupUserChannelServer(server);
console.log('✔ Notification WebSocket server attached');

// ─── Stop cleanly on SIGTERM / SIGINT ───────────────────────
//
// From here a stop signal runs this, bounded at ten seconds; the compose
// files give a twenty-second grace before SIGKILL. The handlers themselves
// were installed at the top of this file.
shutdown = createShutdown({
  server,
  readiness,
  flushPendingSaves,
  closeSockets: (code, reason) => {
    closeCollabSockets(code, reason);
    closeUserChannelSockets(code, reason);
  },
  releaseLock: () => instanceLock?.release(),
  endPool,
  exit: (code) => process.exit(code),
  log: stopLog,
});

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

// Daily prune of expired sessions. Every row has a fixed 7-day life and
// nothing refreshes one in place, and each sign-in adds a row, so without
// this the table only grows. validateAndAutoLogin already refuses an expired
// row; this only reclaims the space.
async function pruneExpiredSessions() {
  try {
    const result = await c2_query(`DELETE FROM sessions WHERE expires_at < NOW()`, []);
    if (result?.affectedRows) {
      console.error(`[${new Date().toISOString()}] session prune: removed ${result.affectedRows} rows`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] session prune failed:`, err);
  }
}
setInterval(pruneExpiredSessions, ONE_DAY_MS).unref();
setTimeout(pruneExpiredSessions, 60 * 1000).unref();

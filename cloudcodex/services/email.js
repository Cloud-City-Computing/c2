/**
 * Cloud Codex - Email Service
 *
 * Generic email sending module. Configure via environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Explicit timeouts. initMail() runs before the port opens, so nodemailer's
// defaults (2 minutes to connect, 30 seconds for the greeting, 10 minutes on
// the socket) would let one blackholing SMTP host hold up the whole boot.
// 10s is far more than a healthy connect or banner needs and bounds the worst
// case; SOCKET_TIMEOUT_MS covers a host that answers and then stalls mid-command.
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? 'localhost',
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: Number(process.env.SMTP_PORT ?? 587) === 465,
  auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  } : undefined,
  connectionTimeout: CONNECTION_TIMEOUT_MS,
  greetingTimeout: GREETING_TIMEOUT_MS,
  socketTimeout: SOCKET_TIMEOUT_MS,
});

const DEFAULT_FROM = process.env.SMTP_FROM ?? 'Cloud Codex <noreply@cloudcitycomputing.com>';

// --- Mail capability ---
//
// Cloud Codex runs without SMTP. The capability is decided once at boot by
// initMail(): configuration present AND the connection verifies. Consumers
// that carry a required payload (invitations, password reset) check
// isMailEnabled() and degrade; fire-and-forget consumers need no changes
// because sendEmail() becomes a no-op.

let mailReady = false;

/** True when all three required SMTP variables are present. */
export function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** True when mail is configured and verified. False until initMail() succeeds. */
export function isMailEnabled() {
  return mailReady;
}

/**
 * Determine mail availability once, at boot.
 * @returns {Promise<{enabled: boolean, reason: string|null}>}
 */
export async function initMail() {
  if (!isMailConfigured()) {
    mailReady = false;
    return { enabled: false, reason: 'SMTP_HOST, SMTP_USER or SMTP_PASS not set' };
  }
  const ok = await verifyEmailConnection();
  mailReady = ok;
  return { enabled: ok, reason: ok ? null : 'SMTP connection failed' };
}

/**
 * Reject strings containing newlines or carriage returns to prevent email header injection.
 */
function sanitizeHeaderValue(value, fieldName) {
  if (typeof value === 'string' && /[\r\n]/.test(value)) {
    throw new Error(`Invalid ${fieldName}: must not contain newline characters`);
  }
  return value;
}

/**
 * Send an email.
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject line
 * @param {string} [options.text] - Plain text body
 * @param {string} [options.html] - HTML body
 * @param {string} [options.from] - Override the default sender
 * @returns {Promise<Object>} nodemailer send result
 */
export function sendEmail({ to, subject, text, html, from }) {
  if (!mailReady) {
    return Promise.resolve({ skipped: true, reason: 'mail disabled' });
  }
  return transporter.sendMail({
    from: sanitizeHeaderValue(from ?? DEFAULT_FROM, 'from'),
    to: sanitizeHeaderValue(to, 'to'),
    replyTo: sanitizeHeaderValue(from ?? DEFAULT_FROM, 'replyTo'),
    subject: sanitizeHeaderValue(subject, 'subject'),
    text,
    html,
    headers: {
      'X-Mailer': 'Cloud Codex',
      'Precedence': 'bulk',
    },
  });
}

/**
 * Verify the SMTP connection is working.
 * @returns {Promise<boolean>}
 */
export async function verifyEmailConnection() {
  try {
    await transporter.verify();
    return true;
  } catch {
    return false;
  }
}

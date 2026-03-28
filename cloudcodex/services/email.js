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

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? 'localhost',
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: Number(process.env.SMTP_PORT ?? 587) === 465,
  auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  } : undefined,
});

const DEFAULT_FROM = process.env.SMTP_FROM ?? 'Cloud Codex <noreply@cloudcitycomputing.com>';

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
  return transporter.sendMail({
    from: from ?? DEFAULT_FROM,
    to,
    subject,
    text,
    html,
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

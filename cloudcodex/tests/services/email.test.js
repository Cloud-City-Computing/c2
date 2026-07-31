/**
 * Cloud Codex — Tests for services/email.js
 *
 * Bypasses the global email mock (in tests/setup.js) by mocking
 * nodemailer instead, then importing the real email module so the
 * actual sanitizeHeaderValue / sendMail / verify code paths run.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Bypass the global email mock — we want the real module under test.
vi.unmock('../../services/email.js');

// Mock nodemailer at the boundary.
const sendMailMock = vi.fn(async () => ({ messageId: 'sent-id' }));
const verifyMock = vi.fn(async () => true);
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: sendMailMock,
      verify: verifyMock,
    })),
  },
}));

const {
  sendEmail,
  verifyEmailConnection,
  initMail,
  isMailEnabled,
  isMailConfigured,
} = await import('../../services/email.js');

describe('services/email', () => {
  beforeEach(async () => {
    sendMailMock.mockClear();
    verifyMock.mockClear();
    sendMailMock.mockResolvedValue({ messageId: 'sent-id' });
    verifyMock.mockResolvedValue(true);
    // sendEmail is a no-op until initMail() has run; the pre-existing
    // sendEmail/verifyEmailConnection tests exercise the "enabled" path,
    // same as they did before mail became a boot-time capability.
    await initMail();
  });

  describe('sendEmail', () => {
    it('forwards to/subject/text/html through to nodemailer.sendMail', async () => {
      await sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
        text: 'Body text',
        html: '<p>Body</p>',
      });

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const arg = sendMailMock.mock.calls[0][0];
      expect(arg).toMatchObject({
        to: 'user@example.com',
        subject: 'Hello',
        text: 'Body text',
        html: '<p>Body</p>',
      });
      // Default headers
      expect(arg.headers).toMatchObject({ 'X-Mailer': 'Cloud Codex', 'Precedence': 'bulk' });
    });

    it('uses the configured DEFAULT_FROM when from is not provided', async () => {
      await sendEmail({ to: 'a@b.c', subject: 's', text: 't' });
      const { from, replyTo } = sendMailMock.mock.calls[0][0];
      expect(typeof from).toBe('string');
      expect(replyTo).toBe(from);
    });

    it('honours an explicit from override', async () => {
      await sendEmail({ to: 'a@b.c', subject: 's', from: 'custom@x.com', text: 't' });
      const { from, replyTo } = sendMailMock.mock.calls[0][0];
      expect(from).toBe('custom@x.com');
      expect(replyTo).toBe('custom@x.com');
    });

    it('throws when `to` contains a CR/LF (header injection guard)', () => {
      expect(() =>
        sendEmail({ to: 'victim@x.com\r\nBcc: leak@y.com', subject: 's', text: 't' })
      ).toThrow(/must not contain newline/);
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('throws when `subject` contains a newline', () => {
      expect(() =>
        sendEmail({ to: 'a@b.c', subject: 'line1\nline2', text: 't' })
      ).toThrow(/must not contain newline/);
    });

    it('throws when `from` contains a newline', () => {
      expect(() =>
        sendEmail({ to: 'a@b.c', subject: 's', from: 'evil\r\nBcc: leak@x.com', text: 't' })
      ).toThrow(/must not contain newline/);
    });
  });

  describe('verifyEmailConnection', () => {
    it('returns true when transporter.verify resolves', async () => {
      verifyMock.mockResolvedValueOnce(true);
      expect(await verifyEmailConnection()).toBe(true);
    });

    it('returns false when transporter.verify rejects', async () => {
      verifyMock.mockRejectedValueOnce(new Error('SMTP unavailable'));
      expect(await verifyEmailConnection()).toBe(false);
    });
  });

  describe('mail capability', () => {
    it('reports configured when all three SMTP vars are set', () => {
      expect(isMailConfigured()).toBe(true);
    });

    it('enables mail when verification succeeds', async () => {
      verifyMock.mockResolvedValueOnce(true);
      const result = await initMail();
      expect(result.enabled).toBe(true);
      expect(result.reason).toBeNull();
      expect(isMailEnabled()).toBe(true);
    });

    it('disables mail when verification fails, with a reason', async () => {
      verifyMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await initMail();
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('SMTP connection failed');
      expect(isMailEnabled()).toBe(false);
    });

    it('skips sending instead of throwing when mail is disabled', async () => {
      verifyMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await initMail();

      const result = await sendEmail({ to: 'a@b.com', subject: 'hi', text: 'x' });

      expect(result).toEqual({ skipped: true, reason: 'mail disabled' });
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('sends normally once mail is enabled again', async () => {
      verifyMock.mockResolvedValueOnce(true);
      await initMail();

      await sendEmail({ to: 'a@b.com', subject: 'hi', text: 'x' });

      expect(sendMailMock).toHaveBeenCalled();
    });
  });
});

describe('mail capability when SMTP is unconfigured', () => {
  it('reports not configured and never verifies', async () => {
    const saved = { ...process.env };
    // Empty string, not delete: email.js re-runs dotenv.config() on every
    // fresh module load, and dotenv only fills in a key that is entirely
    // absent from process.env (Object.hasOwnProperty check), so a deleted
    // key would be silently re-populated from the real .env file the
    // instant the module re-imports below, defeating this test.
    process.env.SMTP_HOST = '';
    process.env.SMTP_USER = '';
    process.env.SMTP_PASS = '';
    vi.resetModules();

    const mod = await import('../../services/email.js');
    const result = await mod.initMail();

    expect(mod.isMailConfigured()).toBe(false);
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('SMTP_HOST, SMTP_USER or SMTP_PASS not set');
    expect(mod.isMailEnabled()).toBe(false);

    process.env = saved;
    vi.resetModules();
  });
});

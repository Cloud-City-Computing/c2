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

const { sendEmail, verifyEmailConnection } = await import('../../services/email.js');

describe('services/email', () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    verifyMock.mockClear();
    sendMailMock.mockResolvedValue({ messageId: 'sent-id' });
    verifyMock.mockResolvedValue(true);
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
});

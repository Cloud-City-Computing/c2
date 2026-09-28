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
import nodemailer from 'nodemailer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractDefault } from '../contract-default.js';

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

// Make SMTP configuration explicit and hermetic. This file's pass/fail state
// must not depend on whether a real (gitignored) .env exists on disk — CI
// has none. email.js runs dotenv.config() as a module-load side effect, and
// dotenv only fills in a key that is genuinely absent from process.env
// (Object.hasOwnProperty check), so setting these here, before the first
// import below, wins over both a present and an absent .env alike.
process.env.SMTP_HOST = 'smtp.test.local';
process.env.SMTP_USER = 'test-user';
process.env.SMTP_PASS = 'test-pass';

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

// The contract states what an unset SMTP_PORT and SMTP_FROM behave as, and a
// blank one (.env.example ships SMTP_FROM blank, and compose's env_file passes
// the blank line through) must behave the same, or copying .env.example sends
// every email with an empty From.
describe('SMTP_PORT and SMTP_FROM defaults', () => {
  const importWith = async (env) => {
    const saved = { ...process.env };
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // A deleted key would otherwise be refilled from a developer's real .env.
    vi.doMock('dotenv', () => ({ default: { config: vi.fn() } }));
    try {
      vi.resetModules();
      nodemailer.createTransport.mockClear();
      sendMailMock.mockClear();
      const mod = await import('../../services/email.js');
      await mod.initMail();
      await mod.sendEmail({ to: 'a@b.c', subject: 's', text: 't' });
      return {
        transport: nodemailer.createTransport.mock.calls[0][0],
        mail: sendMailMock.mock.calls[0][0],
      };
    } finally {
      vi.doUnmock('dotenv');
      process.env = saved;
      vi.resetModules();
    }
  };

  it.each([undefined, '', '  '])('SMTP_PORT %j is the contract default', async (value) => {
    const { transport } = await importWith({ SMTP_PORT: value });
    expect(transport.port).toBe(Number(contractDefault('SMTP_PORT')));
    expect(transport.secure).toBe(false);
  });

  it('SMTP_PORT 465 is implicit TLS', async () => {
    const { transport } = await importWith({ SMTP_PORT: '465' });
    expect(transport.port).toBe(465);
    expect(transport.secure).toBe(true);
  });

  it.each([undefined, '', '  '])('SMTP_FROM %j is the contract default', async (value) => {
    const { mail } = await importWith({ SMTP_FROM: value });
    expect(mail.from).toBe(contractDefault('SMTP_FROM'));
    expect(mail.replyTo).toBe(contractDefault('SMTP_FROM'));
  });

  it('SMTP_FROM set is the From on every email', async () => {
    const { mail } = await importWith({ SMTP_FROM: 'Docs <docs@example.com>' });
    expect(mail.from).toBe('Docs <docs@example.com>');
  });
});

// Same file and same reason as mysql_connect.js: the image has no .env, and
// dotenv 17 logs a line and an advert for every config() call that loads
// nothing, on every boot.
describe('dotenv', () => {
  it('loads the repository root .env without logging', async () => {
    const config = vi.fn();
    vi.doMock('dotenv', () => ({ default: { config } }));
    try {
      vi.resetModules();
      await import('../../services/email.js');
    } finally {
      vi.doUnmock('dotenv');
      vi.resetModules();
    }
    const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    expect(config).toHaveBeenCalledTimes(1);
    expect(config).toHaveBeenCalledWith({ path: path.resolve(appDir, '..', '.env'), quiet: true });
  });
});

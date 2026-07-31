/**
 * Cloud Codex — Tests for server.js startup checks
 *
 * server.js has top-level side effects (env validation, ViteExpress.listen,
 * setInterval / setTimeout for the activity-log prune). We isolate the
 * env-validation logic by re-importing under controlled process.env state
 * with all I/O-ish modules mocked.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const listenMock = vi.fn(() => ({}));
vi.mock('vite-express', () => ({ default: { listen: listenMock } }));
vi.mock('../services/collab.js', () => ({ setupCollabServer: vi.fn() }));
vi.mock('../services/user-channel.js', () => ({ setupUserChannelServer: vi.fn() }));
vi.mock('../routes/admin.js', () => ({ default: {}, ensureAdminUser: vi.fn(), bootstrapInstance: vi.fn() }));
vi.mock('../app.js', () => ({ default: {} }));
vi.mock('../services/email.js', () => ({
  verifyEmailConnection: vi.fn(async () => true),
  initMail: vi.fn(async () => ({ enabled: false, reason: 'SMTP_HOST, SMTP_USER or SMTP_PASS not set' })),
  isMailEnabled: vi.fn(() => false),
  isMailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
}));

let exitSpy;
let errorSpy;

beforeEach(() => {
  vi.resetModules();
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  listenMock.mockClear();
});

afterEach(() => {
  exitSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('server.js — startup env validation', () => {
  it('does not exit when all required env vars are present', async () => {
    const original = { ...process.env };
    process.env.SMTP_HOST = 'localhost';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASS = 'p';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'p';
    process.env.ADMIN_EMAIL = 'a@b.c';
    try {
      await import('../server.js');
      expect(exitSpy).not.toHaveBeenCalled();
      // ViteExpress.listen called with the app and a port number
      expect(listenMock).toHaveBeenCalled();
      const [, port] = listenMock.mock.calls[0];
      expect(port).toBe(3000);
    } finally {
      process.env = original;
    }
  });
});

describe('server.js: mail is optional', () => {
  it('does not exit when SMTP configuration is absent', async () => {
    const original = { ...process.env };
    try {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      process.env.ADMIN_USERNAME = 'admin';
      process.env.ADMIN_PASSWORD = 'pw';
      process.env.ADMIN_EMAIL = 'admin@test.com';

      await import('../server.js');

      expect(exitSpy).not.toHaveBeenCalled();
      expect(listenMock).toHaveBeenCalled();
    } finally {
      process.env = original;
    }
  });

  it('still exits when admin configuration is absent', async () => {
    const original = { ...process.env };
    try {
      delete process.env.ADMIN_USERNAME;

      await import('../server.js');

      expect(exitSpy).toHaveBeenCalledWith(1);
      // Logged a useful message, same coverage the deleted
      // "exits with status 1 when ADMIN_USERNAME is missing" case had.
      const allLogs = errorSpy.mock.calls.flat().join(' ');
      expect(allLogs).toMatch(/ADMIN/i);
    } finally {
      process.env = original;
    }
  });

  // The two tests above only exercise the module-level admin gate: they say
  // nothing about whether initMail() is actually called on the boot path or
  // whether the enabled/disabled branches log the right thing. These do.
  //
  // The boot sequence used to live inside the ViteExpress.listen callback, so
  // these tests pulled `listenMock.mock.calls[0][2]` and awaited it. It now
  // runs as top-level awaits BEFORE listen(), so importing the module is what
  // runs it: any mock return value has to be primed before the import, and the
  // assertions run straight after it. The wiring being proved is unchanged.
  it('invokes initMail() on the boot path and logs the disabled reason when mail is unavailable', async () => {
    const original = { ...process.env };
    try {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      process.env.ADMIN_USERNAME = 'admin';
      process.env.ADMIN_PASSWORD = 'pw';
      process.env.ADMIN_EMAIL = 'admin@test.com';

      const { initMail } = await import('../services/email.js');
      await import('../server.js');

      expect(initMail).toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
      const allLogs = errorSpy.mock.calls.flat().join(' ');
      expect(allLogs).toMatch(/Email disabled/);
      expect(allLogs).toMatch(/SMTP_HOST, SMTP_USER or SMTP_PASS not set/);
    } finally {
      process.env = original;
    }
  });

  it('logs the verified line and does not exit when mail is available', async () => {
    const original = { ...process.env };
    let logSpy;
    try {
      process.env.SMTP_HOST = 'localhost';
      process.env.SMTP_USER = 'u';
      process.env.SMTP_PASS = 'p';
      process.env.ADMIN_USERNAME = 'admin';
      process.env.ADMIN_PASSWORD = 'pw';
      process.env.ADMIN_EMAIL = 'admin@test.com';

      const { initMail } = await import('../services/email.js');
      initMail.mockResolvedValueOnce({ enabled: true, reason: null });
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await import('../server.js');

      expect(initMail).toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
      const allLogs = logSpy.mock.calls.flat().join(' ');
      expect(allLogs).toMatch(/SMTP connection verified/);
      expect(errorSpy.mock.calls.flat().join(' ')).not.toMatch(/Email disabled/);
    } finally {
      if (logSpy) logSpy.mockRestore();
      process.env = original;
    }
  });

  // The two tests above prove initMail() is on the boot path but say
  // nothing about the ensureAdminUser -> bootstrapInstance wiring right
  // below it. `bootstrapInstance: vi.fn()` in the module mock above only
  // stops that line from throwing — on its own it does not prove
  // server.js passes the right value through. This closes that gap by
  // controlling what ensureAdminUser() resolves to and asserting
  // bootstrapInstance receives exactly that id.
  it('calls bootstrapInstance with the id ensureAdminUser resolved', async () => {
    const original = { ...process.env };
    try {
      process.env.SMTP_HOST = 'localhost';
      process.env.SMTP_USER = 'u';
      process.env.SMTP_PASS = 'p';
      process.env.ADMIN_USERNAME = 'admin';
      process.env.ADMIN_PASSWORD = 'pw';
      process.env.ADMIN_EMAIL = 'admin@test.com';

      const { ensureAdminUser, bootstrapInstance } = await import('../routes/admin.js');
      ensureAdminUser.mockResolvedValueOnce(7);

      await import('../server.js');

      expect(bootstrapInstance).toHaveBeenCalledWith(7);
    } finally {
      process.env = original;
    }
  });
});

// The boot sequence no longer hides behind a listen callback, so the ordering
// and the failure handling are both directly observable.
describe('server.js: boot ordering and failure handling', () => {
  const bootEnv = () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'pw';
    process.env.ADMIN_EMAIL = 'admin@test.com';
  };

  it('resolves mail capability and seeds before the port opens', async () => {
    const original = { ...process.env };
    try {
      bootEnv();

      const { initMail } = await import('../services/email.js');
      const { ensureAdminUser, bootstrapInstance } = await import('../routes/admin.js');
      await import('../server.js');

      // listen() must be the last thing to happen: while any of these are in
      // flight the app would otherwise be answering requests with mail
      // reported disabled and no seeded content.
      expect(listenMock).toHaveBeenCalledTimes(1);
      const listenOrder = listenMock.mock.invocationCallOrder[0];
      expect(initMail.mock.invocationCallOrder[0]).toBeLessThan(listenOrder);
      expect(ensureAdminUser.mock.invocationCallOrder[0]).toBeLessThan(listenOrder);
      expect(bootstrapInstance.mock.invocationCallOrder[0]).toBeLessThan(listenOrder);
    } finally {
      process.env = original;
    }
  });

  it('logs and keeps serving when the first-boot seed throws', async () => {
    const original = { ...process.env };
    try {
      bootEnv();

      const { bootstrapInstance } = await import('../routes/admin.js');
      bootstrapInstance.mockRejectedValueOnce(new Error('archive insert failed'));

      await import('../server.js');

      // Usable-but-empty beats a dead process: an unhandled rejection here
      // would take the instance down over a seed that the next restart retries.
      expect(listenMock).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
      const allLogs = errorSpy.mock.calls.flat().map(String).join(' ');
      expect(allLogs).toMatch(/instance bootstrap failed/);
      expect(allLogs).toMatch(/archive insert failed/);
    } finally {
      process.env = original;
    }
  });

  it('logs and keeps serving when the admin sync throws', async () => {
    const original = { ...process.env };
    try {
      bootEnv();

      const { ensureAdminUser, bootstrapInstance } = await import('../routes/admin.js');
      ensureAdminUser.mockRejectedValueOnce(new Error('db unreachable'));

      await import('../server.js');

      expect(listenMock).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
      // No admin id means nothing to seed against; bootstrapInstance's own
      // null guard handles it rather than the seed running with undefined.
      expect(bootstrapInstance).toHaveBeenCalledWith(null);
      const allLogs = errorSpy.mock.calls.flat().map(String).join(' ');
      expect(allLogs).toMatch(/admin user sync failed/);
    } finally {
      process.env = original;
    }
  });

  // initMail() cannot throw today (verifyEmailConnection swallows its own
  // errors and isMailConfigured is a pure boolean check), but its two
  // siblings below it are each try/catch-wrapped so a rejection cannot take
  // the process down. This proves the same guard on initMail(): a rejection
  // must degrade to mail-disabled, not stop the port from opening.
  it('logs and keeps serving when the mail capability check throws', async () => {
    const original = { ...process.env };
    try {
      bootEnv();

      const { initMail } = await import('../services/email.js');
      initMail.mockRejectedValueOnce(new Error('SMTP verify blew up'));

      await import('../server.js');

      expect(listenMock).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
      const allLogs = errorSpy.mock.calls.flat().map(String).join(' ');
      expect(allLogs).toMatch(/mail capability check failed/);
      expect(allLogs).toMatch(/SMTP verify blew up/);
      expect(allLogs).toMatch(/Email disabled/);
    } finally {
      process.env = original;
    }
  });
});

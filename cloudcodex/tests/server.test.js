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

// server.js registers an 'error' handler on the returned server and reads
// `server.listening` and `server.address()` inside listen's callback, so the
// fake has to carry all three. A bare {} throws on `.on` and would fail every
// test in this file for a reason that looks unrelated.
//
// The callback is CAPTURED, never invoked during listen. Production defers it
// (vite-express awaits Vite startup before calling it), and invoking it
// synchronously here would run it before `const server = ...` is assigned,
// producing a TDZ error that says nothing about the code under test.
const serverHandlers = {};
let listenCallback;
const fakeServer = {
  listening: true,
  on: vi.fn((event, handler) => { serverHandlers[event] = handler; }),
  // The real server reports the port it actually bound, which differs from the
  // requested one when PORT is 0. Tests override this to drive that case.
  address: vi.fn(() => ({ port: 4100 })),
};
const listenMock = vi.fn((_app, _port, callback) => {
  listenCallback = callback;
  return fakeServer;
});
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

let logSpy;

beforeEach(() => {
  vi.resetModules();
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  listenMock.mockClear();
  fakeServer.on.mockClear();
  fakeServer.listening = true;
  fakeServer.address.mockReturnValue({ port: 4100 });
  listenCallback = undefined;
  Object.keys(serverHandlers).forEach(k => delete serverHandlers[k]);
});

afterEach(() => {
  exitSpy.mockRestore();
  errorSpy.mockRestore();
  logSpy.mockRestore();
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
      // Explicit, because this assertion became environment-sensitive when
      // PORT started being read: a PORT exported in a developer's or CI's
      // shell would otherwise decide it. (dotenv does not reach this test,
      // its only two importers are mocked in tests/setup.js.)
      delete process.env.PORT;
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

describe('server.js: PORT', () => {
  const withEnv = async (env, assertions) => {
    const original = { ...process.env };
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'pw';
    process.env.ADMIN_EMAIL = 'admin@test.com';
    Object.assign(process.env, env);
    try {
      await import('../server.js');
      await assertions();
    } finally {
      process.env = original;
    }
  };

  it('listens on PORT when it is set', async () => {
    await withEnv({ PORT: '4100' }, () => {
      expect(exitSpy).not.toHaveBeenCalled();
      expect(listenMock.mock.calls[0][1]).toBe(4100);
    });
  });

  it('treats a blank PORT as unset, which is what .env.example ships', async () => {
    await withEnv({ PORT: '   ' }, () => {
      expect(exitSpy).not.toHaveBeenCalled();
      expect(listenMock.mock.calls[0][1]).toBe(3000);
    });
  });

  it('exits rather than silently falling back when PORT is not a number', async () => {
    await withEnv({ PORT: 'notaport' }, () => {
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/Invalid PORT/);
    });
  });

  it('exits when PORT is outside the valid range', async () => {
    await withEnv({ PORT: '70000' }, () => {
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // Express 5 aliases listen's callback onto the socket's 'error' event, so it
  // runs on a FAILED bind too. `server.listening` is what separates the two,
  // and these three pin that: same callback, opposite outcomes.
  it('announces the real port when the bind succeeded', async () => {
    await withEnv({ PORT: '4100' }, () => {
      listenCallback();
      expect(logSpy.mock.calls.flat().join(' ')).toMatch(/running on http:\/\/localhost:4100/);
    });
  });

  it('stays silent when the callback runs but the bind failed', async () => {
    await withEnv({ PORT: '4100' }, () => {
      fakeServer.listening = false;
      listenCallback();
      expect(logSpy.mock.calls.flat().join(' ')).not.toMatch(/running on/);
    });
  });

  it('reports the port actually bound, not the one requested, when PORT is 0', async () => {
    await withEnv({ PORT: '0' }, () => {
      expect(listenMock.mock.calls[0][1]).toBe(0);
      fakeServer.address.mockReturnValue({ port: 45123 });
      listenCallback();
      expect(logSpy.mock.calls.flat().join(' ')).toMatch(/running on http:\/\/localhost:45123/);
    });
  });

  it('reports an in-use port and exits instead of leaving an unhandled error', async () => {
    await withEnv({ PORT: '4100' }, () => {
      expect(fakeServer.on).toHaveBeenCalledWith('error', expect.any(Function));
      const err = new Error('listen EADDRINUSE');
      err.code = 'EADDRINUSE';
      serverHandlers.error(err);
      expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/Port 4100 is already in use/);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  it('reports any other server error and exits', async () => {
    await withEnv({ PORT: '4100' }, () => {
      serverHandlers.error(Object.assign(new Error('boom'), { code: 'EACCES' }));
      expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/HTTP server error/);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
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

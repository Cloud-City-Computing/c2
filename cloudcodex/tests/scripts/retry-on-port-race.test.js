/**
 * Cloud Codex - The integration harness retries a boot that lost its port to another process
 *
 * freePort() releases the port it probed, so a boot can find it taken by the time server.js binds it. That boot
 * fails with server.js's own "Port N is already in use" line, and only that failure is retried, on a fresh port,
 * up to three boots. The integration project needs a live MySQL, so the retry is tested here on its own, in the
 * backend project, with the boot stubbed.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi } from 'vitest';
import { retryOnPortRace } from '../integration/app-process.js';

const taken = (port) => new Error(
  `server.js exited 1 during boot:\n✖ Port ${port} is already in use.\n  Set PORT in .env to a free port.`,
);

describe('retryOnPortRace', () => {
  it('boots again after a port race and resolves with the boot that bound', async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(taken(41047))
      .mockRejectedValueOnce(taken(41048))
      .mockResolvedValueOnce({ port: 41049 });
    await expect(retryOnPortRace(attempt)).resolves.toEqual({ port: 41049 });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('makes at most three boots when every one loses its port, and throws the last failure', async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(taken(41047))
      .mockRejectedValueOnce(taken(41048))
      .mockRejectedValueOnce(taken(41049));
    await expect(retryOnPortRace(attempt)).rejects.toThrow('Port 41049 is already in use');
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('does not retry a boot that failed for another reason', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('server.js exited 1 during boot: missing APP_URL'));
    await expect(retryOnPortRace(attempt)).rejects.toThrow('missing APP_URL');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('does not retry a boot that resolves on the first try', async () => {
    const attempt = vi.fn().mockResolvedValue('ok');
    await expect(retryOnPortRace(attempt)).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

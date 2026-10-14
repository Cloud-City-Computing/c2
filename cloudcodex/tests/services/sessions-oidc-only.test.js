/**
 * The boot purge of sessions a hosted instance no longer accepts (services/sessions-oidc-only.js)
 *
 * Validation already refuses a local or Google session on a hosted instance. The boot also deletes those rows,
 * so the table holds only what the instance will accept, and logs how many it ended. Off a hosted instance it
 * touches nothing.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { endSessionsOutsideOidc } from '../../services/sessions-hosted.js';
import { resetMocks } from '../helpers.js';

const KEYS = ['AUTH_PROVIDERS', 'OIDC_ISSUER_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];

describe('endSessionsOutsideOidc', () => {
  let saved;
  let errorSpy;

  beforeEach(() => {
    resetMocks();
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('deletes every non-OIDC session on a hosted instance, and logs the count', async () => {
    process.env.AUTH_PROVIDERS = 'oidc';
    process.env.OIDC_ISSUER_URL = 'https://id.example.test';
    c2_query.mockResolvedValueOnce({ affectedRows: 3 });

    expect(await endSessionsOutsideOidc()).toBe(3);
    expect(c2_query.mock.calls[0][0]).toMatch(/DELETE FROM sessions WHERE auth_provider <> 'oidc'/);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/OIDC-only boot: ended 3 sessions/);
  });

  it('logs nothing when there was nothing to end', async () => {
    process.env.AUTH_PROVIDERS = 'oidc';
    process.env.OIDC_ISSUER_URL = 'https://id.example.test';
    c2_query.mockResolvedValueOnce({ affectedRows: 0 });
    expect(await endSessionsOutsideOidc()).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('touches nothing on an instance that still offers local sign-in', async () => {
    expect(await endSessionsOutsideOidc()).toBe(0);
    expect(c2_query).not.toHaveBeenCalled();
  });
});

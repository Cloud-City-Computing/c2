import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { verifyMachineCredential } from '../../services/machine-auth.js';
import { resetMocks } from '../helpers.js';

/**
 * A non-admin user row of the shape the users table returns.
 * is_admin comes back from MySQL as 0/1, not a JS boolean.
 */
const SERVICE_ROW = { id: 7, name: 'cloud-command', email: 'svc@example.com', is_admin: 0 };
const ADMIN_ROW = { id: 8, name: 'root', email: 'svc@example.com', is_admin: 1 };

/**
 * Distinct per test on purpose: the module caches the resolved configuration
 * keyed by the raw env pair, so reusing one value across tests would make a
 * "logged the misconfiguration" assertion depend on test order.
 */
function configure(token, email = 'svc@example.com') {
  process.env.SERVICE_TOKEN = token;
  process.env.SERVICE_TOKEN_USER = email;
}

describe('verifyMachineCredential', () => {
  let errorSpy;

  beforeEach(() => {
    resetMocks();
    delete process.env.SERVICE_TOKEN;
    delete process.env.SERVICE_TOKEN_USER;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    delete process.env.SERVICE_TOKEN;
    delete process.env.SERVICE_TOKEN_USER;
  });

  describe('when machine auth is not configured', () => {
    it('returns null with neither variable set', async () => {
      expect(await verifyMachineCredential('a'.repeat(40))).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('returns null with only SERVICE_TOKEN set', async () => {
      process.env.SERVICE_TOKEN = 'unconfigured-user-token-0000000000000';

      expect(await verifyMachineCredential('unconfigured-user-token-0000000000000')).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('returns null with only SERVICE_TOKEN_USER set', async () => {
      process.env.SERVICE_TOKEN_USER = 'svc@example.com';

      expect(await verifyMachineCredential('anything')).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('returns null for a blank SERVICE_TOKEN even when the caller sends a blank token', async () => {
      configure('   ');

      expect(await verifyMachineCredential('   ')).toBeNull();
      expect(await verifyMachineCredential('')).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });
  });

  describe('token comparison', () => {
    it('rejects a token that does not match, without a database lookup', async () => {
      configure('correct-service-token-aaaaaaaaaaaaaaaa');

      expect(await verifyMachineCredential('wrong-service-token-aaaaaaaaaaaaaaaaaa')).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('rejects a token of a different length without throwing', async () => {
      configure('correct-service-token-bbbbbbbbbbbbbbbb');

      await expect(verifyMachineCredential('short')).resolves.toBeNull();
      await expect(verifyMachineCredential('x'.repeat(4096))).resolves.toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('rejects a null or undefined token', async () => {
      configure('correct-service-token-cccccccccccccccc');

      expect(await verifyMachineCredential(null)).toBeNull();
      expect(await verifyMachineCredential(undefined)).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('rejects a token that only differs by surrounding whitespace', async () => {
      configure('correct-service-token-dddddddddddddddd');

      expect(await verifyMachineCredential(' correct-service-token-dddddddddddddddd ')).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });
  });

  describe('minimum token length', () => {
    it('refuses a SERVICE_TOKEN shorter than 32 characters, even when the token matches', async () => {
      const short = 'a'.repeat(31);
      configure(short);

      expect(await verifyMachineCredential(short)).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      const logged = errorSpy.mock.calls.flat().join(' ');
      expect(logged).toMatch(/SERVICE_TOKEN/);
      expect(logged).not.toContain(short);
    });

    it('accepts a SERVICE_TOKEN of exactly 32 characters', async () => {
      const exact = 'b'.repeat(32);
      configure(exact);
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);

      const principal = await verifyMachineCredential(exact);

      expect(principal).not.toBeNull();
      expect(principal.id).toBe(7);
    });
  });

  describe('principal resolution', () => {
    it('returns a principal whose is_admin is false', async () => {
      const token = 'valid-service-token-eeeeeeeeeeeeeeeeee';
      configure(token);
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);

      const principal = await verifyMachineCredential(token);

      expect(principal).toEqual({
        id: 7,
        name: 'cloud-command',
        email: 'svc@example.com',
        is_admin: false,
        is_machine: true,
      });
      expect(principal.is_admin).toBe(false);
    });

    it('looks the user up by email with a parameterized query', async () => {
      const token = 'valid-service-token-ffffffffffffffffff';
      configure(token, '  Svc@Example.com  ');
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);

      await verifyMachineCredential(token);

      const [sql, params] = c2_query.mock.calls[0];
      expect(sql).toMatch(/WHERE email = \?/);
      expect(sql).not.toMatch(/Svc@Example\.com/);
      expect(params).toEqual(['Svc@Example.com']);
    });

    it('refuses a configured user that is an admin', async () => {
      const token = 'valid-service-token-gggggggggggggggggg';
      configure(token);
      c2_query.mockResolvedValueOnce([ADMIN_ROW]);

      expect(await verifyMachineCredential(token)).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      const logged = errorSpy.mock.calls.flat().join(' ');
      expect(logged).toMatch(/admin/i);
      expect(logged).not.toContain(token);
    });

    it('refuses a configured user that is an admin by boolean true', async () => {
      const token = 'valid-service-token-hhhhhhhhhhhhhhhhhh';
      configure(token);
      c2_query.mockResolvedValueOnce([{ ...SERVICE_ROW, is_admin: true }]);

      expect(await verifyMachineCredential(token)).toBeNull();
    });

    it('returns null and says so when the configured user does not exist', async () => {
      const token = 'valid-service-token-iiiiiiiiiiiiiiiiii';
      configure(token, 'typo@exmaple.com');
      c2_query.mockResolvedValueOnce([]);

      expect(await verifyMachineCredential(token)).toBeNull();
      // Silence here reads to an operator exactly like a wrong secret.
      expect(errorSpy).toHaveBeenCalled();
      const logged = errorSpy.mock.calls.flat().join(' ');
      expect(logged).toMatch(/typo@exmaple\.com/);
      expect(logged).not.toContain(token);
    });

    it('forces is_admin false rather than copying the column', async () => {
      const token = 'valid-service-token-jjjjjjjjjjjjjjjjjj';
      configure(token);
      c2_query.mockResolvedValueOnce([{ ...SERVICE_ROW, is_admin: null }]);

      const principal = await verifyMachineCredential(token);

      expect(principal.is_admin).toBe(false);
      expect(principal.is_admin).not.toBeNull();
    });
  });
});

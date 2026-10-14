/**
 * Pins the boot warning for removed environment variables to the configuration contract
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ENV_CONTRACT } from '../../env-contract.js';
import { warnRemovedVariables, removedVariablesSet, REMOVED_NAMES, logLinkedIdentities } from '../../services/removed-env.js';

const REMOVED = ENV_CONTRACT.filter((e) => e.kind === 'removed');

describe('services/removed-env.js', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    for (const e of REMOVED) delete process.env[e.name];
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads exactly the variables the contract marks removed, so neither list can drift', () => {
    expect([...REMOVED_NAMES].sort()).toEqual(REMOVED.map((e) => e.name).sort());
  });

  it('reports nothing when no removed variable is set', () => {
    const log = vi.fn();
    expect(removedVariablesSet()).toEqual([]);
    warnRemovedVariables(log);
    expect(log).not.toHaveBeenCalled();
  });

  it('treats a blank removed variable as unset', () => {
    process.env[REMOVED[0].name] = '   ';
    expect(removedVariablesSet()).toEqual([]);
  });

  it('prints one timestamped line per set variable, naming it, the word removed and its why', () => {
    const why = (name) => ENV_CONTRACT.find((e) => e.name === name).why;
    process.env.SUITE_COMMAND_WORKSPACE_URL = 'https://example.test/w/1';
    process.env.SUITE_NAME = 'Example';
    const log = vi.fn();
    warnRemovedVariables(log);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\] SUITE_COMMAND_WORKSPACE_URL is set but was removed: /);
    expect(log.mock.calls[0][0].endsWith(`: ${why('SUITE_COMMAND_WORKSPACE_URL')}`)).toBe(true);
    expect(log.mock.calls[1][0]).toContain(`SUITE_NAME is set but was removed: ${why('SUITE_NAME')}`);
  });

  it('tells the operator that linked accounts now accept a local password and local two-factor, and how to keep them provider-only', () => {
    const why = ENV_CONTRACT.find((e) => e.name === 'SUITE_COMMAND_WORKSPACE_URL').why;
    expect(why).toMatch(/local password and local two-factor/);
    expect(why).toMatch(/AUTH_PROVIDERS=oidc/);
  });

  describe('logLinkedIdentities', () => {
    it('counts the linked identities and logs the count when the suite variable is set', async () => {
      process.env.SUITE_COMMAND_WORKSPACE_URL = 'https://example.test/w/1';
      const query = vi.fn(async () => [{ n: 3 }]);
      const log = vi.fn();
      expect(await logLinkedIdentities(query, log)).toBe(3);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('user_identities'));
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/3 account\(s\) linked to an identity provider .*AUTH_PROVIDERS=oidc/));
    });

    it('does not query when the suite variable is unset', async () => {
      const query = vi.fn();
      expect(await logLinkedIdentities(query, vi.fn())).toBeNull();
      expect(query).not.toHaveBeenCalled();
    });

    it('logs a failed count and does not throw', async () => {
      process.env.SUITE_COMMAND_WORKSPACE_URL = 'https://example.test/w/1';
      const log = vi.fn();
      expect(await logLinkedIdentities(async () => { throw new Error('no table'); }, log)).toBeNull();
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/could not count .*no table/));
    });
  });
});

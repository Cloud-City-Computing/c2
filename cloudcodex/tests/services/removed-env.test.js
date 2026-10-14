/**
 * Pins the boot warning for removed environment variables to the configuration contract
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ENV_CONTRACT } from '../../env-contract.js';
import { warnRemovedVariables, removedVariablesSet, REMOVED_NAMES } from '../../services/removed-env.js';

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
    const [first, second] = REMOVED;
    process.env[first.name] = 'https://example.test/w/1';
    process.env[second.name] = 'Example';
    const log = vi.fn();
    warnRemovedVariables(log);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toMatch(new RegExp(`^\\[\\d{4}-\\d{2}-\\d{2}T[^\\]]+\\] ${first.name} is set but was removed: ${first.why.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    expect(log.mock.calls[1][0]).toContain(`${second.name} is set but was removed`);
  });
});

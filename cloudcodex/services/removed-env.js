/**
 * Boot warning for environment variables the server no longer reads
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { ENV_CONTRACT } from '../env-contract.js';

// Each removed variable is read here by its literal name: the configuration-contract scan
// (tests/env-contract.test.js) refuses a computed key. tests/services/removed-env.test.js pins this
// list to the contract's `removed` entries, so adding one to either side alone fails the suite.
const REMOVED_READS = [
  ['SUITE_COMMAND_WORKSPACE_URL', () => process.env.SUITE_COMMAND_WORKSPACE_URL],
  ['SUITE_NAME', () => process.env.SUITE_NAME],
  ['SUITE_PREFERENCE_DOMAIN', () => process.env.SUITE_PREFERENCE_DOMAIN],
  ['OIDC_ACCOUNT_URL', () => process.env.OIDC_ACCOUNT_URL],
];

export const REMOVED_NAMES = REMOVED_READS.map(([name]) => name);

/** The removed variables that are set to a non-blank value, in the order the list names them. */
export function removedVariablesSet() {
  return REMOVED_READS
    .filter(([, read]) => {
      const value = read();
      return typeof value === 'string' && value.trim() !== '';
    })
    .map(([name]) => name);
}

/**
 * Prints one line per set removed variable, naming it and the contract's `why` (what to do instead).
 * Never throws and never exits: a removed variable must not stop an instance from starting.
 */
export function warnRemovedVariables(log = console.error) {
  for (const name of removedVariablesSet()) {
    const entry = ENV_CONTRACT.find((e) => e.name === name);
    log(`[${new Date().toISOString()}] ${name} is set but was removed: ${entry.why}`);
  }
}

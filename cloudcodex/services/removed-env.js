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
  ['SERVICE_TOKEN', () => process.env.SERVICE_TOKEN],
  ['SERVICE_TOKEN_USER', () => process.env.SERVICE_TOKEN_USER],
  ['MACHINE_OIDC_AUDIENCE', () => process.env.MACHINE_OIDC_AUDIENCE],
  ['MACHINE_OIDC_SUBJECTS', () => process.env.MACHINE_OIDC_SUBJECTS],
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
 * Logs how many accounts are linked to an identity provider, while the suite variable is still set. Those
 * accounts accept a local password and local two-factor after the upgrade unless AUTH_PROVIDERS=oidc is set.
 * `query` is c2_query, passed in so this module stays free of the database. Never throws: a failed count is
 * logged and the boot goes on.
 * @returns {Promise<number | null>} the count, or null when it was not read
 */
export async function logLinkedIdentities(query, log = console.error) {
  if (!removedVariablesSet().includes('SUITE_COMMAND_WORKSPACE_URL')) return null;
  try {
    const [row] = await query('SELECT COUNT(*) AS n FROM user_identities');
    const count = Number(row?.n);
    if (!Number.isFinite(count)) throw new Error('no count was returned');
    log(`[${new Date().toISOString()}] ${count} account(s) linked to an identity provider accept a local password `
      + 'and local two-factor now that suite mode is removed. Set AUTH_PROVIDERS=oidc to keep their sign-in provider-only.');
    return count;
  } catch (err) {
    log(`[${new Date().toISOString()}] could not count the accounts linked to an identity provider: ${err.message}`);
    return null;
  }
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

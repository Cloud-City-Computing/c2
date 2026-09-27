/**
 * The value env-contract.js says an unset variable behaves as
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { ENV_CONTRACT } from '../env-contract.js';

// The test that proves a variable's default reads the expected value through
// this, so the contract and the code cannot drift apart unnoticed.
// tests/env-contract.test.js checks that every `kind: 'default'` entry has
// such a test, by finding `contractDefault('<NAME>')` in the file it names.
export function contractDefault(name) {
  const entry = ENV_CONTRACT.find((e) => e.name === name);
  if (!entry || entry.kind !== 'default') {
    throw new Error(`env-contract.js has no default entry for ${name}`);
  }
  return entry.default;
}

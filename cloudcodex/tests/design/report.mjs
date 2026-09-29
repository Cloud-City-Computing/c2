/**
 * Prints the live token-discipline buckets, one per line, optionally for one file
 *
 * Usage, from cloudcodex/: node tests/design/report.mjs [file]
 * Every burndown PR runs it before and after, and lowers tests/design/ledger.json
 * by exactly what it burned.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { liveBuckets, total } from './buckets.js';

const only = process.argv[2];
const buckets = liveBuckets();
for (const [file, sections] of Object.entries(buckets)) {
  if (only && file !== only) continue;
  for (const [section, count] of Object.entries(sections)) {
    process.stdout.write(`${String(count).padStart(4)}  ${file} :: ${section}\n`);
  }
}
process.stdout.write(`${String(total(buckets)).padStart(4)}  total\n`);

/**
 * Cloud Codex - Tests for the repository-root scripts/backup-common.sh that the backup and restore scripts share
 *
 * The restore refuses while anything holds the instance lock and holds it
 * itself while it loads, so its copy of the lock's name has to be the app's.
 * The Bash file cannot import the JavaScript, so this pins the two equal; the
 * behaviour is proved against a live MySQL by
 * tests/integration/backup-restore.test.js.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTANCE_LOCK_NAME_SQL } from '../../services/instance-lock.js';

const COMMON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'backup-common.sh');

/** The value of a `readonly NAME="..."` line in the Bash file. */
function bashConstant(name) {
  const match = new RegExp(`^readonly ${name}="([^"]*)"$`, 'm').exec(readFileSync(COMMON, 'utf8'));
  return match?.[1];
}

describe('scripts/backup-common.sh', () => {
  it('names the instance lock exactly as services/instance-lock.js does', () => {
    expect(bashConstant('INSTANCE_LOCK_NAME_SQL')).toBe(INSTANCE_LOCK_NAME_SQL);
  });
});

/**
 * A child process for lifecycle.test.js: take the instance lock, then hold it
 *
 * Forked with DB_* pointing at a schema. On success it prints `held <connection
 * id>` and stays alive until it is killed; on refusal it prints the lock's
 * message on stderr and exits 1, the way server.js does.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { acquireInstanceLock } from '../../services/instance-lock.js';
import { openConnection } from '../../mysql_connect.js';

try {
  const lock = await acquireInstanceLock({ connect: openConnection, log: (line) => console.error(line) });
  process.stdout.write(`held ${lock.connectionId}\n`);
  setInterval(() => {}, 60_000);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

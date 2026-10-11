/**
 * The boot purge of sessions a hosted instance no longer accepts
 *
 * On a hosted instance (no local sign-in) validateAndAutoLogin already refuses a local or Google session, so
 * the switch ends them. The boot also deletes those rows, so the table holds only what the instance will
 * accept, and logs how many it ended. Off a hosted instance it changes nothing.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { c2_query } from '../mysql_connect.js';
import { localSignInEnabled } from './auth-providers.js';

/**
 * @returns {Promise<number>} how many sessions were deleted
 */
export async function endSessionsOutsideOidc() {
  if (localSignInEnabled()) return 0;
  const result = await c2_query(`DELETE FROM sessions WHERE auth_provider <> 'oidc'`, []);
  const ended = Number(result?.affectedRows ?? 0);
  if (ended > 0) {
    console.error(
      `[${new Date().toISOString()}] hosted boot: ended ${ended} sessions that are not OIDC sessions; ` +
      'those users sign in through OIDC.'
    );
  }
  return ended;
}

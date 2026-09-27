/**
 * The lookup-then-INSERT interleaves on Google's link-by-email rung, shared by the files that run them
 *
 * resolveGoogleIdentity decides at its email lookup, then writes the link
 * with an INSERT that copies the user row FOR SHARE, only while two-factor is
 * still off and the row still holds the looked-up email. These interleaves
 * change the row between the two: a transaction runs the change and holds the
 * row, the seam's plain reads go past it, its INSERT (the only statement in
 * the ladder that locks the row) waits, and after the commit it must insert
 * nothing. oauth-google-two-factor.test.js runs them at the server's default
 * isolation and oauth-google-two-factor-read-committed.test.js under READ
 * COMMITTED, where only the FOR SHARE makes the INSERT wait and see the
 * change. Not a test file itself: the integration project collects only files
 * ending in .test.js.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { resolveIdentity } from '../../services/identity.js';
import { holdInTransaction } from './mysql-admin.js';

/** The policy routes/oauth.js builds when GOOGLE_OAUTH_DOMAIN is unset. */
export const OPEN_POLICY = { requiredHostedDomain: undefined, linkByVerifiedEmail: true, autoCreate: false };

export const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

/**
 * A user with `method` as two_factor_method. Tests share their file's
 * schema, so every caller passes its own name.
 * @param { String } name
 * @param { 'none'|'email'|'totp'|null } method
 * @returns { Promise<{ id: Number, email: String }> }
 */
export async function createUser(name, method) {
  const email = `${name}@example.com`;
  const created = await c2_query(
    'INSERT INTO users (name, email, two_factor_method, totp_secret) VALUES (?, ?, ?, ?)',
    [name, email, method, method === 'totp' ? TOTP_SECRET : null]
  );
  return { id: created.insertId, email };
}

/** Tables rowsFor may count, so its interpolated name is never a caller's string. */
const COUNTED_TABLES = new Set(['oauth_accounts', 'sessions', 'password_reset_tokens', 'two_factor_codes']);

/** How many rows `table` holds for `userId`, through the app's own pool. */
export async function rowsFor(table, userId) {
  if (!COUNTED_TABLES.has(table)) throw new Error(`rowsFor: ${table} is not a table it counts`);
  const [{ n }] = await c2_query(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [userId]);
  return Number(n);
}

/** A Google sign-in for `user` through the seam, settled rather than thrown. */
function linkAttempt(user, subject) {
  return resolveIdentity(
    { provider: 'google', subject, email: user.email, emailVerified: true },
    OPEN_POLICY
  ).then(
    value => value,
    err => ({ threw: err.code ?? err.message })
  );
}

/**
 * Run `sql`, a change to the user row, in a transaction left open (the way
 * POST /api/2fa/enable, /api/2fa/totp/confirm and /api/update-account write the
 * row, each in its own transaction), start a link for `user`, wait until the
 * link's INSERT is waiting on the row, then commit, and return the answer. A
 * plain SELECT of the row still reads the committed value without waiting;
 * anything that locks it waits.
 * Reaching the lock wait is the proof the lookups already ran and matched:
 * a lookup that refuses returns without locking anything, so the wait would
 * never come and this throws after ten seconds instead.
 */
async function linkAcross(user, subject, sql, params) {
  const hold = await holdInTransaction(sql, params);
  const attempt = linkAttempt(user, subject);
  try {
    await hold.waitForLockWaits(1);
  } finally {
    await hold.release();
  }
  return attempt;
}

/**
 * Define the interleave tests. `label` names the isolation they run under;
 * the calling file is what sets it.
 * @param { String } label
 */
export function describeLinkRaces(label) {
  describe(`a change to the user row between the lookup and the link INSERT (${label})`, () => {
    it.each([
      ['totp', `UPDATE users SET two_factor_method = 'totp', totp_secret = ? WHERE id = ?`, true],
      ['email', `UPDATE users SET two_factor_method = 'email', totp_secret = NULL WHERE id = ?`, false],
    ])('refuses as two_factor_enabled and writes no row when %s two-factor comes on first', async (method, sql, withSecret) => {
      const user = await createUser(`race_${method}`, 'none');

      const answer = await linkAcross(user, `sub-race-${method}`, sql, withSecret ? [TOTP_SECRET, user.id] : [user.id]);

      expect(answer).toEqual({ ok: false, reason: 'two_factor_enabled' });
      expect(await rowsFor('oauth_accounts', user.id)).toBe(0);
      const [row] = await c2_query('SELECT two_factor_method FROM users WHERE id = ?', [user.id]);
      expect(row.two_factor_method).toBe(method);
    });

    // POST /api/update-account (and /update-account/confirm-email) changes an
    // address with an UPDATE inside a transaction. The link must not land on an
    // account that no longer holds the email Google verified; the answer is
    // the same refusal, and the next sign-in looks the address up afresh.
    it('refuses and writes no row when the account gives up the email first', async () => {
      const user = await createUser('race_moved', 'none');

      const answer = await linkAcross(user, 'sub-race-moved', 'UPDATE users SET email = ? WHERE id = ?', [
        'race_moved_elsewhere@example.com',
        user.id,
      ]);

      expect(answer).toEqual({ ok: false, reason: 'two_factor_enabled' });
      expect(await rowsFor('oauth_accounts', user.id)).toBe(0);
    });

    // The anchor: the same hold, wait and release, with a change that leaves
    // two-factor off and the email alone, links. So the refusals above come
    // from what the INSERT reads at insert time, not from the interleave.
    it('links after the same wait when the held change leaves two-factor off and the email alone', async () => {
      const user = await createUser('race_off', 'none');

      const answer = await linkAcross(user, 'sub-race-off', 'UPDATE users SET onboarded_at = NOW() WHERE id = ?', [
        user.id,
      ]);

      expect(answer).toEqual({ ok: true, userId: user.id, created: false });
      expect(await rowsFor('oauth_accounts', user.id)).toBe(1);
    });
  });
}

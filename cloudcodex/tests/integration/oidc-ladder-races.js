/**
 * The OIDC ladder's lookup-then-INSERT interleaves, shared by the files that run them
 *
 * The oidc link-by-email rung reads the user row, then links it with an INSERT that copies the row FOR
 * SHARE, only while two-factor is still off and the row still holds the matched email. These interleaves
 * change the row between the two, as google-link-races.js does for Google: a transaction runs the change
 * and holds the row, the attempt's plain reads go past it, its INSERT waits, and after the commit it must
 * write nothing. oidc-ladder.test.js runs them at the server's default isolation and
 * oidc-ladder-read-committed.test.js under READ COMMITTED. Not a test file itself.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { resolveIdentity } from '../../services/identity.js';
import { holdInTransaction } from './mysql-admin.js';
import { createUser, TOTP_SECRET } from './google-link-races.js';

const ISSUER = 'https://id.race.test';
const POLICY = { linkByVerifiedEmail: true, autoCreate: false };

/** How many user_identities rows `userId` holds. */
export async function identityRowsFor(userId) {
  const [{ n }] = await c2_query('SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?', [userId]);
  return Number(n);
}

/** An OIDC sign-in for `user` at `subject`, settled rather than thrown. */
function attempt(user, subject) {
  return resolveIdentity(
    { provider: 'oidc', issuer: ISSUER, subject, email: user.email, emailVerified: true, name: null },
    POLICY
  ).then(
    value => value,
    err => ({ threw: err.code ?? err.message })
  );
}

/** Hold a change to the user row, start the attempt, wait for its INSERT to block, then commit. */
async function linkAcross(user, subject, sql, params) {
  const hold = await holdInTransaction(sql, params);
  const pending = attempt(user, subject);
  try {
    await hold.waitForLockWaits(1);
  } finally {
    await hold.release();
  }
  return pending;
}

/**
 * @param {String} label - the isolation these run under; the calling file sets it
 */
export function describeOidcLadderRaces(label) {
  describe(`an OIDC link across a change to the user row (${label})`, () => {
    it.each([
      ['totp', `UPDATE users SET two_factor_method = 'totp', totp_secret = ? WHERE id = ?`, true],
      ['email', `UPDATE users SET two_factor_method = 'email', totp_secret = NULL WHERE id = ?`, false],
    ])('refuses two_factor_enabled and writes no identity when %s two-factor comes on first', async (method, sql, withSecret) => {
      const user = await createUser(`oidc_r_${method}`, 'none');

      const answer = await linkAcross(user, `sub-race-${method}`, sql, withSecret ? [TOTP_SECRET, user.id] : [user.id]);

      expect(answer).toEqual({ ok: false, reason: 'two_factor_enabled' });
      expect(await identityRowsFor(user.id)).toBe(0);
    });

    it('refuses and writes no identity when the account gives up the email first', async () => {
      const user = await createUser('oidc_r_moved', 'none');

      const answer = await linkAcross(user, 'sub-race-moved', 'UPDATE users SET email = ? WHERE id = ?', [
        'oidc_r_moved_elsewhere@example.com',
        user.id,
      ]);

      expect(answer).toEqual({ ok: false, reason: 'two_factor_enabled' });
      expect(await identityRowsFor(user.id)).toBe(0);
    });

    // The anchor: the same hold, wait and release, with a change that leaves two-factor off and the email
    // alone, links. The refusals above come from what the INSERT reads at insert time, not the interleave.
    it('links after the same wait when the held change leaves two-factor off and the email alone', async () => {
      const user = await createUser('oidc_r_off', 'none');

      const answer = await linkAcross(user, 'sub-race-off', 'UPDATE users SET onboarded_at = NOW() WHERE id = ?', [
        user.id,
      ]);

      expect(answer).toEqual({ ok: true, userId: user.id, created: false, identityId: expect.any(Number) });
      expect(await identityRowsFor(user.id)).toBe(1);
    });
  });

  describe(`the unique key under a race (${label})`, () => {
    it('lets exactly one of two concurrent links of one user at one issuer through; the other is identity_conflict', async () => {
      const user = await createUser('oidc_r_pair', 'none');

      const answers = await Promise.all([attempt(user, 'sub-pair-a'), attempt(user, 'sub-pair-b')]);

      const won = answers.filter(answer => answer.ok === true);
      const lost = answers.filter(answer => answer.ok !== true);
      expect(won).toHaveLength(1);
      expect(lost).toEqual([{ ok: false, reason: 'identity_conflict' }]);
      expect(await identityRowsFor(user.id)).toBe(1);
    });
  });
}

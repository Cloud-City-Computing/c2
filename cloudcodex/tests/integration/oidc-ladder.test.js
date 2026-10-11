/**
 * The OIDC identity ladder against a live MySQL server, at the server's default isolation
 *
 * The end-to-end path a sign-in takes through resolveIdentity, on real rows: a first sign-in links an
 * account by its verified email, the next one is found by (issuer, subject), an issuer-side email change
 * is followed, a conflicting email is refused with nothing written, and a linked identity whose user has
 * two-factor on still signs in. The interleaves and the unique-key race are in oidc-ladder-races.js.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { c2_query, generateSessionToken, getSessionProvenance, validateAndAutoLogin } from '../../mysql_connect.js';
import { resolveIdentity } from '../../services/identity.js';
import { createUser } from './google-link-races.js';
import { describeOidcLadderRaces, identityRowsFor } from './oidc-ladder-races.js';

const ISSUER = 'https://id.ladder.test';
const POLICY = { linkByVerifiedEmail: true, autoCreate: false };

function claims(subject, email, overrides = {}) {
  return { provider: 'oidc', issuer: ISSUER, subject, email, emailVerified: true, name: null, ...overrides };
}

describe('the OIDC ladder, end to end on real rows', () => {
  it('links a first sign-in by verified email, then finds the same person by (issuer, subject)', async () => {
    const user = await createUser('oidc_l_first', 'none');

    const first = await resolveIdentity(claims('sub-first', user.email), POLICY);
    expect(first).toEqual({ ok: true, userId: user.id, created: false, identityId: expect.any(Number) });

    const again = await resolveIdentity(claims('sub-first', user.email), POLICY);
    expect(again).toEqual({ ok: true, userId: user.id, created: false, identityId: first.identityId });
    expect(await identityRowsFor(user.id)).toBe(1);
    const [row] = await c2_query('SELECT last_login_at FROM user_identities WHERE id = ?', [first.identityId]);
    expect(row.last_login_at).not.toBeNull();
  });

  it('follows an issuer-side email change, and writes the new address to the user row', async () => {
    const user = await createUser('oidc_l_follow', 'none');
    await resolveIdentity(claims('sub-follow', user.email), POLICY);

    const moved = `oidc_l_follow_new@example.com`;
    const answer = await resolveIdentity(claims('sub-follow', moved), POLICY);

    expect(answer).toMatchObject({ ok: true, userId: user.id });
    const [row] = await c2_query('SELECT email FROM users WHERE id = ?', [user.id]);
    expect(row.email).toBe(moved);
  });

  it('refuses an issuer-side email another account holds, and changes nothing', async () => {
    const user = await createUser('oidc_l_clash', 'none');
    const other = await createUser('oidc_l_clash_other', 'none');
    await resolveIdentity(claims('sub-clash', user.email), POLICY);

    const answer = await resolveIdentity(claims('sub-clash', other.email), POLICY);

    expect(answer).toEqual({ ok: false, reason: 'email_conflict' });
    const [row] = await c2_query('SELECT email FROM users WHERE id = ?', [user.id]);
    expect(row.email).toBe(user.email);
  });

  it('signs in a linked identity whose user turned two-factor on afterwards, with no refusal', async () => {
    const user = await createUser('oidc_l_linked2fa', 'none');
    const linked = await resolveIdentity(claims('sub-linked-2fa', user.email), POLICY);
    expect(linked.ok).toBe(true);

    await c2_query("UPDATE users SET two_factor_method = 'email' WHERE id = ?", [user.id]);

    expect(await resolveIdentity(claims('sub-linked-2fa', user.email), POLICY)).toEqual({
      ok: true,
      userId: user.id,
      created: false,
      identityId: linked.identityId,
    });
  });

  it('mints an OIDC session that carries its identity, sid and expiry, and a rotation keeps all three', async () => {
    const user = await createUser('oidc_l_session', 'none');
    const linked = await resolveIdentity(claims('sub-session', user.email), POLICY);

    const token = await generateSessionToken({ id: user.id }, null, null, {
      provider: 'oidc',
      identityId: linked.identityId,
      providerSid: 'zitadel-session-live',
      ttlHours: 8,
    });
    const minted = await getSessionProvenance(token);
    expect(minted).toMatchObject({ provider: 'oidc', identityId: linked.identityId, providerSid: 'zitadel-session-live' });
    const eightHours = Date.now() + 8 * 60 * 60 * 1000;
    expect(Math.abs(minted.expiresAt.getTime() - eightHours)).toBeLessThan(120_000);
    expect(await validateAndAutoLogin(token)).toMatchObject({ id: user.id });

    // The rotation the update-account route performs: the replacement keeps the caller's absolute expiry.
    const rotated = await generateSessionToken({ id: user.id }, null, null, {
      provider: minted.provider,
      identityId: minted.identityId,
      providerSid: minted.providerSid,
      expiresAt: minted.expiresAt,
    });
    expect(await getSessionProvenance(rotated)).toEqual(minted);
  });

  it('refuses no_account for a person the instance has no account for, and creates none', async () => {
    const answer = await resolveIdentity(claims('sub-nobody', 'nobody-oidc-ladder@example.com'), POLICY);
    expect(answer).toEqual({ ok: false, reason: 'no_account' });
    const [row] = await c2_query('SELECT COUNT(*) AS n FROM users WHERE email = ?', ['nobody-oidc-ladder@example.com']);
    expect(Number(row.n)).toBe(0);
  });
});

describeOidcLadderRaces("the server's default isolation");

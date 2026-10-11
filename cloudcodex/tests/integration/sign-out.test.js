/**
 * Sign-out against a live MySQL server: the sealed ID token column and the back-channel deletes (W6-CDX-6)
 *
 * The unit tests cannot see what MySQL does with the bound on created_at, with the oidc pin on a
 * sid, or with the case-sensitive (issuer, subject) join. This file runs the real revocation SQL
 * against real rows, and pins that the sealed-token CHECK is enforced by the schema, not only by code.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { c2_query, generateSessionToken, getSessionOidcIdToken, validateAndAutoLogin } from '../../mysql_connect.js';
import { hashSessionToken } from '../../services/session-token.js';
import { revokeForLogoutToken } from '../../services/backchannel-logout.js';

const ISSUER = 'https://id.example.test';

let seq = 0;

/** A fresh user with one identity at ISSUER; returns { userId, identityId }. */
async function newPerson(subject) {
  seq += 1;
  const name = `signout${seq}_${Date.now() % 100000}`;
  const user = await c2_query('INSERT INTO users (name, email) VALUES (?, ?)', [name, `${name}@example.com`]);
  const identity = await c2_query(
    'INSERT INTO user_identities (user_id, issuer, subject, email_at_link) VALUES (?, ?, ?, ?)',
    [user.insertId, ISSUER, subject, `${name}@example.com`]
  );
  return { userId: user.insertId, identityId: identity.insertId };
}

/** An oidc session for a person, with its sid and an explicit created_at (unix seconds). */
async function oidcSession({ userId, identityId }, { sid, createdAt, sealed = null }) {
  const token = await generateSessionToken({ id: userId }, null, null, {
    provider: 'oidc',
    identityId,
    providerSid: sid,
    ttlHours: 24,
    ...(sealed === null ? {} : { oidcIdToken: sealed }),
  });
  await c2_query('UPDATE sessions SET created_at = FROM_UNIXTIME(?) WHERE id = ?', [createdAt, hashSessionToken(token)]);
  return { token, digest: hashSessionToken(token) };
}

async function exists(digest) {
  const rows = await c2_query('SELECT id FROM sessions WHERE id = ?', [digest]);
  return rows.length === 1;
}

/** A logout token's verified claims, as verifyLogoutToken returns them. */
function claims({ sid = null, sub = null, iat }) {
  return { iss: ISSUER, sid, sub, jti: `jti-${seq}-${Math.random()}`, iat };
}

const NOW = () => Math.floor(Date.now() / 1000);

describe('sessions.oidc_id_token, on a real server (W6-CDX-6)', () => {
  it('stores the sealed token on an oidc session and reads it back by the digest', async () => {
    const person = await newPerson('sealed-subject-1');
    const { token } = await oidcSession(person, { sid: 'sid-sealed-1', createdAt: NOW(), sealed: 'iv:tag:ct' });

    expect(await getSessionOidcIdToken(token)).toBe('iv:tag:ct');
  });

  it('refuses a sealed token on a local session, in the schema itself', async () => {
    seq += 1;
    const name = `localseal${seq}_${Date.now() % 100000}`;
    const user = await c2_query('INSERT INTO users (name, email) VALUES (?, ?)', [name, `${name}@example.com`]);
    await expect(
      c2_query(
        'INSERT INTO sessions (user_id, id, auth_provider, expires_at, oidc_id_token) VALUES (?, ?, ?, NOW() + INTERVAL 1 DAY, ?)',
        [user.insertId, hashSessionToken(`local-${name}`), 'local', 'iv:tag:ct']
      )
    ).rejects.toThrow(/chk_sessions_id_token_oidc_only|check constraint/i);
  });
});

describe('back-channel deletes, on a real server (W6-CDX-6)', () => {
  it('ends the oidc session with the named sid, and nothing else', async () => {
    const person = await newPerson('subject-sid-1');
    const iat = NOW() - 30;
    const target = await oidcSession(person, { sid: 'sid-target', createdAt: iat - 3600 });
    const other = await oidcSession(person, { sid: 'sid-other', createdAt: iat - 3600 });

    const deleted = await revokeForLogoutToken(claims({ sid: 'sid-target', sub: 'subject-sid-1', iat }));

    expect(deleted).toEqual([target.digest]);
    expect(await exists(target.digest)).toBe(false);
    expect(await exists(other.digest)).toBe(true);
  });

  it('ends every oidc session of the (issuer, subject) identity when the token names no sid', async () => {
    const iat = NOW() - 30;
    const ada = await newPerson('subject-ada');
    const grace = await newPerson('subject-grace');
    const adaLaptop = await oidcSession(ada, { sid: 'sid-a1', createdAt: iat - 600 });
    const adaPhone = await oidcSession(ada, { sid: 'sid-a2', createdAt: iat - 600 });
    const graceSession = await oidcSession(grace, { sid: 'sid-g1', createdAt: iat - 600 });

    const deleted = await revokeForLogoutToken(claims({ sub: 'subject-ada', iat }));

    expect(deleted.sort()).toEqual([adaLaptop.digest, adaPhone.digest].sort());
    expect(await exists(graceSession.digest)).toBe(true);
  });

  it('matches the subject case-sensitively, as utf8mb4_bin does: "Ada" is not "ada"', async () => {
    const iat = NOW() - 30;
    const person = await newPerson('Case-Subject');
    const session = await oidcSession(person, { sid: 'sid-case', createdAt: iat - 600 });

    const deleted = await revokeForLogoutToken(claims({ sub: 'case-subject', iat }));

    expect(deleted).toEqual([]);
    expect(await exists(session.digest)).toBe(true);
  });

  it('never ends a session created after the logout, even when the same token is redelivered', async () => {
    const iat = NOW() - 300;
    const person = await newPerson('subject-replay');
    const before = await oidcSession(person, { sid: 'sid-replay', createdAt: iat - 60 });
    const after = await oidcSession(person, { sid: 'sid-replay', createdAt: iat + 120 });
    const token = claims({ sid: 'sid-replay', sub: 'subject-replay', iat });

    expect(await revokeForLogoutToken(token)).toEqual([before.digest]);
    // A redelivery, with the jti filter empty (a restart), can end only what the bound allows.
    expect(await revokeForLogoutToken(token)).toEqual([]);
    expect(await exists(after.digest)).toBe(true);
  });

  it('leaves a local session alone, even one whose user shares the subject', async () => {
    const iat = NOW() - 30;
    const person = await newPerson('subject-local-neighbour');
    const local = await generateSessionToken({ id: person.userId }, null, null, { provider: 'local' });

    const deleted = await revokeForLogoutToken(claims({ sid: 'sid-none', sub: 'subject-local-neighbour', iat }));

    expect(deleted).toEqual([]);
    expect(await exists(hashSessionToken(local))).toBe(true);
  });

  it('makes the session a revoked token opened for: validateAndAutoLogin answers null afterwards', async () => {
    const iat = NOW() - 30;
    const person = await newPerson('subject-revoked');
    const session = await oidcSession(person, { sid: 'sid-revoked', createdAt: iat - 60 });
    expect(await validateAndAutoLogin(session.token)).not.toBeNull();

    await revokeForLogoutToken(claims({ sid: 'sid-revoked', iat }));

    expect(await validateAndAutoLogin(session.token)).toBeNull();
  });
});

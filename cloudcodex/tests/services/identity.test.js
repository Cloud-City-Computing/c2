/**
 * Tests for services/identity.js, the identity-resolution seam
 *
 * resolveIdentity() is the one place a verified external identity becomes a
 * local user. For Google it issues the queries the callback used to issue
 * inline, in the same order, plus one: before linking an email match it asks
 * whether that user already holds a Google account (spec Decision 3,
 * docs/maps/open-questions.md C7). Every route test that drives the callback
 * queues c2_query mocks in call order, so the assertions below pin the SQL and
 * its parameters call by call, and every refusal is checked to have written
 * nothing.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { resolveIdentity, deriveUniqueUsername, parseAuthProviders } from '../../services/identity.js';
import { resetMocks } from '../helpers.js';

const LINK_LOOKUP_SQL = `SELECT user_id FROM oauth_accounts WHERE provider = 'google' AND provider_user_id = ? LIMIT 1`;
const EMAIL_LOOKUP_SQL = `SELECT id FROM users WHERE email = ? LIMIT 1`;
const LINK_INSERT_SQL = `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email) VALUES (?, 'google', ?, ?)`;
const GOOGLE_ROW_LOOKUP_SQL = `SELECT id FROM oauth_accounts WHERE provider = 'google' AND user_id = ? LIMIT 1`;
const USERNAME_LOOKUP_SQL = `SELECT id FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1`;
const PERMISSIONS_INSERT_SQL = `INSERT INTO permissions (user_id, create_squad, create_archive, create_log) VALUES (?, TRUE, TRUE, TRUE)`;

/** Verified Google claims, the shape the callback builds from the ID token payload. */
function googleClaims(overrides = {}) {
  return {
    provider: 'google',
    subject: 'google-sub-123',
    email: 'ada@example.com',
    emailVerified: true,
    picture: 'https://example.com/ada.png',
    hostedDomain: 'example.com',
    ...overrides,
  };
}

/** The policy the Google route builds when GOOGLE_OAUTH_DOMAIN is unset. */
const OPEN_POLICY = { requiredHostedDomain: undefined, linkByVerifiedEmail: true, autoCreate: false };
/** The policy the Google route builds when GOOGLE_OAUTH_DOMAIN is 'example.com'. */
const DOMAIN_POLICY = { requiredHostedDomain: 'example.com', linkByVerifiedEmail: true, autoCreate: true };

/** Normalises whitespace so a multi-line template literal compares by content. */
function squash(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function sqlCalls() {
  return c2_query.mock.calls.map(([sql, params]) => [squash(sql), params]);
}

function writes() {
  return sqlCalls().filter(([sql]) => /^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql));
}

describe('resolveIdentity (google)', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('refusals before any query', () => {
    it('refuses an unverified email and touches the database not at all', async () => {
      const result = await resolveIdentity(googleClaims({ emailVerified: false }), DOMAIN_POLICY);

      expect(result).toEqual({ ok: false, reason: 'email_not_verified' });
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('checks email_verified before the hosted domain, as the callback always has', async () => {
      const result = await resolveIdentity(
        googleClaims({ emailVerified: false, hostedDomain: 'elsewhere.com' }),
        DOMAIN_POLICY,
      );

      expect(result).toEqual({ ok: false, reason: 'email_not_verified' });
    });

    it('refuses a hosted domain other than the required one', async () => {
      const result = await resolveIdentity(googleClaims({ hostedDomain: 'elsewhere.com' }), DOMAIN_POLICY);

      expect(result).toEqual({ ok: false, reason: 'domain_not_allowed' });
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('refuses a consumer account (no hosted domain) when a domain is required', async () => {
      const result = await resolveIdentity(googleClaims({ hostedDomain: undefined }), DOMAIN_POLICY);

      expect(result).toEqual({ ok: false, reason: 'domain_not_allowed' });
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('accepts any hosted domain, or none, when no domain is required', async () => {
      c2_query.mockResolvedValueOnce([{ user_id: 5 }]);
      expect(await resolveIdentity(googleClaims({ hostedDomain: undefined }), OPEN_POLICY))
        .toEqual({ ok: true, userId: 5, created: false });

      c2_query.mockResolvedValueOnce([{ user_id: 5 }]);
      expect(await resolveIdentity(googleClaims({ hostedDomain: 'elsewhere.com' }), OPEN_POLICY))
        .toEqual({ ok: true, userId: 5, created: false });
    });
  });

  describe('an identity that is already linked', () => {
    it('returns the linked user after exactly one lookup, keyed on the subject', async () => {
      c2_query.mockResolvedValueOnce([{ user_id: 42 }]);

      const result = await resolveIdentity(googleClaims(), OPEN_POLICY);

      expect(result).toEqual({ ok: true, userId: 42, created: false });
      expect(sqlCalls()).toEqual([[LINK_LOOKUP_SQL, ['google-sub-123']]]);
    });

    it('wins over the email match, so the email lookup never runs', async () => {
      c2_query.mockResolvedValueOnce([{ user_id: 42 }]);

      await resolveIdentity(googleClaims(), DOMAIN_POLICY);

      expect(c2_query).toHaveBeenCalledTimes(1);
    });
  });

  describe('linking by verified email', () => {
    it('links the existing user whose email matches and who has no Google account yet', async () => {
      c2_query.mockResolvedValueOnce([]); // no link
      c2_query.mockResolvedValueOnce([{ id: 9 }]); // user by email
      c2_query.mockResolvedValueOnce([]); // no Google account on that user
      c2_query.mockResolvedValueOnce({ insertId: 1 }); // link insert

      const result = await resolveIdentity(googleClaims(), OPEN_POLICY);

      expect(result).toEqual({ ok: true, userId: 9, created: false });
      expect(sqlCalls()).toEqual([
        [LINK_LOOKUP_SQL, ['google-sub-123']],
        [EMAIL_LOOKUP_SQL, ['ada@example.com']],
        [GOOGLE_ROW_LOOKUP_SQL, [9]],
        [LINK_INSERT_SQL, [9, 'google-sub-123', 'ada@example.com']],
      ]);
    });

    it('refuses as email_conflict, writing nothing, when linking by email is off', async () => {
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([{ id: 9 }]);

      const result = await resolveIdentity(
        googleClaims(),
        { ...DOMAIN_POLICY, linkByVerifiedEmail: false },
      );

      expect(result).toEqual({ ok: false, reason: 'email_conflict' });
      expect(sqlCalls()).toEqual([
        [LINK_LOOKUP_SQL, ['google-sub-123']],
        [EMAIL_LOOKUP_SQL, ['ada@example.com']],
      ]);
      expect(writes()).toEqual([]);
    });
  });

  describe('an email match that already holds a different Google account (open-questions C7)', () => {
    it('refuses as identity_conflict and issues no INSERT', async () => {
      c2_query.mockResolvedValueOnce([]); // this subject is linked to nobody
      c2_query.mockResolvedValueOnce([{ id: 9 }]); // user by email
      c2_query.mockResolvedValueOnce([{ id: 31 }]); // that user's Google account, another subject

      const result = await resolveIdentity(googleClaims(), OPEN_POLICY);

      expect(result).toEqual({ ok: false, reason: 'identity_conflict' });
      expect(sqlCalls()).toEqual([
        [LINK_LOOKUP_SQL, ['google-sub-123']],
        [EMAIL_LOOKUP_SQL, ['ada@example.com']],
        [GOOGLE_ROW_LOOKUP_SQL, [9]],
      ]);
      expect(writes()).toEqual([]);
    });

    it('refuses the same way under the domain policy, so auto-create never runs', async () => {
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([{ id: 9 }]);
      c2_query.mockResolvedValueOnce([{ id: 31 }]);

      const result = await resolveIdentity(googleClaims(), DOMAIN_POLICY);

      expect(result).toEqual({ ok: false, reason: 'identity_conflict' });
      expect(c2_query).toHaveBeenCalledTimes(3);
      expect(writes()).toEqual([]);
    });

    it('still signs in the subject that is already linked, before any email or conflict check', async () => {
      c2_query.mockResolvedValueOnce([{ user_id: 9 }]);

      const result = await resolveIdentity(googleClaims(), OPEN_POLICY);

      expect(result).toEqual({ ok: true, userId: 9, created: false });
      expect(sqlCalls()).toEqual([[LINK_LOOKUP_SQL, ['google-sub-123']]]);
    });
  });

  describe('no linked identity and no matching user', () => {
    it('refuses as no_account, writing nothing, when auto-create is off', async () => {
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([]);

      const result = await resolveIdentity(googleClaims(), OPEN_POLICY);

      expect(result).toEqual({ ok: false, reason: 'no_account' });
      expect(sqlCalls()).toEqual([
        [LINK_LOOKUP_SQL, ['google-sub-123']],
        [EMAIL_LOOKUP_SQL, ['ada@example.com']],
      ]);
      expect(writes()).toEqual([]);
    });

    it('creates the user, their default permissions and the link, in that order, when auto-create is on', async () => {
      c2_query.mockResolvedValueOnce([]); // no link
      c2_query.mockResolvedValueOnce([]); // no user by email
      c2_query.mockResolvedValueOnce([]); // username 'ada' is free
      c2_query.mockResolvedValueOnce({ insertId: 77 }); // user insert
      c2_query.mockResolvedValueOnce({ affectedRows: 1 }); // permissions
      c2_query.mockResolvedValueOnce({ insertId: 3 }); // link insert

      const result = await resolveIdentity(googleClaims(), DOMAIN_POLICY);

      expect(result).toEqual({ ok: true, userId: 77, created: true });
      const calls = sqlCalls();
      expect(calls).toHaveLength(6);
      expect(calls[0]).toEqual([LINK_LOOKUP_SQL, ['google-sub-123']]);
      expect(calls[1]).toEqual([EMAIL_LOOKUP_SQL, ['ada@example.com']]);
      expect(calls[2]).toEqual([USERNAME_LOOKUP_SQL, ['ada']]);
      expect(calls[3]).toEqual([
        'INSERT INTO users (name, password_hash, email, avatar_url, created_at) VALUES (?, NULL, ?, ?, NOW())',
        ['ada', 'ada@example.com', 'https://example.com/ada.png'],
      ]);
      expect(calls[4]).toEqual([PERMISSIONS_INSERT_SQL, [77]]);
      expect(calls[5]).toEqual([LINK_INSERT_SQL, [77, 'google-sub-123', 'ada@example.com']]);
    });

    it('stores a null avatar when the identity carries no picture', async () => {
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce({ insertId: 78 });

      await resolveIdentity(googleClaims({ picture: undefined }), DOMAIN_POLICY);

      expect(sqlCalls()[3][1]).toEqual(['ada', 'ada@example.com', null]);
    });

    it('creates when linking by email is off and no user holds the email', async () => {
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce({ insertId: 79 });

      const result = await resolveIdentity(googleClaims(), { ...DOMAIN_POLICY, linkByVerifiedEmail: false });

      expect(result).toEqual({ ok: true, userId: 79, created: true });
    });
  });

  describe('failures', () => {
    it('lets a database error propagate rather than turning it into a refusal', async () => {
      c2_query.mockRejectedValueOnce(new Error('connection lost'));

      await expect(resolveIdentity(googleClaims(), OPEN_POLICY)).rejects.toThrow('connection lost');
    });

    it('throws for a provider it does not implement, before any query', async () => {
      await expect(resolveIdentity(googleClaims({ provider: 'oidc', issuer: 'https://issuer.example' }), OPEN_POLICY))
        .rejects.toThrow(/oidc/);
      expect(c2_query).not.toHaveBeenCalled();
    });
  });
});

describe('deriveUniqueUsername', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('returns the local part when no user holds it, compared case-insensitively', async () => {
    expect(await deriveUniqueUsername('ada@example.com')).toBe('ada');
    expect(sqlCalls()).toEqual([[USERNAME_LOOKUP_SQL, ['ada']]]);
  });

  it('replaces characters a username cannot hold with underscores', async () => {
    expect(await deriveUniqueUsername('first.last+tag@example.com')).toBe('first_last_tag');
  });

  it('pads a local part shorter than three characters', async () => {
    expect(await deriveUniqueUsername('ab@example.com')).toBe('ab_');
  });

  it('truncates a long local part to 28 characters', async () => {
    const result = await deriveUniqueUsername(`${'a'.repeat(40)}@example.com`);
    expect(result).toBe('a'.repeat(28));
  });

  it('appends a random suffix when the base is taken', async () => {
    c2_query.mockResolvedValueOnce([{ id: 1 }]); // base taken
    c2_query.mockResolvedValueOnce([]); // first candidate free

    const result = await deriveUniqueUsername('ada@example.com');

    expect(result).toMatch(/^ada_[0-9a-f]{4}$/);
    expect(c2_query).toHaveBeenCalledTimes(2);
  });

  it('keeps a suffixed name within 32 characters', async () => {
    c2_query.mockResolvedValueOnce([{ id: 1 }]);
    c2_query.mockResolvedValueOnce([]);

    const result = await deriveUniqueUsername(`${'b'.repeat(40)}@example.com`);

    expect(result.length).toBeLessThanOrEqual(32);
    expect(result.startsWith('b'.repeat(28))).toBe(true);
  });

  it('falls back to a fully random name after twenty taken candidates', async () => {
    for (let i = 0; i < 21; i++) c2_query.mockResolvedValueOnce([{ id: i + 1 }]);

    const result = await deriveUniqueUsername('ada@example.com');

    expect(result).toMatch(/^user_[0-9a-f]{8}$/);
    expect(c2_query).toHaveBeenCalledTimes(21);
  });
});

describe('parseAuthProviders', () => {
  const KEYS = ['AUTH_PROVIDERS', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function configureGoogle() {
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  }

  describe('unset: today\'s derived set', () => {
    it('is local alone when Google is not configured', () => {
      expect(parseAuthProviders()).toEqual(new Set(['local']));
    });

    it('is local and google when Google is configured', () => {
      configureGoogle();
      expect(parseAuthProviders()).toEqual(new Set(['local', 'google']));
    });

    it('treats half a Google configuration as not configured, as the routes do', () => {
      process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
      expect(parseAuthProviders()).toEqual(new Set(['local']));
    });

    it('treats a blank value as unset, which is what .env.example ships', () => {
      process.env.AUTH_PROVIDERS = '   ';
      configureGoogle();
      expect(parseAuthProviders()).toEqual(new Set(['local', 'google']));
    });
  });

  describe('set: an explicit list', () => {
    it('accepts local alone when Google is not configured', () => {
      process.env.AUTH_PROVIDERS = 'local';
      expect(parseAuthProviders()).toEqual(new Set(['local']));
    });

    it('accepts local and google when Google is configured', () => {
      process.env.AUTH_PROVIDERS = 'local,google';
      configureGoogle();
      expect(parseAuthProviders()).toEqual(new Set(['local', 'google']));
    });

    it('tolerates spaces, case and a trailing comma', () => {
      process.env.AUTH_PROVIDERS = ' Local , GOOGLE ,';
      configureGoogle();
      expect(parseAuthProviders()).toEqual(new Set(['local', 'google']));
    });

    it('refuses an unknown provider, naming the variable and the value', () => {
      process.env.AUTH_PROVIDERS = 'local,saml';
      expect(() => parseAuthProviders()).toThrow(/AUTH_PROVIDERS.*"saml"/);
    });

    it('refuses oidc until the relying party exists', () => {
      process.env.AUTH_PROVIDERS = 'local,oidc';
      expect(() => parseAuthProviders()).toThrow(/AUTH_PROVIDERS.*"oidc"/);
    });

    it('refuses a list without local', () => {
      process.env.AUTH_PROVIDERS = 'google';
      configureGoogle();
      expect(() => parseAuthProviders()).toThrow(/AUTH_PROVIDERS must include local/);
    });

    it('refuses google when Google is not configured, naming the missing variables', () => {
      process.env.AUTH_PROVIDERS = 'local,google';
      process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
      expect(() => parseAuthProviders()).toThrow(/AUTH_PROVIDERS lists google.*GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET/);
    });

    it('refuses a list that leaves out a configured Google, which would still be offered', () => {
      process.env.AUTH_PROVIDERS = 'local';
      configureGoogle();
      expect(() => parseAuthProviders()).toThrow(/AUTH_PROVIDERS does not list google/);
    });

    it.each([
      ['an unknown provider', 'nope', false],
      ['a list without local', 'google', true],
      ['an unconfigured google', 'local,google', false],
      ['a configured google left out', 'local', true],
    ])('phrases the refusal for %s as a sentence that opens with the variable', (_label, value, google) => {
      process.env.AUTH_PROVIDERS = value;
      if (google) configureGoogle();
      let message = '';
      try {
        parseAuthProviders();
      } catch (err) {
        message = err.message;
      }
      expect(message).toMatch(/^AUTH_PROVIDERS .+\.$/);
    });
  });
});

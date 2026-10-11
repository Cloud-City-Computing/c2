/**
 * Tests for services/auth-providers.js: which sign-in methods an instance offers, and the hosted rule
 *
 * An unset AUTH_PROVIDERS keeps today's derived set. A list without local is hosted mode: OIDC is the
 * only human sign-in, so the list must name oidc, must not name google, and the Google variables must be
 * unset. Every refusal is a sentence that opens with the variable.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  offeredProviders,
  localSignInEnabled,
  parseAuthProviders,
} from '../../services/auth-providers.js';

const KEYS = ['AUTH_PROVIDERS', 'OIDC_ISSUER_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const ISSUER = 'https://id.example.test';

describe('auth-providers', () => {
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const configureGoogle = () => {
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  };

  describe('offeredProviders and localSignInEnabled, which never throw', () => {
    it('derives local alone when nothing is configured, and local is on', () => {
      expect([...offeredProviders()]).toEqual(['local']);
      expect(localSignInEnabled()).toBe(true);
    });

    it('derives google and oidc from their configuration when AUTH_PROVIDERS is unset', () => {
      configureGoogle();
      process.env.OIDC_ISSUER_URL = ISSUER;
      expect(offeredProviders()).toEqual(new Set(['local', 'google', 'oidc']));
    });

    it('reads a list as written, without validating it', () => {
      process.env.AUTH_PROVIDERS = 'oidc';
      expect(offeredProviders()).toEqual(new Set(['oidc']));
      expect(localSignInEnabled()).toBe(false);
    });

    it('does not throw on an invalid list, which the boot check reports instead', () => {
      process.env.AUTH_PROVIDERS = 'google';
      expect(() => offeredProviders()).not.toThrow();
      expect(localSignInEnabled()).toBe(false);
    });

    it('treats a blank AUTH_PROVIDERS as unset', () => {
      process.env.AUTH_PROVIDERS = '   ';
      expect(localSignInEnabled()).toBe(true);
    });
  });

  describe('parseAuthProviders in hosted mode (no local)', () => {
    it('accepts oidc alone when an issuer is configured', () => {
      process.env.OIDC_ISSUER_URL = ISSUER;
      process.env.AUTH_PROVIDERS = 'oidc';
      expect(parseAuthProviders()).toEqual(new Set(['oidc']));
    });

    it('refuses oidc without an issuer, naming the variable', () => {
      process.env.AUTH_PROVIDERS = 'oidc';
      expect(() => parseAuthProviders()).toThrow(/^AUTH_PROVIDERS lists oidc, but OIDC_ISSUER_URL is not set/);
    });

    it('refuses a list without oidc, since a hosted instance has no other sign-in', () => {
      process.env.AUTH_PROVIDERS = 'google';
      configureGoogle();
      expect(() => parseAuthProviders()).toThrow(/^AUTH_PROVIDERS .*hosted mode.*oidc/);
    });

    it('refuses google in the list, because hosted sign-in is OIDC only', () => {
      process.env.OIDC_ISSUER_URL = ISSUER;
      process.env.AUTH_PROVIDERS = 'oidc,google';
      configureGoogle();
      expect(() => parseAuthProviders()).toThrow(/^AUTH_PROVIDERS lists google.*OIDC only/);
    });

    it('refuses configured Google variables on a hosted instance, naming them to unset', () => {
      process.env.OIDC_ISSUER_URL = ISSUER;
      process.env.AUTH_PROVIDERS = 'oidc';
      configureGoogle();
      expect(() => parseAuthProviders()).toThrow(/^AUTH_PROVIDERS .*GOOGLE_CLIENT_ID.*unset/);
    });

    it('still refuses an empty list', () => {
      process.env.AUTH_PROVIDERS = ' , ';
      expect(() => parseAuthProviders()).toThrow(/^AUTH_PROVIDERS lists no sign-in provider/);
    });

    it('keeps the local rules: local with a configured issuer left out is still refused', () => {
      process.env.OIDC_ISSUER_URL = ISSUER;
      process.env.AUTH_PROVIDERS = 'local';
      expect(() => parseAuthProviders()).toThrow(/does not list oidc/);
    });
  });
});

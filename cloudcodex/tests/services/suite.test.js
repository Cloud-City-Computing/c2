/**
 * Cloud Codex - Tests for services/suite.js, the suite mode configuration
 *
 * Suite mode is off unless SUITE_COMMAND_WORKSPACE_URL is set; SUITE_NAME is required with it.
 * Each refusal names the variable and the rule it broke, because boot prints that sentence.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readSuiteConfig } from '../../services/suite.js';

const KEYS = ['SUITE_COMMAND_WORKSPACE_URL', 'SUITE_NAME', 'NODE_ENV'];
const URL_OK = 'https://command.example.test/w/1';
let saved;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('readSuiteConfig: off', () => {
  it('is off when the URL is unset, with no name and no URL', () => {
    expect(readSuiteConfig()).toEqual({ enabled: false, name: null, commandWorkspaceUrl: null, preferenceDomain: null });
  });

  it('is off when the URL is blank', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = '   ';
    expect(readSuiteConfig().enabled).toBe(false);
  });

  it('ignores SUITE_NAME alone', () => {
    process.env.SUITE_NAME = 'Example Suite';
    expect(readSuiteConfig()).toEqual({ enabled: false, name: null, commandWorkspaceUrl: null, preferenceDomain: null });
  });
});

describe('readSuiteConfig: on', () => {
  it('is on with a valid https URL and a name, and trims both', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = `  ${URL_OK}  `;
    process.env.SUITE_NAME = '  Example Suite ';
    expect(readSuiteConfig()).toEqual({
      enabled: true,
      name: 'Example Suite',
      commandWorkspaceUrl: new URL(URL_OK).href,
      preferenceDomain: null,
    });
  });

  it('accepts plain http outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.SUITE_COMMAND_WORKSPACE_URL = 'http://localhost:3001/w/1';
    process.env.SUITE_NAME = 'Example Suite';
    expect(readSuiteConfig().enabled).toBe(true);
  });

  it('accepts a 40-character name', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = URL_OK;
    process.env.SUITE_NAME = 'a'.repeat(40);
    expect(readSuiteConfig().name).toHaveLength(40);
  });
});

describe('readSuiteConfig: refusals', () => {
  it('refuses a value that is not a URL', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = 'not a url';
    process.env.SUITE_NAME = 'Example Suite';
    expect(() => readSuiteConfig()).toThrow('SUITE_COMMAND_WORKSPACE_URL is not a URL.');
  });

  it('refuses a non-http scheme', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = 'ftp://command.example.test/w/1';
    process.env.SUITE_NAME = 'Example Suite';
    expect(() => readSuiteConfig()).toThrow(
      'SUITE_COMMAND_WORKSPACE_URL must be https (http only outside production), with no user or password.',
    );
  });

  it('refuses plain http in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.SUITE_COMMAND_WORKSPACE_URL = 'http://command.example.test/w/1';
    process.env.SUITE_NAME = 'Example Suite';
    expect(() => readSuiteConfig()).toThrow('must be https');
  });

  it('refuses a URL carrying a user or password', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = 'https://user:secret@command.example.test/w/1';
    process.env.SUITE_NAME = 'Example Suite';
    expect(() => readSuiteConfig()).toThrow('with no user or password.');
  });

  it('refuses suite mode without a name', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = URL_OK;
    expect(() => readSuiteConfig()).toThrow(
      'SUITE_NAME is required in suite mode: 1 to 40 characters, no control characters.',
    );
  });

  it('refuses a 41-character name', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = URL_OK;
    process.env.SUITE_NAME = 'a'.repeat(41);
    expect(() => readSuiteConfig()).toThrow('SUITE_NAME is required in suite mode');
  });

  it('refuses a name with a control character', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = URL_OK;
    process.env.SUITE_NAME = 'Example\u0007Suite';
    expect(() => readSuiteConfig()).toThrow('SUITE_NAME is required in suite mode');
  });
});

describe('readSuiteConfig: the URL is the workspace URL, origin plus /w/<id>', () => {
  const SHAPE = 'SUITE_COMMAND_WORKSPACE_URL must be the workspace URL: an origin plus /w/<workspace id>, '
    + 'with no query, fragment or further path.';

  beforeEach(() => {
    process.env.SUITE_NAME = 'Example Suite';
  });

  it('refuses an origin with no workspace path', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = 'https://command.example.test';
    expect(() => readSuiteConfig()).toThrow(SHAPE);
  });

  it('refuses an origin with a trailing slash and no workspace path', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = 'https://command.example.test/';
    expect(() => readSuiteConfig()).toThrow(SHAPE);
  });

  it('refuses a query string', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = `${URL_OK}?x=1`;
    expect(() => readSuiteConfig()).toThrow(SHAPE);
  });

  it('refuses an empty query marker, which the URL parser keeps as a bare question mark', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = `${URL_OK}?`;
    expect(() => readSuiteConfig()).toThrow(SHAPE);
  });

  it('refuses a fragment', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = `${URL_OK}#top`;
    expect(() => readSuiteConfig()).toThrow(SHAPE);
  });

  it('refuses extra path segments after the workspace id', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = `${URL_OK}/docs`;
    expect(() => readSuiteConfig()).toThrow(SHAPE);
    process.env.SUITE_COMMAND_WORKSPACE_URL = `${URL_OK}/docs/7/42`;
    expect(() => readSuiteConfig()).toThrow(SHAPE);
  });

  it('refuses a path that is not /w/ at all', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = 'https://command.example.test/workspaces/1';
    expect(() => readSuiteConfig()).toThrow(SHAPE);
  });

  it('refuses a /w/ path with no id', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = 'https://command.example.test/w/';
    expect(() => readSuiteConfig()).toThrow(SHAPE);
  });

  it('accepts /w/<id> without a trailing slash', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = URL_OK;
    expect(readSuiteConfig().commandWorkspaceUrl).toBe(URL_OK);
  });

  it('accepts /w/<id> with a trailing slash', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = `${URL_OK}/`;
    expect(readSuiteConfig().enabled).toBe(true);
  });
});

// SUITE_PREFERENCE_DOMAIN (W6-CDX-44): the parent domain the theme and accent cookies are shared on.
// Honoured only in suite mode; each refusal names the variable.
describe('readSuiteConfig: SUITE_PREFERENCE_DOMAIN', () => {
  const KEYS_PD = ['SUITE_PREFERENCE_DOMAIN', 'APP_URL'];
  let savedPd;
  beforeEach(() => {
    savedPd = Object.fromEntries(KEYS_PD.map((k) => [k, process.env[k]]));
    for (const k of KEYS_PD) delete process.env[k];
    process.env.SUITE_COMMAND_WORKSPACE_URL = URL_OK;
    process.env.SUITE_NAME = 'Example Suite';
  });
  afterEach(() => {
    for (const k of KEYS_PD) {
      if (savedPd[k] === undefined) delete process.env[k];
      else process.env[k] = savedPd[k];
    }
  });

  it.each([
    'Example.com', 'com', '.example.com', 'example.com.', 'example.com:443', 'https://example.com',
    '10.0.0.1', '[::1]', 'localhost', 'suite.localhost', 'example..com', 'exa mple.com',
  ])('refuses %s, naming the variable', (value) => {
    process.env.SUITE_PREFERENCE_DOMAIN = value;
    expect(() => readSuiteConfig()).toThrow(/SUITE_PREFERENCE_DOMAIN/);
  });

  it('refuses a domain that APP_URL does not sit under', () => {
    process.env.SUITE_PREFERENCE_DOMAIN = 'example.com';
    process.env.APP_URL = 'https://codex.other.org';
    expect(() => readSuiteConfig()).toThrow(/SUITE_PREFERENCE_DOMAIN \(example\.com\) must be APP_URL's host/);
  });

  it('refuses a domain against an APP_URL that is not a URL, instead of skipping the check', () => {
    process.env.SUITE_PREFERENCE_DOMAIN = 'example.com';
    process.env.APP_URL = 'codex without a scheme';
    expect(() => readSuiteConfig()).toThrow(/SUITE_PREFERENCE_DOMAIN.*APP_URL/);
  });

  it('checks against the default APP_URL when APP_URL is unset, so the check is never skipped', () => {
    process.env.SUITE_PREFERENCE_DOMAIN = 'example.com';
    expect(() => readSuiteConfig()).toThrow(/SUITE_PREFERENCE_DOMAIN \(example\.com\) must be APP_URL's host/);
  });

  it('returns the domain when APP_URL sits under it', () => {
    process.env.SUITE_PREFERENCE_DOMAIN = 'example.com';
    process.env.APP_URL = 'https://codex.example.com';
    expect(readSuiteConfig().preferenceDomain).toBe('example.com');
  });

  it('returns the domain when APP_URL is the domain itself', () => {
    process.env.SUITE_PREFERENCE_DOMAIN = 'example.com';
    process.env.APP_URL = 'https://example.com';
    expect(readSuiteConfig().preferenceDomain).toBe('example.com');
  });

  it('is null when unset, and suite mode on carries it as null', () => {
    expect(readSuiteConfig().preferenceDomain).toBeNull();
  });

  it('is ignored with suite mode off, so an invalid value boots', () => {
    delete process.env.SUITE_COMMAND_WORKSPACE_URL;
    delete process.env.SUITE_NAME;
    process.env.SUITE_PREFERENCE_DOMAIN = 'Example.com';
    expect(readSuiteConfig()).toEqual({ enabled: false, name: null, commandWorkspaceUrl: null, preferenceDomain: null });
  });
});

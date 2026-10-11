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
    expect(readSuiteConfig()).toEqual({ enabled: false, name: null, commandWorkspaceUrl: null });
  });

  it('is off when the URL is blank', () => {
    process.env.SUITE_COMMAND_WORKSPACE_URL = '   ';
    expect(readSuiteConfig().enabled).toBe(false);
  });

  it('ignores SUITE_NAME alone', () => {
    process.env.SUITE_NAME = 'Example Suite';
    expect(readSuiteConfig()).toEqual({ enabled: false, name: null, commandWorkspaceUrl: null });
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

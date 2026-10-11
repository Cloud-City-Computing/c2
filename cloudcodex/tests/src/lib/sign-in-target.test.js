/**
 * Tests for src/lib/sign-in-target.js: the kept deep link and the sessionStorage it lives in (W6-CDX-26)
 *
 * A storage that throws (blocked cookies, a sandboxed frame) is refused, not fatal: nothing is kept, nothing
 * is read, and the caller carries on. The getter itself can throw, so the test stubs window.sessionStorage.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SIGN_IN_TARGET_KEY,
  getStorage,
  keepSignInTarget,
  takeSignInTarget,
  clearSignInTarget,
} from '../../../src/lib/sign-in-target.js';

let originalStorage;

function stubSessionStorageGetter(get) {
  originalStorage = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
  Object.defineProperty(window, 'sessionStorage', { configurable: true, get });
}

function restoreSessionStorage() {
  if (originalStorage) Object.defineProperty(window, 'sessionStorage', originalStorage);
  else delete window.sessionStorage;
}

describe('the kept target with working storage', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('is kept under SIGN_IN_TARGET_KEY and handed back once', () => {
    keepSignInTarget(window.sessionStorage, '/doc/9');
    expect(window.sessionStorage.getItem(SIGN_IN_TARGET_KEY)).toBe('/doc/9');
    expect(takeSignInTarget()).toBe('/doc/9');
    expect(takeSignInTarget()).toBeNull();
  });

  it('is cleared by clearSignInTarget', () => {
    keepSignInTarget(window.sessionStorage, '/doc/9');
    clearSignInTarget();
    expect(takeSignInTarget()).toBeNull();
  });
});

describe('a sessionStorage whose getter throws is refused, and fails closed', () => {
  beforeEach(() => {
    stubSessionStorageGetter(() => { throw new Error('SecurityError: storage is disabled'); });
  });

  afterEach(() => {
    restoreSessionStorage();
  });

  it('getStorage answers null rather than throwing', () => {
    expect(getStorage()).toBeNull();
  });

  it('keeping a target does nothing and does not throw', () => {
    expect(() => keepSignInTarget(getStorage(), '/doc/9')).not.toThrow();
  });

  it('taking a target answers null, so the sign-in reloads the page it is on', () => {
    expect(takeSignInTarget()).toBeNull();
  });

  it('clearing the target does not throw', () => {
    expect(() => clearSignInTarget()).not.toThrow();
  });
});

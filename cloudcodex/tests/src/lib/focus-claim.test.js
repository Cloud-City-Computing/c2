/**
 * Cloud Codex - Tests for src/lib/focus-claim.js
 *
 * The claim is the opener of the first modal. A later modal, opened from inside the first,
 * must not overwrite it. When the opener has unmounted, focus goes to the first control in
 * the app root rather than to nowhere.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rememberOpener, restoreOpener } from '../../../src/lib/focus-claim.js';

let appRoot;

beforeEach(() => {
  appRoot = document.createElement('div');
  appRoot.id = 'root';
  appRoot.innerHTML = '<a href="/home" id="brand">brand</a><button id="opener">open</button>';
  document.body.appendChild(appRoot);
});

afterEach(() => {
  restoreOpener();
  appRoot.remove();
});

describe('focus claim', () => {
  it('keeps the first opener over a second rememberOpener', () => {
    const opener = document.getElementById('opener');
    const other = document.getElementById('brand');
    opener.focus();
    rememberOpener();
    other.focus();
    rememberOpener();
    document.body.focus();
    restoreOpener();
    expect(document.activeElement).toBe(opener);
  });

  it('focuses the claimed opener on restore, and clears the claim', () => {
    const opener = document.getElementById('opener');
    opener.focus();
    rememberOpener();
    document.body.focus();
    restoreOpener();
    expect(document.activeElement).toBe(opener);

    // The claim is cleared: the next remember takes the new element.
    const brand = document.getElementById('brand');
    brand.focus();
    rememberOpener();
    document.body.focus();
    restoreOpener();
    expect(document.activeElement).toBe(brand);
  });

  it('falls back to the first focusable control in the app root when the opener has unmounted', () => {
    const opener = document.getElementById('opener');
    opener.focus();
    rememberOpener();
    opener.remove();
    expect(() => restoreOpener()).not.toThrow();
    expect(document.activeElement.id).toBe('brand');
  });

  it('falls back to the app root when no opener was claimed, and does not throw', () => {
    document.body.focus();
    expect(() => restoreOpener()).not.toThrow();
    expect(document.activeElement.id).toBe('brand');
  });
});

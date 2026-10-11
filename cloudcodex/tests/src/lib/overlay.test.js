/**
 * Cloud Codex - Tests for src/lib/overlay.js
 *
 * The overlay is a counter: one declaration makes the app root inert and stops the page
 * scrolling, and the last release restores both.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { declareOverlay, openOverlayCount } from '../../../src/lib/overlay.js';

let appRoot;

beforeEach(() => {
  appRoot = document.createElement('div');
  appRoot.id = 'root';
  document.body.appendChild(appRoot);
});

afterEach(() => {
  appRoot.remove();
  document.body.style.overflow = '';
});

describe('declareOverlay', () => {
  it('makes the app root inert while one overlay is declared', () => {
    const release = declareOverlay(appRoot);
    expect(appRoot.hasAttribute('inert')).toBe(true);
    release();
    expect(appRoot.hasAttribute('inert')).toBe(false);
  });

  it('keeps the root inert until the last of two overlays is released', () => {
    const outer = declareOverlay(appRoot);
    const inner = declareOverlay(appRoot);
    expect(openOverlayCount()).toBe(2);
    inner();
    expect(appRoot.hasAttribute('inert')).toBe(true);
    outer();
    expect(appRoot.hasAttribute('inert')).toBe(false);
    expect(openOverlayCount()).toBe(0);
  });

  it('counts a release twice as one release', () => {
    const first = declareOverlay(appRoot);
    const second = declareOverlay(appRoot);
    first();
    first();
    expect(openOverlayCount()).toBe(1);
    expect(appRoot.hasAttribute('inert')).toBe(true);
    second();
    expect(openOverlayCount()).toBe(0);
  });

  it('stops the page scrolling while open, and restores the previous overflow', () => {
    document.body.style.overflow = 'auto';
    const release = declareOverlay(appRoot);
    expect(document.body.style.overflow).toBe('hidden');
    release();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('does not throw when there is no app root', () => {
    appRoot.remove();
    const release = declareOverlay(null);
    expect(() => release()).not.toThrow();
    appRoot = document.createElement('div');
    document.body.appendChild(appRoot);
  });
});

/**
 * Cloud Codex - Tests for src/lib/focus-trap.js
 *
 * Keyboard only: each press is a real KeyboardEvent dispatched on the focused element, and
 * the trap is asked whether it prevented the default (the browser's own Tab move).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FOCUSABLE, trapTab } from '../../../src/lib/focus-trap.js';

let root;

function press(key, { shift = false, on = document.activeElement } = {}) {
  const event = new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true });
  on.dispatchEvent(event);
  trapTab(event, root);
  return event;
}

beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = `
    <button id="first">first</button>
    <button id="middle">middle</button>
    <button id="last">last</button>`;
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
});

describe('FOCUSABLE', () => {
  it('is the pinned list of Tab stops, with select kept for Codex forms', () => {
    expect(FOCUSABLE).toBe(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), ' +
      'select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
  });
});

describe('trapTab', () => {
  it('wraps a Tab on the last stop back to the first, and prevents the browser move', () => {
    document.getElementById('last').focus();
    const event = press('Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement.id).toBe('first');
  });

  it('wraps a Shift+Tab on the first stop to the last', () => {
    document.getElementById('first').focus();
    const event = press('Tab', { shift: true });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement.id).toBe('last');
  });

  it('leaves a Tab from a middle stop to the browser', () => {
    document.getElementById('middle').focus();
    const event = press('Tab');
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement.id).toBe('middle');
  });

  it('ignores keys other than Tab', () => {
    document.getElementById('last').focus();
    expect(press('Enter').defaultPrevented).toBe(false);
  });

  it('skips a stop inside an [inert] subtree when it finds the boundary', () => {
    const hidden = document.createElement('div');
    hidden.setAttribute('inert', '');
    hidden.innerHTML = '<button id="ghost">ghost</button>';
    root.appendChild(hidden);
    document.getElementById('last').focus();
    press('Tab');
    expect(document.activeElement.id).toBe('first');
  });

  it('is a no-op for a null root', () => {
    document.getElementById('last').focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    expect(() => trapTab(event, null)).not.toThrow();
    expect(event.defaultPrevented).toBe(false);
  });

  it('is a no-op when the root has no stops', () => {
    const empty = document.createElement('div');
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    trapTab(event, empty);
    expect(event.defaultPrevented).toBe(false);
  });
});

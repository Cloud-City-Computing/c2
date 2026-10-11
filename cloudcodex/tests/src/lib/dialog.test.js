/**
 * Cloud Codex - Tests for src/lib/dialog.js
 *
 * The dialog contract: role and aria-modal, a name from the heading, focus in on open, Tab
 * trapped, Escape to the dialog's own close, the app root inert, and focus back to the opener.
 * Every press is a real KeyboardEvent on the focused element; nothing is clicked.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDialog, closeDialog } from '../../../src/lib/dialog.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let appRoot;
let host;
let opener;

function keyOn(el, key, { shift = false } = {}) {
  const event = new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

function makeDialog(html) {
  const wrapper = document.createElement('div');
  wrapper.className = 'modal-content-wrapper';
  wrapper.innerHTML = html;
  host.appendChild(wrapper);
  return wrapper;
}

beforeEach(() => {
  appRoot = document.createElement('div');
  appRoot.id = 'root';
  appRoot.innerHTML = '<button id="opener">open</button>';
  host = document.createElement('div');
  host.id = 'modal-root';
  document.body.append(appRoot, host);
  opener = document.getElementById('opener');
  opener.focus();
});

afterEach(() => {
  closeDialog();
  appRoot.remove();
  host.remove();
  document.body.style.overflow = '';
});

describe('the dialog element', () => {
  it('is role dialog and aria-modal, and is a focus target itself', () => {
    const wrapper = makeDialog('<h2>Delete?</h2><button>Cancel</button>');
    openDialog(wrapper);
    expect(wrapper.getAttribute('role')).toBe('dialog');
    expect(wrapper.getAttribute('aria-modal')).toBe('true');
    expect(wrapper.tabIndex).toBe(-1);
  });

  it('is named by its first heading, and an explicit labelledBy wins', () => {
    const wrapper = makeDialog('<h2>Archive access</h2><button>Close</button>');
    openDialog(wrapper);
    const heading = wrapper.querySelector('h2');
    expect(heading.id).not.toBe('');
    expect(wrapper.getAttribute('aria-labelledby')).toBe(heading.id);

    closeDialog();
    const explicit = makeDialog('<h2 id="custom">Named</h2><button>x</button>');
    openDialog(explicit, { labelledBy: 'custom' });
    expect(explicit.getAttribute('aria-labelledby')).toBe('custom');
  });

  it('picks up a heading that renders after the dialog opens', async () => {
    const wrapper = makeDialog('<p>Loading…</p>');
    openDialog(wrapper);
    expect(wrapper.hasAttribute('aria-labelledby')).toBe(false);
    const h2 = document.createElement('h2');
    h2.textContent = 'Loaded';
    wrapper.appendChild(h2);
    await tick();
    expect(wrapper.getAttribute('aria-labelledby')).toBe(h2.id);
  });
});

describe('initial focus', () => {
  it('moves focus to the first control that is not the close button', () => {
    const wrapper = makeDialog('<button class="close-button" aria-label="Close">×</button><input id="name" /><button>Save</button>');
    openDialog(wrapper);
    expect(document.activeElement.id).toBe('name');
  });

  it('keeps focus where the content already put it (autoFocus)', async () => {
    const wrapper = makeDialog('<button>Cancel</button>');
    openDialog(wrapper);
    expect(document.activeElement.textContent).toBe('Cancel');
    closeDialog();
    const second = makeDialog('<h2>x</h2><input id="typed" />');
    second.querySelector('#typed').focus();
    openDialog(second);
    expect(document.activeElement.id).toBe('typed');
  });

  it('falls back to the dialog itself when it has no control', () => {
    const wrapper = makeDialog('<p>Read this.</p>');
    openDialog(wrapper);
    expect(document.activeElement).toBe(wrapper);
  });
});

describe('Tab inside an open dialog', () => {
  it('wraps Tab from the last control to the first, and Shift+Tab from the first to the last', () => {
    const wrapper = makeDialog('<button id="a">a</button><button id="b">b</button>');
    openDialog(wrapper);
    const b = document.getElementById('b');
    b.focus();
    expect(keyOn(b, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement.id).toBe('a');
    expect(keyOn(document.activeElement, 'Tab', { shift: true }).defaultPrevented).toBe(true);
    expect(document.activeElement.id).toBe('b');
  });

  it('pulls focus back in when it has escaped to the page', () => {
    const wrapper = makeDialog('<button id="a">a</button>');
    openDialog(wrapper);
    opener.focus();
    const event = keyOn(opener, 'Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.contains(document.activeElement)).toBe(true);
  });
});

describe('Escape', () => {
  it('calls the dialog onEscape, and prevents the default', () => {
    const onEscape = vi.fn();
    const wrapper = makeDialog('<button>x</button>');
    openDialog(wrapper, { onEscape });
    const event = keyOn(document.activeElement, 'Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does nothing when the dialog has no onEscape (a dialog that must not be dismissed)', () => {
    const wrapper = makeDialog('<button>x</button>');
    openDialog(wrapper);
    const event = keyOn(document.activeElement, 'Escape');
    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.isConnected).toBe(true);
  });
});

describe('the background', () => {
  it('makes the app root inert while open, and not after it closes', () => {
    const wrapper = makeDialog('<button>x</button>');
    openDialog(wrapper);
    expect(appRoot.hasAttribute('inert')).toBe(true);
    closeDialog();
    expect(appRoot.hasAttribute('inert')).toBe(false);
  });

  it('stays inert when one dialog replaces another, and clears once after the replacement closes', () => {
    const first = makeDialog('<button>one</button>');
    openDialog(first);
    first.remove();
    const second = makeDialog('<button>two</button>');
    openDialog(second);
    expect(appRoot.hasAttribute('inert')).toBe(true);
    closeDialog();
    expect(appRoot.hasAttribute('inert')).toBe(false);
  });
});

describe('focus returns to the opener', () => {
  it('focuses the opener on close', () => {
    const wrapper = makeDialog('<button>x</button>');
    const entry = openDialog(wrapper);
    expect(document.activeElement).not.toBe(opener);
    closeDialog(entry);
    expect(document.activeElement).toBe(opener);
  });

  it('falls back to the first control in the app root when the opener has unmounted', () => {
    appRoot.insertAdjacentHTML('afterbegin', '<a href="/" id="brand">brand</a>');
    const wrapper = makeDialog('<button>x</button>');
    openDialog(wrapper);
    opener.remove();
    closeDialog();
    expect(document.activeElement.id).toBe('brand');
  });

  it('ignores a close for a dialog that has already been replaced', () => {
    const first = makeDialog('<button>one</button>');
    const stale = openDialog(first);
    const second = makeDialog('<button>two</button>');
    openDialog(second);
    closeDialog(stale);
    expect(appRoot.hasAttribute('inert')).toBe(true);
    expect(second.isConnected).toBe(true);
  });
});

describe('listeners', () => {
  it('installs exactly one keydown listener, however many dialogs open and close', async () => {
    vi.resetModules();
    const fresh = await import('../../../src/lib/dialog.js');
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    for (let i = 0; i < 2; i += 1) {
      const wrapper = makeDialog('<button>x</button>');
      const entry = fresh.openDialog(wrapper, { onEscape: () => fresh.closeDialog() });
      keyOn(document.activeElement, 'Escape');
      fresh.closeDialog(entry);
    }
    const keydownAdds = add.mock.calls.filter(([type]) => type === 'keydown');
    const keydownRemoves = remove.mock.calls.filter(([type]) => type === 'keydown');
    expect(keydownAdds).toHaveLength(1);
    expect(keydownRemoves).toHaveLength(0);
    add.mockRestore();
    remove.mockRestore();
  });
});

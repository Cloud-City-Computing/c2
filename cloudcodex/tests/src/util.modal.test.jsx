/**
 * Cloud Codex — Tests for src/util.jsx modal/dropdown helpers and
 * attemptAutoLogin. Split from util.test.js because these need DOM
 * scaffolding (#modal-root, #modal-dimmer, #dropdown-root) and React
 * roots, which are heavier to set up.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import {
  showModal,
  destroyModal,
  hideModalDimmer,
  showModalDimmer,
  showDropdownMenu,
  attemptAutoLogin,
  setSessStorage,
  serverReq,
} from '../../src/util.jsx';

let dimmer, modalRoot, dropdownRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  dimmer = document.createElement('div');
  dimmer.id = 'modal-dimmer';
  modalRoot = document.createElement('div');
  modalRoot.id = 'modal-root';
  dropdownRoot = document.createElement('div');
  dropdownRoot.id = 'dropdown-root';
  document.body.append(dimmer, modalRoot, dropdownRoot);
});

afterEach(() => {
  // A modal left open would hold the dialog stack, the overlay and the opener claim into the next test.
  destroyModal();
  vi.unstubAllGlobals();
});


describe('hideModalDimmer / showModalDimmer / destroyModal', () => {
  it('hideModalDimmer is a no-op when there is no dimmer', () => {
    dimmer.remove();
    expect(() => hideModalDimmer()).not.toThrow();
  });

  it('showModalDimmer makes the dimmer visible and wires the close click', () => {
    const onClose = vi.fn();
    showModalDimmer(onClose);
    expect(dimmer.style.display).toBe('block');

    dimmer.click();
    expect(onClose).toHaveBeenCalled();
    expect(dimmer.style.display).toBe('none');
  });

  it('showModalDimmer is a no-op when there is no dimmer in the DOM', () => {
    dimmer.remove();
    expect(() => showModalDimmer(vi.fn())).not.toThrow();
  });

  it('destroyModal clears the modal root and hides the dimmer', async () => {
    await act(async () => { showModal(<div data-testid="content">hi</div>); });
    expect(modalRoot.children.length).toBeGreaterThan(0);

    destroyModal();
    expect(modalRoot.children.length).toBe(0);
    expect(dimmer.style.display).toBe('none');
  });

  it('destroyModal handles a missing modal-root element', () => {
    modalRoot.remove();
    expect(() => destroyModal()).not.toThrow();
  });
});

describe('showModal', () => {
  it('renders content into #modal-root and shows the dimmer', async () => {
    await act(async () => { showModal(<div data-testid="m">hello</div>); });
    expect(modalRoot.querySelector('[data-testid="m"]')).not.toBeNull();
    expect(dimmer.style.display).toBe('block');
  });

  it('applies the extra class to the wrapper', async () => {
    await act(async () => { showModal(<div>x</div>, 'big-modal'); });
    expect(modalRoot.querySelector('.modal-content-wrapper.big-modal')).not.toBeNull();
  });

  it('Escape key closes the modal', async () => {
    await act(async () => { showModal(<div data-testid="m">hi</div>); });
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(modalRoot.children.length).toBe(0);
  });

  it('is a no-op when there is no #modal-root', () => {
    modalRoot.remove();
    expect(() => showModal(<div>x</div>)).not.toThrow();
  });

  it('is a role dialog, aria-modal, named by its heading', async () => {
    await act(async () => { showModal(<div><h2>Delete archive?</h2><button>Delete</button></div>); });
    const wrapper = modalRoot.querySelector('.modal-content-wrapper');
    expect(wrapper.getAttribute('role')).toBe('dialog');
    expect(wrapper.getAttribute('aria-modal')).toBe('true');
    const heading = wrapper.querySelector('h2');
    expect(wrapper.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.id).not.toBe('');
  });

  it('takes an explicit labelledBy over the heading', async () => {
    await act(async () => { showModal(<div><h2 id="given">Named</h2></div>, '', { labelledBy: 'given' }); });
    expect(modalRoot.querySelector('.modal-content-wrapper').getAttribute('aria-labelledby')).toBe('given');
  });

  it('moves focus into the modal on open, and back to the opener on close', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'open';
    document.body.appendChild(opener);
    opener.focus();
    await act(async () => { showModal(<div><button className="close-button" aria-label="Close">×</button><input data-testid="field" /></div>); });
    expect(document.activeElement.getAttribute('data-testid')).toBe('field');
    expect(modalRoot.contains(document.activeElement)).toBe(true);
    await act(async () => { destroyModal(); });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('traps Tab inside the modal, both ways', async () => {
    await act(async () => { showModal(<div><button>first</button><button>last</button></div>); });
    const [first, last] = modalRoot.querySelectorAll('button');
    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    first.dispatchEvent(back);
    expect(document.activeElement).toBe(last);
  });

  it('makes #root inert while open, and clears it after close, including across a replacement', async () => {
    const appRoot = document.createElement('div');
    appRoot.id = 'root';
    document.body.appendChild(appRoot);
    await act(async () => { showModal(<div><button>one</button></div>); });
    expect(appRoot.hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => { showModal(<div><button>two</button></div>); });
    await act(async () => { destroyModal(); });
    expect(appRoot.hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('');
    appRoot.remove();
  });

  it('adds one keydown listener to the document, however many modals open and close', async () => {
    vi.resetModules();
    const fresh = await import('../../src/util.jsx');
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    for (let i = 0; i < 2; i += 1) {
      await act(async () => { fresh.showModal(<div>x</div>); });
      await act(async () => { dimmer.click(); });
    }
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    expect(remove.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe('showDropdownMenu', () => {
  it('renders content into #dropdown-root and shows the dimmer', async () => {
    await act(async () => { showDropdownMenu(<button>menu item</button>); });
    expect(dropdownRoot.querySelector('.dropdown-content-wrapper')).not.toBeNull();
    expect(dropdownRoot.style.display).toBe('block');
    expect(dimmer.style.display).toBe('block');
  });

  it('clicking the dimmer hides the dropdown', async () => {
    await act(async () => { showDropdownMenu(<button>menu</button>); });
    dimmer.click();
    expect(dropdownRoot.style.display).toBe('none');
  });

  it('is a no-op when there is no #dropdown-root', () => {
    dropdownRoot.remove();
    expect(() => showDropdownMenu(<div>x</div>)).not.toThrow();
  });
});

describe('attemptAutoLogin', () => {
  it('returns the cached user without a network call', async () => {
    setSessStorage('currentUser', { id: 1, name: 'Alice' });
    vi.stubGlobal('fetch', vi.fn());
    const user = await attemptAutoLogin('any-token');
    expect(user).toEqual({ id: 1, name: 'Alice' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns null without calling the API when no token and no cache', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await attemptAutoLogin(null)).toBeNull();
    expect(await attemptAutoLogin(undefined)).toBeNull();
    expect(await attemptAutoLogin('')).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('validates with the server, caches the user, and returns it on success', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ valid: true, user: { id: 7, name: 'Bob' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const user = await attemptAutoLogin('tok');
    expect(user).toEqual({ id: 7, name: 'Bob' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/validate-session',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns null when the server says invalid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ valid: false }),
    })));
    expect(await attemptAutoLogin('tok')).toBeNull();
  });

  it('verifies serverReq is wired (sanity)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: 1 }) })));
    expect(await serverReq('GET', '/x')).toEqual({ ok: 1 });
  });
});

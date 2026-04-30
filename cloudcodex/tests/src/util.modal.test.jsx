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
  vi.unstubAllGlobals();
});

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

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
    showModal(<div data-testid="content">hi</div>);
    await flush();
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
    showModal(<div data-testid="m">hello</div>);
    await flush();
    expect(modalRoot.querySelector('[data-testid="m"]')).not.toBeNull();
    expect(dimmer.style.display).toBe('block');
  });

  it('applies the extra class to the wrapper', async () => {
    showModal(<div>x</div>, 'big-modal');
    await flush();
    expect(modalRoot.querySelector('.modal-content-wrapper.big-modal')).not.toBeNull();
  });

  it('Escape key closes the modal', async () => {
    showModal(<div data-testid="m">hi</div>);
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(modalRoot.children.length).toBe(0);
  });

  it('is a no-op when there is no #modal-root', () => {
    modalRoot.remove();
    expect(() => showModal(<div>x</div>)).not.toThrow();
  });
});

describe('showDropdownMenu', () => {
  it('renders content into #dropdown-root and shows the dimmer', async () => {
    showDropdownMenu(<button>menu item</button>);
    await flush();
    expect(dropdownRoot.querySelector('.dropdown-content-wrapper')).not.toBeNull();
    expect(dropdownRoot.style.display).toBe('block');
    expect(dimmer.style.display).toBe('block');
  });

  it('clicking the dimmer hides the dropdown', async () => {
    showDropdownMenu(<button>menu</button>);
    await flush();
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

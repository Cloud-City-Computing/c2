/**
 * Cloud Codex - The search palette (W6-CDX-40, X13): Ctrl K, documents and archives, focus and Escape
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  apiFetch: vi.fn(),
  docUrl: (doc) => `/archives/${doc.archive_id}/doc/${doc.id}`,
}));

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { apiFetch } from '../../../src/util.jsx';
import SearchPalette from '../../../src/components/SearchPalette.jsx';
import { openDialog, closeDialog } from '../../../src/lib/dialog.js';
import { openOverlayCount } from '../../../src/lib/overlay.js';

const DOCS = [{ id: 11, title: 'API Overview', author: 'alice', archive_id: 3 }];
const ARCHIVES = [
  { id: 3, name: 'Engineering Handbook' },
  { id: 4, name: 'Field Notes' },
];

function serve() {
  apiFetch.mockImplementation((method, url) => {
    if (url.startsWith('/api/search')) return Promise.resolve({ results: DOCS });
    if (url === '/api/archives') return Promise.resolve({ success: true, archives: ARCHIVES });
    return Promise.resolve({});
  });
}

function renderPalette() {
  return render(
    <MemoryRouter>
      <SearchPalette />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  serve();
});

describe('the search palette opens and closes', () => {
  it('opens on Ctrl K and on Meta K, as a modal dialog', async () => {
    renderPalette();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: /search or jump to/i });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('closes on Escape and returns focus to the trigger that opened it', async () => {
    const user = userEvent.setup();
    renderPalette();
    const trigger = document.querySelector('.search-trigger') ?? document.body;
    await act(async () => { trigger.focus(); });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('moves focus into the input when it opens', async () => {
    renderPalette();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    await screen.findByRole('dialog');
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    renderPalette();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog');
    await user.type(screen.getByRole('searchbox'), 'api');
    await screen.findByRole('link', { name: /API Overview/ });
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});

describe('searching', () => {
  it('lists documents from the search API and archives by name', async () => {
    const user = userEvent.setup();
    renderPalette();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    await screen.findByRole('dialog');
    await user.type(screen.getByRole('searchbox'), 'eng');
    expect(await screen.findByRole('link', { name: /API Overview/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Engineering Handbook/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Field Notes/ })).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith('GET', '/api/search?query=eng');
  });

  it('shows no results for an empty query and does not ask the server', async () => {
    renderPalette();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    await screen.findByRole('dialog');
    expect(apiFetch.mock.calls.filter(([, url]) => url?.startsWith('/api/search'))).toEqual([]);
  });

  it('Escape closes the palette wherever focus is, through the dialog stack', async () => {
    renderPalette();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(openOverlayCount()).toBe(0);
  });
});

describe('the palette is a dialog in the stack', () => {
  it('Ctrl K is a no-op while another modal is open, and opens the palette once it closes', async () => {
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    wrapper.innerHTML = '<button>inside</button>';
    renderPalette();
    const modal = openDialog(wrapper, { opener: document.body });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: /search or jump to/i })).toBeNull();
    closeDialog(modal);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: /search or jump to/i })).toBeTruthy();
    wrapper.remove();
  });

  it('Ctrl K is left to the browser inside an editable field', async () => {
    renderPalette();
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    field.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    field.remove();
  });

  it('while open, the page behind it is inert, and the palette itself is not', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    renderPalette();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    await screen.findByRole('dialog');
    expect(root.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('dialog').closest('[inert]')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(root.hasAttribute('inert')).toBe(false));
    root.remove();
  });

  it('a result click closes the palette and sends focus to the page, not to nothing', async () => {
    const main = document.createElement('main');
    main.className = 'main-content';
    document.body.appendChild(main);
    const user = userEvent.setup();
    renderPalette();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    await user.type(await screen.findByRole('searchbox'), 'api');
    await user.click(await screen.findByRole('link', { name: /API Overview/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(main));
    main.remove();
  });

  it('closes when the session notice is about to appear, so the two dialogs never stack', async () => {
    renderPalette();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    await screen.findByRole('dialog');
    window.dispatchEvent(new Event('c2:close-overlays'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

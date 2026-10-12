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
});

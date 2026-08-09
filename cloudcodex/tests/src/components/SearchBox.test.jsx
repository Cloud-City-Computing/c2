/**
 * Cloud Codex — Tests for src/components/SearchBox.jsx
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Real docUrl, so the href assertions pin the actual URL contract rather than
// a fixture that would agree with a wrong implementation.
vi.mock('../../../src/util.jsx', async () => {
  const actual = await vi.importActual('../../../src/util.jsx');
  return { ...actual, apiFetch: vi.fn() };
});

// No useNavigate mock: SearchBox navigates through <Link> now, and the URL it
// builds is pinned by the href assertions instead.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { apiFetch } from '../../../src/util.jsx';
import SearchBox from '../../../src/components/SearchBox.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  apiFetch.mockReset();
});

describe('SearchBox — non-inline mode', () => {
  it('renders a search button and label', () => {
    wrap(<SearchBox />);
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/search for documents/i)).toBeInTheDocument();
  });

  it('calls /api/search?query= when the button is clicked', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ results: [] });
    wrap(<SearchBox />);

    await user.type(screen.getByLabelText(/search for documents/i), 'hello world');
    await user.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('GET', `/api/search?query=${encodeURIComponent('hello world')}`);
    });
  });

  it('does not call apiFetch when the query is empty', async () => {
    const user = userEvent.setup();
    wrap(<SearchBox />);
    await user.click(screen.getByRole('button', { name: /search/i }));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('forwards results to onResults when provided', async () => {
    const onResults = vi.fn();
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ results: [{ id: 1, title: 'A' }] });

    wrap(<SearchBox onResults={onResults} />);
    await user.type(screen.getByLabelText(/search for documents/i), 'q');
    await user.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => expect(onResults).toHaveBeenCalledWith([{ id: 1, title: 'A' }]));
  });

  it('triggers search on Enter keypress', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ results: [] });
    wrap(<SearchBox />);

    const input = screen.getByLabelText(/search for documents/i);
    await user.type(input, 'ham');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
  });
});

describe('SearchBox — inline mode', () => {
  it('shows the dropdown after a successful search with results', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({
      results: [{ id: 7, title: 'Doc seven', author: 'Alice' }],
    });

    const { container } = wrap(<SearchBox inline />);
    const input = container.querySelector('input.search-input');
    await user.type(input, 'seven');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(container.querySelector('.search-dropdown')).not.toBeNull();
      expect(screen.getByText('Doc seven')).toBeInTheDocument();
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  it('clicking a result clears the input and closes the dropdown', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ results: [{ id: 9, title: 'Nine', author: 'X' }] });

    const { container } = wrap(<SearchBox inline />);
    const input = container.querySelector('input.search-input');
    await user.type(input, 'nine');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('Nine')).toBeInTheDocument());

    await user.click(screen.getByRole('link', { name: /Nine/ }));
    expect(input.value).toBe('');
  });

  // B13: the dropdown results were click-only <div onMouseDown> nodes, and the
  // input's blur timeout tore the dropdown down before focus could reach them,
  // so no result was openable without a mouse. These three fail against that.
  it('each result is a link to the document', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ results: [{ id: 9, title: 'Nine', author: 'X', archive_id: 4 }] });

    const { container } = wrap(<SearchBox inline />);
    const input = container.querySelector('input.search-input');
    await user.type(input, 'nine');
    fireEvent.keyDown(input, { key: 'Enter' });

    const link = await screen.findByRole('link', { name: /Nine/ });
    expect(link.getAttribute('href')).toBe('/archives/4/doc/9');
  });

  it('Tab moves focus from the input onto the first result without closing the dropdown', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ results: [{ id: 9, title: 'Nine', author: 'X' }] });

    const { container } = wrap(<SearchBox inline />);
    const input = container.querySelector('input.search-input');
    await user.type(input, 'nine');
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('link', { name: /Nine/ });

    // Input -> search icon button -> first result.
    await user.tab();
    await user.tab();

    expect(document.activeElement).toBe(screen.getByRole('link', { name: /Nine/ }));
    expect(container.querySelector('.search-dropdown')).not.toBeNull();
  });

  it('closes the dropdown when focus leaves the search box entirely', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ results: [{ id: 9, title: 'Nine', author: 'X' }] });

    const { container } = wrap(
      <>
        <SearchBox inline />
        <button type="button">outside</button>
      </>
    );
    const input = container.querySelector('input.search-input');
    await user.type(input, 'nine');
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('link', { name: /Nine/ });

    await user.click(screen.getByRole('button', { name: 'outside' }));
    await waitFor(() => expect(container.querySelector('.search-dropdown')).toBeNull());
  });

  // Firefox and Safari do not focus a link on click. Without this, the input
  // would blur with a null relatedTarget, the dropdown would unmount before
  // mouseup, and the click would never reach the link. jsdom cannot reproduce
  // that difference, so pin the mechanism instead.
  it('a mouse press inside the dropdown is prevented, so it cannot blur the input', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ results: [{ id: 9, title: 'Nine', author: 'X' }] });

    const { container } = wrap(<SearchBox inline />);
    const input = container.querySelector('input.search-input');
    await user.type(input, 'nine');
    fireEvent.keyDown(input, { key: 'Enter' });
    const link = await screen.findByRole('link', { name: /Nine/ });

    // fireEvent returns false when the event was cancelled.
    expect(fireEvent.mouseDown(link)).toBe(false);
    expect(container.querySelector('.search-dropdown')).not.toBeNull();
  });

  // Focus is moved ONTO a result first. Pressing Escape while focus is still in
  // the input would make the activeElement assertion true no matter what the
  // implementation did, which is how this test was originally written and why
  // it could not fail.
  it('Escape closes the dropdown and returns focus to the input from a result', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ results: [{ id: 9, title: 'Nine', author: 'X' }] });

    const { container } = wrap(<SearchBox inline />);
    const input = container.querySelector('input.search-input');
    await user.type(input, 'nine');
    fireEvent.keyDown(input, { key: 'Enter' });
    const link = await screen.findByRole('link', { name: /Nine/ });

    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(link);

    await user.keyboard('{Escape}');
    expect(container.querySelector('.search-dropdown')).toBeNull();
    // The link that had focus is gone; without an explicit restore, focus falls
    // to <body> and the next Tab restarts from the top of the document.
    expect(document.activeElement).toBe(input);
  });

  it('a dismissed dropdown does not reopen when the input is refocused', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ results: [{ id: 9, title: 'Nine', author: 'X' }] });

    const { container } = wrap(
      <>
        <SearchBox inline />
        <button type="button">outside</button>
      </>
    );
    const input = container.querySelector('input.search-input');
    await user.type(input, 'nine');
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('link', { name: /Nine/ });

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'outside' }));
    await user.click(input);

    expect(container.querySelector('.search-dropdown')).toBeNull();
  });

  it('searching keeps focus inside the search box, so the dropdown stays dismissable', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ results: [{ id: 9, title: 'Nine', author: 'X' }] });

    const { container } = wrap(<SearchBox inline />);
    const input = container.querySelector('input.search-input');
    await user.type(input, 'nine');

    // Search via the magnifier button. Safari, and Firefox on macOS, do not
    // focus a button on mouse press, so the results open with focus on <body>,
    // where no focusout and no Escape can ever reach them. fireEvent.click is
    // what models that: unlike user.click it does no focus management, so the
    // button does not become activeElement the way it would in Chromium.
    input.blur();
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    await screen.findByRole('link', { name: /Nine/ });

    expect(document.activeElement).toBe(input);
  });

  it('clears results to [] on fetch error', async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValueOnce(new Error('500'));

    const { container } = wrap(<SearchBox inline />);
    const input = container.querySelector('input.search-input');
    await user.type(input, 'oops');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(container.querySelector('.search-dropdown')).toBeNull();
    });
  });
});

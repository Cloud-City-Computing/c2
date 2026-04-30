/**
 * Cloud Codex — Tests for src/components/SearchBox.jsx
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  apiFetch: vi.fn(),
  docUrl: vi.fn((doc) => `/editor/${doc.id}`),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { apiFetch } from '../../../src/util.jsx';
import SearchBox from '../../../src/components/SearchBox.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  apiFetch.mockReset();
  navigate.mockReset();
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

  it('clicking a result navigates and clears the input', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ results: [{ id: 9, title: 'Nine', author: 'X' }] });

    const { container } = wrap(<SearchBox inline />);
    const input = container.querySelector('input.search-input');
    await user.type(input, 'nine');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('Nine')).toBeInTheDocument());

    fireEvent.mouseDown(screen.getByText('Nine'));
    expect(navigate).toHaveBeenCalledWith('/editor/9');
    expect(input.value).toBe('');
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

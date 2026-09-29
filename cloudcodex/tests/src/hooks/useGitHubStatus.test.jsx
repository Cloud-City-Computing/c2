/**
 * Cloud Codex — Tests for src/hooks/useGitHubStatus.jsx
 *
 * Verifies the GitHubStatusProvider context: it fetches /api/github/status
 * once on mount, exposes connected/refresh through useGitHubStatus, and
 * skips the fetch when enabled is false.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  apiFetch: vi.fn(async () => ({ connected: true })),
}));

import { renderHook, waitFor, act } from '@testing-library/react';
import { apiFetch } from '../../../src/util.jsx';
import useGitHubStatus, { GitHubStatusProvider } from '../../../src/hooks/useGitHubStatus.jsx';
import React from 'react';

const wrapper = ({ children, enabled = true }) =>
  React.createElement(GitHubStatusProvider, { enabled }, children);

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ connected: true });
});

afterEach(() => vi.restoreAllMocks());

describe('useGitHubStatus', () => {
  it('returns null while the initial fetch is in flight, then true on success', async () => {
    let resolve;
    apiFetch.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useGitHubStatus(), { wrapper });

    expect(result.current.connected).toBeNull();
    await act(async () => { resolve({ connected: true }); });
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it('returns false on fetch error', async () => {
    apiFetch.mockRejectedValueOnce(new Error('500'));
    const { result } = renderHook(() => useGitHubStatus(), { wrapper });
    await waitFor(() => expect(result.current.connected).toBe(false));
  });

  it('returns false when connected !== true', async () => {
    apiFetch.mockResolvedValueOnce({ connected: false });
    const { result } = renderHook(() => useGitHubStatus(), { wrapper });
    await waitFor(() => expect(result.current.connected).toBe(false));
  });

  it('skips the fetch entirely and reports false when enabled=false', async () => {
    const Wrap = ({ children }) =>
      React.createElement(GitHubStatusProvider, { enabled: false }, children);
    const { result } = renderHook(() => useGitHubStatus(), { wrapper: Wrap });
    await waitFor(() => expect(result.current.connected).toBe(false));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  // Std_Layout enables the provider only once the auth check finds a user, so
  // a signed-out visitor never asks /api/github/status (it would answer 401).
  // The gap between enabling and the answer must read as unknown (null), not
  // as "not linked": the sidebar hides its GitHub link on false, and would
  // flash it away for every linked user on every page.
  it('reports false while disabled, then null until the first answer after enabling', async () => {
    let resolve;
    apiFetch.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    let enabled = false;
    const Wrap = ({ children }) => React.createElement(GitHubStatusProvider, { enabled }, children);
    const { result, rerender } = renderHook(() => useGitHubStatus(), { wrapper: Wrap });
    await waitFor(() => expect(result.current.connected).toBe(false));
    expect(apiFetch).not.toHaveBeenCalled();

    enabled = true;
    rerender();
    expect(result.current.connected).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith('GET', '/api/github/status');

    await act(async () => { resolve({ connected: true }); });
    expect(result.current.connected).toBe(true);
  });

  it('reports false again, and fetches nothing, once disabled', async () => {
    let enabled = true;
    const Wrap = ({ children }) => React.createElement(GitHubStatusProvider, { enabled }, children);
    const { result, rerender } = renderHook(() => useGitHubStatus(), { wrapper: Wrap });
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(apiFetch).toHaveBeenCalledTimes(1);

    enabled = false;
    rerender();
    expect(result.current.connected).toBe(false);
    await act(async () => { result.current.refresh(); });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('exposes a refresh function that re-fetches', async () => {
    apiFetch.mockResolvedValueOnce({ connected: false });
    const { result } = renderHook(() => useGitHubStatus(), { wrapper });
    await waitFor(() => expect(result.current.connected).toBe(false));

    apiFetch.mockResolvedValueOnce({ connected: true });
    await act(async () => { result.current.refresh(); });
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it('returns a default {connected: null, refresh: noop} when used without a provider', () => {
    const { result } = renderHook(() => useGitHubStatus());
    expect(result.current.connected).toBeNull();
    expect(typeof result.current.refresh).toBe('function');
    // Should not throw
    expect(() => result.current.refresh()).not.toThrow();
  });
});

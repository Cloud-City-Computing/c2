/**
 * Cloud Codex — Tests for src/hooks/usePresence.js
 *
 * Mocks src/util.fetchPresence and uses fake timers to verify that the
 * hook polls on the configured interval, exposes presence state, and
 * supports the getLogUsers helper.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  fetchPresence: vi.fn(async () => ({ success: true, presence: {} })),
}));

import { renderHook, waitFor, act } from '@testing-library/react';
import { fetchPresence } from '../../../src/util.jsx';
import usePresence from '../../../src/hooks/usePresence.js';

beforeEach(() => {
  fetchPresence.mockReset();
  fetchPresence.mockResolvedValue({ success: true, presence: {} });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePresence', () => {
  it('loads presence immediately on mount', async () => {
    fetchPresence.mockResolvedValueOnce({
      success: true,
      presence: { 7: [{ id: 1, name: 'Alice', color: '#fff' }] },
    });

    const { result } = renderHook(() => usePresence(8000));

    await waitFor(() => {
      expect(result.current.presence['7']).toBeDefined();
    });
    expect(fetchPresence).toHaveBeenCalledTimes(1);
  });

  it('polls again after the interval elapses', async () => {
    fetchPresence
      .mockResolvedValueOnce({ success: true, presence: { '1': [] } })
      .mockResolvedValueOnce({ success: true, presence: { '1': [{ id: 1 }] } });

    renderHook(() => usePresence(1000));

    await waitFor(() => expect(fetchPresence).toHaveBeenCalledTimes(1));
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    await waitFor(() => expect(fetchPresence).toHaveBeenCalledTimes(2));
  });

  it('silently swallows fetch errors (presence is best-effort)', async () => {
    fetchPresence.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => usePresence(8000));
    await waitFor(() => expect(fetchPresence).toHaveBeenCalled());
    // Default state is {} and stays that way after an error.
    expect(result.current.presence).toEqual({});
  });

  it('does not update state when response has success:false', async () => {
    fetchPresence.mockResolvedValueOnce({ success: false });
    const { result } = renderHook(() => usePresence(8000));
    await waitFor(() => expect(fetchPresence).toHaveBeenCalled());
    expect(result.current.presence).toEqual({});
  });

  it('getLogUsers returns the list for a given logId (string or number)', async () => {
    fetchPresence.mockResolvedValueOnce({
      success: true,
      presence: { '42': [{ id: 1, name: 'Alice' }] },
    });

    const { result } = renderHook(() => usePresence(8000));
    await waitFor(() => expect(result.current.presence['42']).toBeDefined());

    expect(result.current.getLogUsers(42)).toEqual([{ id: 1, name: 'Alice' }]);
    expect(result.current.getLogUsers('42')).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('getLogUsers returns [] for an unknown logId', async () => {
    const { result } = renderHook(() => usePresence(8000));
    await waitFor(() => expect(fetchPresence).toHaveBeenCalled());
    expect(result.current.getLogUsers(99999)).toEqual([]);
  });

  it('clears the interval on unmount', async () => {
    const { unmount } = renderHook(() => usePresence(1000));
    await waitFor(() => expect(fetchPresence).toHaveBeenCalledTimes(1));
    unmount();
    fetchPresence.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetchPresence).not.toHaveBeenCalled();
  });
});

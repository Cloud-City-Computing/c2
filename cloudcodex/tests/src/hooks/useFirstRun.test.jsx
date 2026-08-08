/**
 * Cloud Codex - Tests for src/hooks/useFirstRun.js
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  getFirstRun: vi.fn(async () => ({ success: true, needsOnboarding: false })),
  completeFirstRun: vi.fn(async () => ({ success: true })),
}));

import { renderHook, waitFor, act } from '@testing-library/react';
import { getFirstRun, completeFirstRun } from '../../../src/util.jsx';
import useFirstRun from '../../../src/hooks/useFirstRun.js';

beforeEach(() => {
  getFirstRun.mockReset();
  completeFirstRun.mockReset();
  getFirstRun.mockResolvedValue({ success: true, needsOnboarding: false });
  completeFirstRun.mockResolvedValue({ success: true });
});

describe('useFirstRun', () => {
  it('fetches once on mount and exposes the payload', async () => {
    const payload = { success: true, needsOnboarding: true, isAdmin: true, squad: { id: 3, name: 'General' } };
    getFirstRun.mockResolvedValueOnce(payload);

    const { result } = renderHook(() => useFirstRun());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.firstRun).toEqual(payload);
    expect(getFirstRun).toHaveBeenCalledTimes(1);
  });

  it('leaves firstRun null when the fetch fails', async () => {
    getFirstRun.mockRejectedValueOnce(new Error('500'));

    const { result } = renderHook(() => useFirstRun());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.firstRun).toBeNull();
  });

  it('complete() clears the payload and calls the endpoint', async () => {
    getFirstRun.mockResolvedValueOnce({ success: true, needsOnboarding: true });

    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.complete(); });

    expect(result.current.firstRun).toBeNull();
    expect(completeFirstRun).toHaveBeenCalledTimes(1);
  });

  it('complete() still dismisses locally when the endpoint fails', async () => {
    getFirstRun.mockResolvedValueOnce({ success: true, needsOnboarding: true });
    completeFirstRun.mockRejectedValueOnce(new Error('500'));

    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.complete(); });

    expect(result.current.firstRun).toBeNull();
  });

  it('does not update state after unmount when the fetch resolves late', async () => {
    let resolveFetch;
    getFirstRun.mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderHook(() => useFirstRun());
    unmount();
    await act(async () => { resolveFetch({ success: true, needsOnboarding: true }); });

    // No "state update on an unmounted component" warning means the guard worked.
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does not update state after unmount when the fetch rejects late', async () => {
    let rejectFetch;
    getFirstRun.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFetch = reject; }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderHook(() => useFirstRun());
    unmount();
    await act(async () => { rejectFetch(new Error('500')); });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

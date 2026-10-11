/**
 * Cloud Codex - useSuite asks for the suite name always and the Cloud Command URL only when signed in
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../src/util.jsx', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../../../src/util.jsx';
import useSuite, { __resetSuiteCache } from '../../../src/hooks/useSuite.js';

const USER = { id: 1, name: 'Alice' };

beforeEach(() => {
  vi.clearAllMocks();
  __resetSuiteCache();
});

describe('useSuite', () => {
  it('reads /api/suite and asks for no links when no one is signed in', async () => {
    apiFetch.mockResolvedValue({ enabled: true, name: 'Example Suite' });
    const { result } = renderHook(() => useSuite(null));
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(result.current).toEqual({ enabled: true, name: 'Example Suite', commandWorkspaceUrl: null });
    expect(apiFetch.mock.calls.map(([, url]) => url)).toEqual(['/api/suite']);
  });

  it('adds the Cloud Command URL for a signed-in user when suite mode is on', async () => {
    apiFetch.mockImplementation(async (_m, url) => (url === '/api/suite'
      ? { enabled: true, name: 'Example Suite' }
      : { commandWorkspaceUrl: 'https://command.example.test/w/1' }));
    const { result } = renderHook(() => useSuite(USER));
    await waitFor(() => expect(result.current.commandWorkspaceUrl).toBe('https://command.example.test/w/1'));
  });

  it('asks for no links when suite mode is off', async () => {
    apiFetch.mockResolvedValue({ enabled: false, name: null });
    const { result } = renderHook(() => useSuite(USER));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.enabled).toBe(false);
    expect(apiFetch.mock.calls.map(([, url]) => url)).toEqual(['/api/suite']);
  });

  it('is off when the request fails, and never throws', async () => {
    apiFetch.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useSuite(USER));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toEqual({ enabled: false, name: null, commandWorkspaceUrl: null });
  });
});

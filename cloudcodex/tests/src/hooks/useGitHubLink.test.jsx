/**
 * Cloud Codex — Tests for src/hooks/useGitHubLink.js
 *
 * Mocks the four util.jsx API helpers and exercises the load → pull →
 * push → resolve flow plus the 404 / 409-conflict edge cases.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  fetchGitHubLink: vi.fn(),
  fetchGitHubSyncStatus: vi.fn(),
  pullGitHub: vi.fn(),
  pushGitHub: vi.fn(),
  resolveGitHub: vi.fn(),
}));

import { renderHook, waitFor, act } from '@testing-library/react';
import {
  fetchGitHubLink,
  fetchGitHubSyncStatus,
  pullGitHub,
  pushGitHub,
  resolveGitHub,
} from '../../../src/util.jsx';
import useGitHubLink from '../../../src/hooks/useGitHubLink.js';

beforeEach(() => {
  fetchGitHubLink.mockReset();
  fetchGitHubSyncStatus.mockReset();
  pullGitHub.mockReset();
  pushGitHub.mockReset();
  resolveGitHub.mockReset();
});

describe('useGitHubLink', () => {
  it('clears link/status and skips fetches when logId is null', async () => {
    const { result } = renderHook(() => useGitHubLink(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.link).toBeNull();
    expect(result.current.status).toBeNull();
    expect(fetchGitHubLink).not.toHaveBeenCalled();
  });

  it('loads link and status on mount', async () => {
    fetchGitHubLink.mockResolvedValueOnce({ link: { id: 1, repo: 'x' } });
    fetchGitHubSyncStatus.mockResolvedValueOnce({ sync_status: 'clean' });

    const { result } = renderHook(() => useGitHubLink(7));
    await waitFor(() => {
      expect(result.current.link).toEqual({ id: 1, repo: 'x' });
      expect(result.current.status).toEqual({ sync_status: 'clean' });
    });
  });

  it('skips status fetch when no link exists', async () => {
    fetchGitHubLink.mockResolvedValueOnce({ link: null });
    const { result } = renderHook(() => useGitHubLink(7));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchGitHubSyncStatus).not.toHaveBeenCalled();
    expect(result.current.link).toBeNull();
    expect(result.current.status).toBeNull();
  });

  it('treats a 404 from the link endpoint as "no link" rather than error', async () => {
    fetchGitHubLink.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    const { result } = renderHook(() => useGitHubLink(7));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.link).toBeNull();
    expect(result.current.status).toBeNull();
  });

  it('exposes errors from non-404 failures', async () => {
    const err = Object.assign(new Error('500'), { status: 500 });
    fetchGitHubLink.mockRejectedValueOnce(err);
    const { result } = renderHook(() => useGitHubLink(7));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(err);
  });

  it('pull triggers the API call and refreshes', async () => {
    fetchGitHubLink.mockResolvedValue({ link: { id: 1 } });
    fetchGitHubSyncStatus.mockResolvedValue({ sync_status: 'clean' });
    pullGitHub.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useGitHubLink(7));
    await waitFor(() => expect(result.current.link).not.toBeNull());

    let pullResult;
    await act(async () => {
      pullResult = await result.current.pull('merge');
    });
    expect(pullResult).toEqual({ ok: true });
    expect(pullGitHub).toHaveBeenCalledWith(7, 'merge');
  });

  it('pull with a 409 conflict response sets `conflict` state', async () => {
    fetchGitHubLink.mockResolvedValue({ link: { id: 1 } });
    fetchGitHubSyncStatus.mockResolvedValue({ sync_status: 'diverged' });

    const conflictBody = {
      conflicts: [{ start: 1, end: 2 }],
      merged_with_markers: '...',
      base_sha: 'base',
      remote_sha: 'remote',
      ours: 'ours-html',
      theirs: 'theirs-html',
    };
    pullGitHub.mockRejectedValueOnce(Object.assign(new Error('Conflict'), {
      status: 409,
      body: conflictBody,
    }));

    const { result } = renderHook(() => useGitHubLink(7));
    await waitFor(() => expect(result.current.link).not.toBeNull());

    await act(async () => {
      await expect(result.current.pull()).rejects.toThrow('Conflict');
    });
    expect(result.current.conflict).toMatchObject({
      conflicts: conflictBody.conflicts,
      base_sha: 'base',
      remote_sha: 'remote',
    });
  });

  it('clearConflict resets conflict state to null', async () => {
    fetchGitHubLink.mockResolvedValue({ link: { id: 1 } });
    fetchGitHubSyncStatus.mockResolvedValue({});

    const { result } = renderHook(() => useGitHubLink(7));
    await waitFor(() => expect(result.current.link).not.toBeNull());

    pullGitHub.mockRejectedValueOnce(Object.assign(new Error('Conflict'), {
      status: 409,
      body: { conflicts: [1] },
    }));
    await act(async () => {
      await expect(result.current.pull()).rejects.toThrow();
    });
    expect(result.current.conflict).not.toBeNull();

    act(() => result.current.clearConflict());
    expect(result.current.conflict).toBeNull();
  });

  it('push throws when logId is null', async () => {
    const { result } = renderHook(() => useGitHubLink(null));
    await act(async () => {
      await expect(result.current.push({})).rejects.toThrow('No logId');
    });
  });

  it('resolve clears conflict and refreshes', async () => {
    fetchGitHubLink.mockResolvedValue({ link: { id: 1 } });
    fetchGitHubSyncStatus.mockResolvedValue({});
    resolveGitHub.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useGitHubLink(7));
    await waitFor(() => expect(result.current.link).not.toBeNull());

    // Seed a conflict via pull failure
    pullGitHub.mockRejectedValueOnce(Object.assign(new Error('C'), {
      status: 409,
      body: { conflicts: [1] },
    }));
    await act(async () => {
      await expect(result.current.pull()).rejects.toThrow();
    });
    expect(result.current.conflict).not.toBeNull();

    await act(async () => {
      await result.current.resolve({ html: 'resolved' });
    });
    expect(resolveGitHub).toHaveBeenCalledWith(7, { html: 'resolved' });
    expect(result.current.conflict).toBeNull();
  });

  it('triggers refresh when an external github-pulled event is received', async () => {
    fetchGitHubLink.mockResolvedValue({ link: { id: 1 } });
    fetchGitHubSyncStatus.mockResolvedValue({});

    const remoteEventsRef = { current: { onGithubPulled: null } };
    const { result } = renderHook(() => useGitHubLink(7, { remoteEventsRef }));
    await waitFor(() => expect(result.current.link).not.toBeNull());

    fetchGitHubLink.mockClear();
    fetchGitHubSyncStatus.mockClear();

    // Simulate an external pull broadcast
    await act(async () => {
      remoteEventsRef.current.onGithubPulled?.();
    });
    await waitFor(() => expect(fetchGitHubLink).toHaveBeenCalled());
  });
});

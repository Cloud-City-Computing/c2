/**
 * Cloud Codex - GitHub Sync Hook
 *
 * Manages a single document's link to GitHub: status polling on doc open,
 * explicit pull/push/resolve actions, and live "github-pulled" updates
 * pushed by other collaborators via the collab WebSocket.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchGitHubLink,
  fetchGitHubSyncStatus,
  pullGitHub,
  pushGitHub,
  resolveGitHub,
} from '../util';

/**
 * @param {number|null} logId - the document being edited
 * @param {{ remoteEventsRef?: { current: { onGithubPulled: ((msg: object) => void) | null } } }} [opts]
 * @returns {{
 *   link: object|null,
 *   status: object|null,
 *   loading: boolean,
 *   error: object|null,
 *   refresh: () => Promise<void>,
 *   pull: (strategy?: string) => Promise<object>,
 *   push: (payload: object) => Promise<object>,
 *   resolve: (payload: object) => Promise<object>,
 *   conflict: object|null,
 *   clearConflict: () => void,
 * }}
 */
export default function useGitHubLink(logId, opts = {}) {
  const [link, setLink] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!logId) {
      setLink(null);
      setStatus(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const linkRes = await fetchGitHubLink(logId);
      if (!mountedRef.current) return;
      setLink(linkRes.link || null);
      if (!linkRes.link) {
        setStatus(null);
        return;
      }
      const statusRes = await fetchGitHubSyncStatus(logId);
      if (!mountedRef.current) return;
      setStatus(statusRes);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err);
      // 404 from /status just means there is no link — that's not an error.
      if (err?.status === 404) {
        setLink(null);
        setStatus(null);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [logId]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  // Listen for "github-pulled" events broadcast by the collab WS so other
  // users' pulls invalidate our local view immediately.
  useEffect(() => {
    if (!opts.remoteEventsRef) return undefined;
    const ref = opts.remoteEventsRef;
    const prev = ref.current?.onGithubPulled || null;
    if (!ref.current) ref.current = { onGithubPulled: null };
    ref.current.onGithubPulled = () => { refresh(); };
    return () => {
      if (ref.current) ref.current.onGithubPulled = prev;
    };
  }, [opts.remoteEventsRef, refresh]);

  const pull = useCallback(async (strategy = 'merge') => {
    if (!logId) throw new Error('No logId');
    setError(null);
    try {
      const res = await pullGitHub(logId, strategy);
      await refresh();
      return res;
    } catch (err) {
      if (err?.status === 409 && err?.body?.conflicts) {
        setConflict({
          conflicts: err.body.conflicts,
          merged_with_markers: err.body.merged_with_markers,
          base_sha: err.body.base_sha,
          remote_sha: err.body.remote_sha,
          ours: err.body.ours,
          theirs: err.body.theirs,
        });
      }
      throw err;
    }
  }, [logId, refresh]);

  const push = useCallback(async (payload) => {
    if (!logId) throw new Error('No logId');
    setError(null);
    const res = await pushGitHub(logId, payload);
    await refresh();
    return res;
  }, [logId, refresh]);

  const resolve = useCallback(async (payload) => {
    if (!logId) throw new Error('No logId');
    setError(null);
    const res = await resolveGitHub(logId, payload);
    setConflict(null);
    await refresh();
    return res;
  }, [logId, refresh]);

  const clearConflict = useCallback(() => setConflict(null), []);

  return {
    link,
    status,
    loading,
    error,
    refresh,
    pull,
    push,
    resolve,
    conflict,
    clearConflict,
  };
}

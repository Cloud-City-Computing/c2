/**
 * Cloud Codex - GitHub Connection Status Hook
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../util';

const GitHubStatusContext = createContext({ connected: null, refresh: () => {} });

/**
 * Provider that fetches GitHub connection status once and shares it
 * across the component tree. Wrap at the layout level.
 *
 * `enabled` is whether someone is signed in: the status route answers 401
 * otherwise, so a disabled provider asks nothing and reports false. The
 * state it leaves alone stays null until the first answer after enabling,
 * so that gap reads as unknown rather than as "not linked".
 */
export function GitHubStatusProvider({ enabled, children }) {
  const [connected, setConnected] = useState(null);

  const refresh = useCallback(() => {
    if (!enabled) return;
    apiFetch('GET', '/api/github/status')
      .then(res => setConnected(res.connected === true))
      .catch(() => setConnected(false));
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <GitHubStatusContext.Provider value={{ connected: enabled ? connected : false, refresh }}>
      {children}
    </GitHubStatusContext.Provider>
  );
}

/**
 * Returns { connected: boolean|null, refresh: () => void }.
 * `connected` is null while loading, then true/false.
 */
// eslint-disable-next-line react-refresh/only-export-components
export default function useGitHubStatus() {
  return useContext(GitHubStatusContext);
}

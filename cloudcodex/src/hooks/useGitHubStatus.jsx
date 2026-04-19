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
 */
export function GitHubStatusProvider({ enabled, children }) {
  const [connected, setConnected] = useState(null);

  const refresh = useCallback(() => {
    if (!enabled) { setConnected(false); return; }
    apiFetch('GET', '/api/github/status')
      .then(res => setConnected(res.connected === true))
      .catch(() => setConnected(false));
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <GitHubStatusContext.Provider value={{ connected, refresh }}>
      {children}
    </GitHubStatusContext.Provider>
  );
}

/**
 * Returns { connected: boolean|null, refresh: () => void }.
 * `connected` is null while loading, then true/false.
 */
export default function useGitHubStatus() {
  return useContext(GitHubStatusContext);
}

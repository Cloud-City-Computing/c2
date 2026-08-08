/**
 * Cloud Codex - First-run state for the welcome flow
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import { getFirstRun, completeFirstRun } from '../util';

/**
 * Fetches the first-run payload once per mount.
 *
 * A failure leaves `firstRun` null, which renders nothing: onboarding is
 * never allowed to gate the application.
 *
 * @returns {{firstRun: object|null, loading: boolean, complete: () => Promise<void>}}
 */
export default function useFirstRun() {
  const [firstRun, setFirstRun] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getFirstRun()
      .then((res) => { if (!cancelled) setFirstRun(res); })
      .catch(() => { if (!cancelled) setFirstRun(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const complete = useCallback(async () => {
    // Dismiss locally first. The stamp is bookkeeping, and a failed request
    // must not leave the welcome stuck on screen.
    setFirstRun(null);
    try {
      await completeFirstRun();
    } catch { /* already dismissed locally; it will reappear once, at worst */ }
  }, []);

  return { firstRun, loading, complete };
}

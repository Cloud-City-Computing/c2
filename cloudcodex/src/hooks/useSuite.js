/**
 * Cloud Codex - Suite mode, as the server describes it
 *
 * GET /api/suite is public and says whether suite mode is on and the suite's name. The Cloud
 * Command URL comes from GET /api/suite/links, which needs a session, so it is asked for only
 * when someone is signed in and suite mode is on. Any failure reads as suite mode off: the
 * shell then keeps its plain brand, and nothing throws.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '../util.jsx';

const OFF = { enabled: false, name: null, commandWorkspaceUrl: null };

// One request per page load: the answer cannot change until the server restarts.
let suitePromise = null;

function loadSuite() {
  suitePromise ??= Promise.resolve()
    .then(() => apiFetch('GET', '/api/suite'))
    .then(
      (body) => (body?.enabled ? { enabled: true, name: body.name ?? null } : { ...OFF }),
      () => ({ ...OFF }),
    );
  return suitePromise;
}

/** Test seam: forget the cached answer so the next render asks again. */
export function __resetSuiteCache() {
  suitePromise = null;
}

/**
 * @param {object|null} user the signed-in user, or null
 * @returns {{ enabled: boolean, name: string|null, commandWorkspaceUrl: string|null }}
 */
export default function useSuite(user) {
  const [suite, setSuite] = useState(OFF);
  const [commandWorkspaceUrl, setCommandWorkspaceUrl] = useState(null);
  const enabled = suite.enabled;
  const signedIn = Boolean(user);

  useEffect(() => {
    let live = true;
    loadSuite().then((s) => {
      if (live) setSuite(s);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !signedIn) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => apiFetch('GET', '/api/suite/links'))
      .then((body) => {
        if (live && body?.commandWorkspaceUrl) setCommandWorkspaceUrl(body.commandWorkspaceUrl);
      }, () => {});
    return () => {
      live = false;
    };
  }, [enabled, signedIn]);

  return { ...suite, commandWorkspaceUrl: signedIn ? commandWorkspaceUrl : null };
}

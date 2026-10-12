/**
 * Cloud Codex - the Workspaces page's gate (W6-CDX-40, K9)
 *
 * In suite mode an instance is one workspace, so the Workspaces page is not offered and a visit to
 * /workspaces or /workspaces/:id goes to the home page. Outside suite mode the page renders as before. The answer
 * comes from the one cached GET /api/suite (useSuite), so this costs no request of its own.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { suiteEnabled } from '../hooks/useSuite.js';

export default function WorkspacesGate({ children }) {
  const [suiteOn, setSuiteOn] = useState(null);

  useEffect(() => {
    let live = true;
    suiteEnabled().then((on) => { if (live) setSuiteOn(on); });
    return () => { live = false; };
  }, []);

  if (suiteOn === null) return null;
  if (suiteOn) return <Navigate to="/" replace />;
  return children;
}

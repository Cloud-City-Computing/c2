/**
 * Cloud Codex - First-run gate
 *
 * Decides whether the welcome is shown. It holds no copy of its own, and it
 * renders JSX rather than driving the imperative modal helpers so both
 * variants stay reachable from tests.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import useFirstRun from '../hooks/useFirstRun';
import WelcomeSetup from './WelcomeSetup';

export default function FirstRunGate() {
  const { firstRun, loading, complete } = useFirstRun();

  if (loading || !firstRun?.needsOnboarding) return null;

  return (
    <div className="modal-dimmer first-run-dimmer">
      <div className="modal-content-wrapper">
        <WelcomeSetup firstRun={firstRun} onFinish={complete} />
      </div>
    </div>
  );
}

/**
 * Cloud Codex - First-run gate
 *
 * Decides whether the welcome is shown. It holds no copy of its own, and it
 * renders JSX rather than driving the imperative modal helpers so both
 * variants stay reachable from tests.
 *
 * The welcome is a dialog (lib/dialog.js), mounted on document.body rather than
 * inside the app root: the root is inert while any dialog is open, and the
 * welcome must not be inert itself. It is not dismissed by Escape, because it
 * has no close control: Get started completes it, and that is the only exit.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import useFirstRun from '../hooks/useFirstRun';
import WelcomeSetup from './WelcomeSetup';
import { openDialog, closeDialog } from '../lib/dialog.js';

export default function FirstRunGate() {
  const { firstRun, loading, complete } = useFirstRun();
  const wrapperRef = useRef(null);
  const open = !loading && Boolean(firstRun?.needsOnboarding);

  useEffect(() => {
    if (!open || !wrapperRef.current) return undefined;
    const entry = openDialog(wrapperRef.current);
    return () => closeDialog(entry);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="modal-dimmer first-run-dimmer">
      <div className="modal-content-wrapper" role="dialog" aria-modal="true" ref={wrapperRef}>
        <WelcomeSetup firstRun={firstRun} onFinish={complete} />
      </div>
    </div>,
    document.body,
  );
}

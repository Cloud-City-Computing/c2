/**
 * Cloud Codex - useDialog
 *
 * Gives a dialog that renders in the page the same contract as a showModal dialog (see
 * lib/dialog.js): role and aria-modal, focus in, Tab trapped, Escape, the app root inert, and
 * focus back to the opener on close. The dialog must be portalled out of the app root, or the
 * inert root freezes it.
 *
 * `onEscape` is read when Escape is pressed, so the closure is never stale. Pass `open` for a
 * dialog that mounts before its content is ready; it opens on the render that turns it on.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useRef, useState } from 'react';
import { openDialog, closeDialog } from '../lib/dialog.js';

export default function useDialog(ref, { open = true, onEscape } = {}) {
  const escape = useRef(onEscape);
  // Read before the first render, so an autoFocus inside the dialog cannot become its opener.
  const [opener] = useState(() => document.activeElement);

  useEffect(() => {
    escape.current = onEscape;
  });

  useEffect(() => {
    const node = ref.current;
    if (!open || !node) return undefined;
    const entry = openDialog(node, { onEscape: () => escape.current?.(), opener });
    return () => closeDialog(entry);
  }, [ref, open, opener]);
}

/**
 * Cloud Codex - Dialog contract
 *
 * What every modal in Codex does, for the imperative helpers in util.jsx and for the first-run
 * gate: role="dialog" and aria-modal, a name from its heading, focus in on open, Tab trapped,
 * Escape to the dialog's own close, the app root inert, and focus back to the opener on close.
 *
 * One keydown listener is installed for the life of the page and consults the current dialog,
 * so a modal that is dismissed by any route (Escape, the dimmer, a button) leaves nothing
 * behind. A dialog that replaces another keeps the overlay and the opener claim; only the
 * final close releases them.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { FOCUSABLE, trapTab } from './focus-trap.js';
import { declareOverlay } from './overlay.js';
import { rememberOpener, restoreOpener } from './focus-claim.js';

let current = null; // { wrapper, onEscape, release, observer }
let listening = false;
let seq = 0;

const stopsIn = (wrapper) => [...wrapper.querySelectorAll(FOCUSABLE)].filter((el) => el.closest('[inert]') === null);

// The first control that is not the close button: a form's first field, or a confirm's Cancel.
// The close button stays reachable by Tab, but it is not where a dialog starts.
function initialStop(wrapper) {
  return stopsIn(wrapper).find((el) => !el.classList.contains('close-button')) ?? wrapper;
}

function onKeydown(event) {
  if (!current) return;
  if (event.key === 'Escape') {
    if (!current.onEscape) return;
    event.preventDefault();
    current.onEscape();
    return;
  }
  if (event.key !== 'Tab') return;
  const { wrapper } = current;
  const active = document.activeElement;
  if (active === wrapper || !wrapper.contains(active)) {
    // Focus has left the dialog (it was on the page, or on the removed content): bring it back.
    event.preventDefault();
    const stops = stopsIn(wrapper);
    (event.shiftKey ? stops[stops.length - 1] : stops[0] ?? wrapper).focus();
    return;
  }
  trapTab(event, wrapper);
}

/**
 * Open a dialog over `wrapper`. Content may render after this call (React's root.render is
 * asynchronous), so the label and the initial focus are settled again whenever the wrapper's
 * children change, and the focus move happens once, on the first content.
 *
 * @returns the entry to pass to closeDialog, so a stale close cannot close a newer dialog.
 */
export function openDialog(wrapper, { labelledBy, onEscape } = {}) {
  if (!listening) {
    document.addEventListener('keydown', onKeydown);
    listening = true;
  }
  rememberOpener();
  const release = current ? current.release : declareOverlay();
  current?.observer.disconnect();

  wrapper.setAttribute('role', 'dialog');
  wrapper.setAttribute('aria-modal', 'true');
  if (!wrapper.hasAttribute('tabindex')) wrapper.tabIndex = -1;

  const entry = { wrapper, onEscape, release, observer: null };
  current = entry;
  let placed = false;

  const settle = () => {
    if (labelledBy) {
      wrapper.setAttribute('aria-labelledby', labelledBy);
    } else {
      const heading = wrapper.querySelector('h1, h2, h3');
      if (heading) {
        if (!heading.id) heading.id = `dialog-title-${seq += 1}`;
        wrapper.setAttribute('aria-labelledby', heading.id);
      }
    }
    if (!placed && wrapper.childElementCount > 0) {
      placed = true;
      if (!wrapper.contains(document.activeElement)) initialStop(wrapper).focus();
    }
  };

  entry.observer = new MutationObserver(settle);
  entry.observer.observe(wrapper, { childList: true, subtree: true });
  settle();
  return entry;
}

/**
 * Close the current dialog (or the given one, if it is still current): release the overlay and
 * focus the opener. The caller removes the wrapper's content first.
 */
export function closeDialog(entry = current) {
  if (!entry || entry !== current) return;
  current = null;
  entry.observer.disconnect();
  entry.release();
  restoreOpener();
}

/**
 * Cloud Codex - Dialog contract
 *
 * What every modal in Codex does, for the imperative helpers in util.jsx, for the first-run gate,
 * and for the dialogs that render in the page: role="dialog" and aria-modal, a name from its
 * heading, focus in on open, Tab trapped, Escape to the dialog's own close, the app root inert, and
 * focus back to the opener on close.
 *
 * Dialogs form a stack. Only the top one is trapped and receives Escape. Each open holds its own
 * overlay count, so closing an inner dialog leaves the root inert for the outer one, and when the
 * inner one closes focus goes back to the element it was opened from if that is still on the page,
 * otherwise into the dialog below. Only the last close restores the opener of the whole stack.
 *
 * One keydown listener is installed for the life of the page. A dialog whose wrapper has been
 * removed from the page (a replaced modal) is dropped the next time a dialog opens.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { FOCUSABLE, trapTab } from './focus-trap.js';
import { declareOverlay } from './overlay.js';
import { rememberOpener, restoreOpener } from './focus-claim.js';

// Bottom first. Each entry: { wrapper, onEscape, release, observer, placed, opener }.
const stack = [];
let listening = false;
let seq = 0;

const top = () => stack[stack.length - 1];

const stopsIn = (wrapper) => [...wrapper.querySelectorAll(FOCUSABLE)].filter((el) => el.closest('[inert]') === null);

// The first control that is not the close button: a form's first field, or a confirm's Cancel.
// The close button stays reachable by Tab, but it is not where a dialog starts.
function initialStop(wrapper) {
  return stopsIn(wrapper).find((el) => !el.classList.contains('close-button')) ?? wrapper;
}

function detach(entry) {
  const index = stack.indexOf(entry);
  if (index === -1) return false;
  stack.splice(index, 1);
  entry.observer.disconnect();
  entry.release();
  return true;
}

// Drop dialogs whose wrapper has left the page (a modal replaced by showModal) before a new one opens.
function prune() {
  for (const entry of [...stack]) {
    if (!entry.wrapper.isConnected) detach(entry);
  }
}

function onKeydown(event) {
  const current = top();
  if (!current) return;
  if (event.key === 'Escape') {
    // An Escape that belongs to an IME composition, or that a control inside the dialog already handled
    // (an editor popup, a menu), must not also close the dialog.
    if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
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
 * `opener` is the element focus should return to. It defaults to whatever is focused now; a caller
 * whose content may autoFocus before this call passes the element it captured earlier. An opener
 * inside the dialog, or <body>, is never used.
 *
 * @returns the entry to pass to closeDialog, so a stale close cannot close a newer dialog.
 */
export function openDialog(wrapper, { labelledBy, onEscape, opener = document.activeElement } = {}) {
  if (!listening) {
    document.addEventListener('keydown', onKeydown);
    listening = true;
  }
  prune();
  const candidate = opener && !wrapper.contains(opener) ? opener : null;
  if (stack.length === 0) rememberOpener(candidate ?? undefined);

  wrapper.setAttribute('role', 'dialog');
  wrapper.setAttribute('aria-modal', 'true');
  if (!wrapper.hasAttribute('tabindex')) wrapper.tabIndex = -1;

  const entry = { wrapper, onEscape, release: declareOverlay(), observer: null, placed: false, opener: candidate };

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
    if (!entry.placed && wrapper.childElementCount > 0) {
      entry.placed = true;
      if (!wrapper.contains(document.activeElement)) initialStop(wrapper).focus();
    }
  };

  entry.observer = new MutationObserver(settle);
  entry.observer.observe(wrapper, { childList: true, subtree: true });
  stack.push(entry);
  settle();
  return entry;
}

/**
 * Close a dialog: the top one by default. Closing the last dialog restores the page's opener;
 * closing an inner one puts focus back on the element it was opened from, or into the dialog below.
 */
export function closeDialog(entry = top()) {
  if (!entry || !stack.includes(entry)) return;
  const wasTop = entry === top();
  detach(entry);
  if (stack.length === 0) {
    restoreOpener();
    return;
  }
  if (!wasTop) return;
  const below = top();
  if (entry.opener?.isConnected && below.wrapper.contains(entry.opener)) {
    entry.opener.focus();
  } else if (!below.wrapper.contains(document.activeElement)) {
    initialStop(below.wrapper).focus();
  }
}

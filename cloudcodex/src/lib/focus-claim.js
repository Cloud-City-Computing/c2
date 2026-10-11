/**
 * Cloud Codex - Focus claim
 *
 * The element focus returns to when the modal stack empties. showModal replaces its content in
 * place, so the opener of the FIRST modal is the one to restore; a modal opened from inside a
 * modal must not overwrite it with a button that is about to be unmounted.
 *
 * If the opener has unmounted, focus goes to the first focusable control in the app root, which
 * is where a keyboard user would start on the page. Call restoreOpener after the overlay is
 * released, or the app root is still inert and has no stop to receive it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { FOCUSABLE } from './focus-trap.js';

let opener = null;

export function rememberOpener(element = document.activeElement) {
  if (opener === null && element instanceof HTMLElement) opener = element;
}

export function restoreOpener() {
  const target = opener;
  opener = null;
  if (target && target.isConnected) {
    target.focus();
    return;
  }
  document.getElementById('root')?.querySelector(FOCUSABLE)?.focus();
}

/**
 * Cloud Codex - Focus claim
 *
 * The element focus returns to when the dialog stack empties. showModal replaces its content in
 * place, so the opener of the FIRST modal is the one to restore; a modal opened from inside a
 * modal must not overwrite it with a button that is about to be unmounted.
 *
 * <body> and <html> are never a claim: focusing them does nothing, so they would leave focus
 * nowhere. An opener that is gone, or that cannot take focus (a plain div), falls back to the
 * first focusable control in the app root, which is where a keyboard user would start on the
 * page. Call restoreOpener after the overlay is released, or the app root is still inert and has
 * no stop to receive it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { FOCUSABLE } from './focus-trap.js';

let opener = null;

const claimable = (element) => element instanceof HTMLElement
  && element !== document.body
  && element !== document.documentElement;

export function rememberOpener(element = document.activeElement) {
  if (opener === null && claimable(element)) opener = element;
}

function focusFallback() {
  document.getElementById('root')?.querySelector(FOCUSABLE)?.focus();
}

export function restoreOpener() {
  const target = opener;
  opener = null;
  if (target && target.isConnected) {
    target.focus();
    if (document.activeElement && document.activeElement !== document.body) return;
  }
  focusFallback();
}

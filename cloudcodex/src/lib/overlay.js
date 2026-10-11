/**
 * Cloud Codex - Overlay counter
 *
 * While a modal is open the app root is inert and the page does not scroll. This is a counter,
 * not a boolean: a modal opened from inside another must not un-inert the page when the inner
 * one closes.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

let open = 0;
let savedOverflow = '';

export function declareOverlay(appRoot = document.getElementById('root')) {
  open += 1;
  if (open === 1) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  appRoot?.setAttribute('inert', '');
  let released = false;
  return function release() {
    if (released) return; // idempotent: two closes release once
    released = true;
    open -= 1;
    if (open === 0) {
      document.body.style.overflow = savedOverflow;
      appRoot?.removeAttribute('inert');
    }
  };
}

export const openOverlayCount = () => open;

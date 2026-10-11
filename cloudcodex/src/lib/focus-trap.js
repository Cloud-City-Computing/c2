/**
 * Cloud Codex - Focus trap
 *
 * A plain-JS port of the Cloud Command focus trap, for the imperative modal helpers in
 * util.jsx. Only the boundary presses are intercepted; the rest of Tab order is the browser's.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

// What counts as a Tab stop. `button:not([disabled])` is why an in-flight control should use
// aria-disabled: a real `disabled` on the focused button drops focus to <body> and the trap
// stops seeing Tab. `select` stays in the list because Codex's forms use it.
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), ' +
  'select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Keeps Tab inside `root`. The DOM is re-queried on every press, because a modal's controls
// change under it.
export function trapTab(event, root) {
  if (event.key !== 'Tab' || !root) return;
  const stops = [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.closest('[inert]') === null);
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return;
  const current = document.activeElement;
  if (event.shiftKey ? current === first : current === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

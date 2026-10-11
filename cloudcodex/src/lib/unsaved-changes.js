/**
 * Cloud Codex - Which editors on this page hold changes the server does not have
 *
 * An editor registers its unsaved state here (setUnsaved). The standard layout reads it when the session ends, so a
 * dead session with unsaved content shows the notice and does not navigate away; the unload guard asks before the
 * page goes while any editor is dirty. Each owner gives a getter for its text, which is what "Copy my changes" copies.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

const owners = new Map(); // owner key -> () => string, the owner's text for the copy fallback
let guardInstalled = false;

function onBeforeUnload(event) {
  if (owners.size === 0) return;
  event.preventDefault();
  event.returnValue = '';
}

// The guard is attached only while something is dirty, so a clean page is never in the way of a navigation.
function syncGuard() {
  const wanted = owners.size > 0;
  if (wanted === guardInstalled) return;
  guardInstalled = wanted;
  if (wanted) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
}

/**
 * Records whether an owner (an editor) has changes the server lacks.
 * @param {string} key the owner's name, one per editor
 * @param {boolean} dirty
 * @param {() => string} [getCopyText] the owner's current text, for the copy fallback
 */
export function setUnsaved(key, dirty, getCopyText = () => '') {
  if (dirty) owners.set(key, getCopyText);
  else owners.delete(key);
  syncGuard();
}

/** Whether any editor on the page holds changes the server does not have. */
export function hasUnsavedChanges() {
  return owners.size > 0;
}

/** The first dirty owner's text, or '' when nothing is unsaved. */
export function unsavedCopyText() {
  for (const getCopyText of owners.values()) {
    const text = getCopyText();
    if (text) return text;
  }
  return '';
}

/** Test seam: forget every owner and the guard. */
export function __resetUnsaved() {
  owners.clear();
  syncGuard();
}

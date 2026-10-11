/**
 * The deep link a signed-out visitor opened, kept until a sign-in returns to it (W6-CDX-26)
 *
 * Kept under one sessionStorage key. The value is always the validated target (services/return-to.js, the
 * one validator the server uses), so a hostile value is kept as "/". Storage that is refused, including a
 * getter that throws, is treated as absent: nothing is kept, nothing is read, and the caller carries on.
 * The key is cleared when the Login modal is dismissed (util.jsx destroyModal), so a later sign-in from "/"
 * does not jump to a stale deep link.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { safeReturnTo } from '../../services/return-to.js';

/** The sessionStorage key holding the validated deep link a sign-in returns to. */
export const SIGN_IN_TARGET_KEY = 'c2-sign-in-target';

/** window.sessionStorage, or null when reading it throws (blocked storage). Fail closed: callers treat null as refused. */
export function getStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Keeps the validated target. No storage, or storage that refuses the write, keeps nothing. */
export function keepSignInTarget(storage, target) {
  if (!storage) return;
  try {
    storage.setItem(SIGN_IN_TARGET_KEY, safeReturnTo(target));
  } catch {
    // Without storage the sign-in reloads the page it is on, which is the same deep link.
  }
}

/**
 * The kept target, validated again, or null. Read once: a successful sign-in forgets it.
 * @returns {string|null}
 */
export function takeSignInTarget(storage = getStorage()) {
  if (!storage) return null;
  try {
    const kept = storage.getItem(SIGN_IN_TARGET_KEY);
    storage.removeItem(SIGN_IN_TARGET_KEY);
    return kept === null ? null : safeReturnTo(kept);
  } catch {
    return null;
  }
}

/** Forgets the kept target. Called when the Login modal is dismissed. */
export function clearSignInTarget(storage = getStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(SIGN_IN_TARGET_KEY);
  } catch {
    // Storage that refuses the write kept nothing to forget.
  }
}

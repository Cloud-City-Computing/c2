/**
 * Cloud Codex - the signed-in user's inbox and archive list, kept for the page's lifetime (W6-CDX-40 review, item 8)
 *
 * Every page mounts its own layout, so the sidebar remounts on each navigation. Without a cache the unread pill and
 * the Archives group start empty and fill in a moment later, which reads as flicker. This module holds the last
 * values for one user, so a remount paints them at once and then refreshes. It is module state, so a reload starts
 * empty, and an entry is only ever returned for the user it was written for.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

let entry = null;

/** The cached values for this user, or null when there are none (or they belong to someone else). */
export function readInboxCache(userId) {
  if (userId === undefined || userId === null) return null;
  return entry !== null && entry.userId === userId ? entry : null;
}

/** Merges values into this user's entry. A different user's entry is replaced, not merged. */
export function writeInboxCache(userId, patch) {
  if (userId === undefined || userId === null) return;
  const base = entry !== null && entry.userId === userId ? entry : { userId };
  entry = { ...base, ...patch };
}

/** Forgets everything; used on sign-out and by tests. */
export function clearInboxCache() {
  entry = null;
}

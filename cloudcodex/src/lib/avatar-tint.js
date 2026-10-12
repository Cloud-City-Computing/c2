/**
 * Cloud Codex - the avatar tint (W6-CDX-39, Task 2.4): a stable index 1..8 from a hash of the user id, so one
 * person keeps one --avatar-N tint in every list.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/** FNV-1a over the id's text, mapped to 1..8. */
export function avatarTint(id) {
  const text = String(id ?? '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % 8) + 1;
}

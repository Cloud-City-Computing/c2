/**
 * Cloud Codex - one presence entry per user
 *
 * The collab server lists one entry per open connection, so a user with two tabs on a log appears twice.
 * Every presence list keeps the first entry for each user id, and the avatars key on that id. The avatar
 * takes the colour of the first connection listed (the server's order); a second tab's cursor may differ.
 * Entries with no id are not merged.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/**
 * @param {Array<{ id: number }>} [users]
 * @returns {Array} the same entries, without a later one for a user id already listed
 */
export function oneEntryPerUser(users) {
  const seen = new Set();
  return (users || []).filter((u) => {
    if (u.id === undefined || u.id === null) return true;
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });
}

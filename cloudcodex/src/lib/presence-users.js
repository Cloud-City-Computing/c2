/**
 * Cloud Codex - one presence entry per user
 *
 * The collab server lists one entry per open connection, so a user with two tabs on a log appears twice.
 * Every presence list keeps the first entry for each user id, and the avatars key on that id.
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
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });
}

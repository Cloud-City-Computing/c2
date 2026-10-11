/**
 * Cloud Codex - The Linked tasks address for a document, built from the suite's workspace URL
 *
 * Pure string work, kept out of the component file so that file exports only the component.
 * See src/components/SuiteDocLink.jsx for the link itself.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

const POSITIVE_INT = /^[1-9]\d*$/;

/**
 * The Linked tasks address for one document, or null when any input is unusable. The workspace
 * URL keeps its origin and path only (no query or fragment), and an id must be a positive integer,
 * so nothing from the page can reach the path as a second segment.
 *
 * @param {string|null} commandWorkspaceUrl
 * @param {number|string|null|undefined} archiveId
 * @param {number|string|null|undefined} logId
 * @returns {string|null}
 */
export function suiteDocHref(commandWorkspaceUrl, archiveId, logId) {
  if (!commandWorkspaceUrl) return null;
  const a = String(archiveId ?? '');
  const l = String(logId ?? '');
  if (!POSITIVE_INT.test(a) || !POSITIVE_INT.test(l)) return null;
  let base;
  try {
    base = new URL(commandWorkspaceUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  const path = base.pathname.replace(/\/+$/, '');
  return `${base.origin}${path}/docs/${a}/${l}`;
}

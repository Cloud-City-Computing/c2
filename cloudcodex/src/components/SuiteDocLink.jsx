/**
 * Cloud Codex - "Linked tasks": a suite-mode link from a document to its tasks in Cloud Command
 *
 * The link goes to Cloud Command's Linked tasks page for this document (W6-CMD-25), the route
 * /docs/<archiveId>/<logId> under the workspace URL from GET /api/suite/links. It is a plain
 * same-tab link: Cloud Command's sign-in keeps the deep link, so a signed-out click lands on the
 * page after sign-in. It renders nothing (not a dead link) outside suite mode, before the ids are
 * known, or when the URL is not an http(s) URL.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useSuiteLinks } from '../hooks/useSuite.js';

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

export default function SuiteDocLink({ archiveId, logId }) {
  const links = useSuiteLinks();
  const href = suiteDocHref(links?.commandWorkspaceUrl ?? null, archiveId, logId);
  if (href === null) return null;
  return <a className="suite-doc-link" href={href}>Linked tasks</a>;
}

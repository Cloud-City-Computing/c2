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
import { suiteDocHref } from '../lib/suite-doc-href.js';
import { getSessionTokenFromCookie } from '../util.jsx';

export default function SuiteDocLink({ archiveId, logId }) {
  // A signed-out viewer has no session cookie, so the links request is never made for them.
  const links = useSuiteLinks(Boolean(getSessionTokenFromCookie()));
  const href = suiteDocHref(links?.commandWorkspaceUrl ?? null, archiveId, logId);
  if (href === null) return null;
  return <a className="suite-doc-link" href={href}>Linked tasks</a>;
}

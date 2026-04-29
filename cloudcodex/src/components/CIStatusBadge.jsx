/**
 * Cloud Codex - CIStatusBadge
 *
 * Small pill showing the latest workflow run status for a branch on a
 * repo. Fetches via /api/github/repos/:owner/:repo/actions/runs?branch=
 * and re-uses the in-process server-side cache (60s TTL) so multiple
 * mounts of the same badge don't burn rate limit.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useRef, useState } from 'react';
import { fetchActionsRuns } from '../util';

const ICON = {
  success: '✓',
  failure: '✗',
  cancelled: '⊘',
  skipped: '–',
  in_progress: '◷',
  queued: '◷',
  unknown: '·',
};

function statusFromRun(run) {
  if (!run) return 'unknown';
  if (run.status === 'completed') return run.conclusion || 'unknown';
  return run.status || 'unknown';
}

export default function CIStatusBadge({ owner, repo, branch, compact = false }) {
  const [latest, setLatest] = useState(null);
  const [loading, setLoading] = useState(true);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!owner || !repo || !branch) {
      setLoading(false);
      return undefined;
    }
    cancelRef.current = false;
    setLoading(true);
    fetchActionsRuns(owner, repo, branch)
      .then((res) => { if (!cancelRef.current) setLatest(res.latest || null); })
      .catch(() => { if (!cancelRef.current) setLatest(null); })
      .finally(() => { if (!cancelRef.current) setLoading(false); });
    return () => { cancelRef.current = true; };
  }, [owner, repo, branch]);

  if (loading) return <span className="ci-badge ci-badge--loading" title="Checking CI…">·</span>;
  if (!latest) return null;

  const state = statusFromRun(latest);
  const icon = ICON[state] || ICON.unknown;
  const title = `${latest.name || 'Workflow'}: ${state}${latest.html_url ? ' — open on GitHub' : ''}`;
  const className = `ci-badge ci-badge--${state}`;

  if (latest.html_url) {
    return (
      <a className={className} href={latest.html_url} target="_blank" rel="noopener noreferrer" title={title}>
        <span className="ci-badge__icon">{icon}</span>
        {!compact && <span className="ci-badge__label">{state}</span>}
      </a>
    );
  }
  return (
    <span className={className} title={title}>
      <span className="ci-badge__icon">{icon}</span>
      {!compact && <span className="ci-badge__label">{state}</span>}
    </span>
  );
}

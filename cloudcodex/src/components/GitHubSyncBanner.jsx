/**
 * Cloud Codex - GitHub Sync Banner
 *
 * Inline banner shown above the editor when the open document is linked to
 * a GitHub file. Reports sync state (clean / remote_ahead / local_ahead /
 * diverged) and offers Pull / Push / Resolve actions.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';
import { showToast, toastError } from './Toast';
import { showModal, destroyModal } from '../util';
import GitHubMergeDialog from './GitHubMergeDialog';
import CIStatusBadge from './CIStatusBadge';

const STATUS_LABELS = {
  clean: { label: 'In sync', tone: 'ok', icon: '✓' },
  remote_ahead: { label: 'Remote has updates', tone: 'warn', icon: '↓' },
  local_ahead: { label: 'Local changes pending', tone: 'info', icon: '↑' },
  diverged: { label: 'Diverged', tone: 'danger', icon: '⚠' },
  conflict: { label: 'Conflict', tone: 'danger', icon: '⚠' },
};

function PushMenu({ open, onClose, onDirect, onPr, busy }) {
  if (!open) return null;
  return (
    <div className="gh-sync-menu" role="menu" onMouseLeave={onClose}>
      <button className="gh-sync-menu__item" onClick={onDirect} disabled={busy}>
        Commit directly to branch
      </button>
      <button className="gh-sync-menu__item" onClick={onPr} disabled={busy}>
        Open pull request from new branch…
      </button>
    </div>
  );
}

export default function GitHubSyncBanner({ link, status, loading, conflict, onPull, onPush, onResolve, onClearConflict }) {
  const [busy, setBusy] = useState(false);
  const [pushMenuOpen, setPushMenuOpen] = useState(false);

  if (!link) return null;

  const syncState = status?.sync_status || 'clean';
  const meta = STATUS_LABELS[syncState] || STATUS_LABELS.clean;

  const ghUrl = `https://github.com/${link.repo_owner}/${link.repo_name}/blob/${link.branch}/${link.file_path}`;

  const openMerge = (data) => {
    showModal(
      <GitHubMergeDialog
        conflict={data}
        link={link}
        onCancel={() => { destroyModal(); onClearConflict?.(); }}
        onResolved={async (resolvedMarkdown) => {
          try {
            await onResolve({ resolved_markdown: resolvedMarkdown, base_sha: data.base_sha });
            destroyModal();
            showToast('Conflict resolved — push to send to GitHub', 'success');
          } catch (err) {
            toastError(err);
          }
        }}
      />,
      'modal-lg'
    );
  };

  const handlePull = async (strategy = 'merge') => {
    setBusy(true);
    try {
      await onPull(strategy);
      showToast('Pulled from GitHub', 'success');
    } catch (err) {
      if (err?.status === 409 && err?.body?.conflicts) {
        openMerge({
          conflicts: err.body.conflicts,
          merged_with_markers: err.body.merged_with_markers,
          base_sha: err.body.base_sha,
          remote_sha: err.body.remote_sha,
          ours: err.body.ours,
          theirs: err.body.theirs,
        });
      } else {
        toastError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  const promptCommitMessage = (defaultMsg) => {
    // eslint-disable-next-line no-alert
    return window.prompt('Commit message', defaultMsg) || null;
  };

  const handlePushDirect = async () => {
    setPushMenuOpen(false);
    const msg = promptCommitMessage(`Update ${link.file_path}`);
    if (!msg) return;
    setBusy(true);
    try {
      const res = await onPush({ commit_message: msg, branch_strategy: 'direct' });
      showToast(`Pushed to ${link.branch}`, 'success');
      return res;
    } catch (err) {
      if (err?.status === 409) {
        showToast('Remote moved while pushing — pull first to resolve', 'error', 6000);
      } else {
        toastError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePushPr = async () => {
    setPushMenuOpen(false);
    const msg = promptCommitMessage(`Update ${link.file_path}`);
    if (!msg) return;
    // eslint-disable-next-line no-alert
    const prTitle = window.prompt('Pull request title', msg);
    if (!prTitle) return;
    setBusy(true);
    try {
      const res = await onPush({ commit_message: msg, branch_strategy: 'pr', pr_title: prTitle });
      if (res?.pr_html_url) {
        showToast(`PR #${res.pr_number} opened`, 'success');
      } else {
        showToast('Push complete', 'success');
      }
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  // If a conflict was surfaced asynchronously (e.g. on doc open auto-pull), open the dialog.
  if (conflict && !pushMenuOpen) {
    openMerge(conflict);
    onClearConflict?.();
  }

  return (
    <div className={`gh-sync-banner gh-sync-banner--${meta.tone}`}>
      <span className="gh-sync-banner__icon" aria-hidden>{meta.icon}</span>
      <span className="gh-sync-banner__label">
        {loading ? 'Checking GitHub…' : meta.label}
      </span>
      <span className="gh-sync-banner__path">
        <a href={ghUrl} target="_blank" rel="noopener noreferrer" title="View on GitHub">
          {link.repo_owner}/{link.repo_name}@{link.branch}/{link.file_path}
        </a>
      </span>
      <CIStatusBadge owner={link.repo_owner} repo={link.repo_name} branch={link.branch} compact />
      <div className="gh-sync-banner__actions">
        {(syncState === 'remote_ahead' || syncState === 'diverged') && (
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => handlePull('merge')}>
            ↓ Pull
          </button>
        )}
        {(syncState === 'local_ahead' || syncState === 'diverged' || syncState === 'clean') && (
          <div className="gh-sync-banner__push">
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => setPushMenuOpen((v) => !v)}>
              ↑ Push…
            </button>
            <PushMenu
              open={pushMenuOpen}
              onClose={() => setPushMenuOpen(false)}
              onDirect={handlePushDirect}
              onPr={handlePushPr}
              busy={busy}
            />
          </div>
        )}
        {syncState === 'diverged' && (
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => handlePull('merge')}>
            Resolve…
          </button>
        )}
      </div>
    </div>
  );
}

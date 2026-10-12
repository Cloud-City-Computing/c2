/**
 * Cloud Codex - the document header (W6-CDX-41, Task 4.2)
 *
 * The header above the editor canvas, on the shared page header: the archive crumb, the title (the page's h1; in edit
 * mode a click renames it in place), a faint meta line with the author's NAME (never the email) and the version and
 * date, and the actions: Edit as the header's one primary in read mode, star and watch as icon buttons with their
 * state in aria-pressed, and the GitHub link and presence. The editor canvas and its toolbar are not in this component.
 *
 * Renders inside the editor's own .editor-log wrapper, which keeps the editor's font exemptions in index.css.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import PageHeader from './PageHeader';
import CollabPresence from './CollabPresence';
import SuiteDocLink from './SuiteDocLink';
import { PencilIcon, StarIcon } from './icons.jsx';

function WatchIcon({ watching }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill={watching ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export default function DocumentHeader({
  doc,
  logId,
  viewMode,
  canEdit,
  editingTitle,
  titleDraft,
  onTitleChange,
  onTitleSave,
  onStartTitleEdit,
  onOpenArchive,
  suiteArchiveId,
  collabUsers,
  collabConnected,
  isFavorited,
  favLoading,
  onToggleFavorite,
  watching,
  watchLoading,
  onToggleWatch,
  onEdit,
}) {
  const editing = viewMode === 'edit';
  const titleText = doc?.title ?? 'Loading Document...';

  let title;
  if (editing && editingTitle) {
    title = (
      <span className="editor-title-edit">
        <input
          type="text"
          aria-label="Document title"
          value={titleDraft}
          onChange={(e) => onTitleChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onTitleSave()}
          onBlur={onTitleSave}
          autoFocus
        />
      </span>
    );
  } else if (editing) {
    title = (
      <button type="button" className="editor-title" title="Click to rename" onClick={onStartTitleEdit}>
        {titleText}
      </button>
    );
  } else {
    title = <span className="editor-title editor-title--readonly">{titleText}</span>;
  }

  const crumb = doc?.archive_name && (
    <div className="editor-breadcrumb">
      <button type="button" className="editor-breadcrumb__link" onClick={onOpenArchive}>{doc.archive_name}</button>
    </div>
  );

  const meta = doc && (
    <>
      <span className="document-meta__author">Created by {doc.name || 'Unknown'}</span>
      <span className="document-meta__version">v{doc.version ?? 1} &middot; {new Date(doc.created_at).toLocaleString()}</span>
      <SuiteDocLink archiveId={suiteArchiveId} logId={logId} />
    </>
  );

  const primary = !editing && canEdit ? (
    <button type="button" className="btn btn-primary btn-sm" onClick={onEdit}>
      <PencilIcon /> Edit
    </button>
  ) : null;

  const toolbar = (
    <>
      {editing && <CollabPresence users={collabUsers} connected={collabConnected} />}
      {doc?.gh_owner && (
        <a
          className="gh-doc-link"
          href={`https://github.com/${doc.gh_owner}/${doc.gh_repo}/blob/${doc.gh_branch}/${doc.gh_path}`}
          target="_blank"
          rel="noopener noreferrer"
          title={`${doc.gh_owner}/${doc.gh_repo}/${doc.gh_path}`}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
          <span>View on GitHub</span>
        </a>
      )}

      {doc && (
        <button
          type="button"
          className={`btn-favorite${isFavorited ? ' btn-favorite--active' : ''}`}
          onClick={onToggleFavorite}
          disabled={favLoading}
          title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
          aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={isFavorited}
        >
          <StarIcon filled={isFavorited} />
        </button>
      )}
      {doc && (
        <button
          type="button"
          className={`btn-watch${watching ? ' btn-watch--active' : ''}`}
          onClick={onToggleWatch}
          disabled={watchLoading}
          title={watching ? 'Stop watching this document' : 'Watch for updates and comments'}
          aria-label={watching ? 'Stop watching this document' : 'Watch this document'}
          aria-pressed={watching}
        >
          <WatchIcon watching={watching} />
        </button>
      )}
    </>
  );

  return (
    <div className={`editor-header document-header${editing ? ' document-header--editing' : ''}`}>
      {crumb}
      <PageHeader title={title} meta={meta} primary={primary} toolbar={toolbar} />
    </div>
  );
}

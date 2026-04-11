/**
 * Cloud Codex - Archive View Page
 *
 * Focused archive layout with a page-tree sidebar and embedded editor.
 * Similar to GitHub's repo view — sidebar for quick page switching,
 * main area shows the selected document.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import StdLayout from '../page_layouts/Std_Layout';
import PageTree from '../components/PageTree';
import Editor from './Editor';
import { apiFetch } from '../util';

export default function ArchiveView() {
  const { archiveId, logId } = useParams();
  const navigate = useNavigate();
  const [archiveName, setArchiveName] = useState('');
  const [archiveMeta, setArchiveMeta] = useState({});
  const [collapsed, setCollapsed] = useState(false);

  // Fetch archive name and context (squad, workspace)
  useEffect(() => {
    if (!archiveId) return;
    apiFetch('GET', '/api/archives')
      .then(res => {
        const archive = (res.archives || []).find(a => a.id === Number(archiveId));
        if (archive) {
          setArchiveName(archive.name);
          setArchiveMeta({
            squadId: archive.squad_id,
            squadName: archive.squad_name,
            workspaceId: archive.workspace_id,
            workspaceName: archive.workspace_name,
          });
        }
      })
      .catch(() => {});
  }, [archiveId]);

  const handleSelectLog = (id) => {
    navigate(`/archives/${archiveId}/doc/${id}`, { replace: true });
  };

  return (
    <StdLayout>
      <div className={`archive-view${collapsed ? ' archive-view--collapsed' : ''}`}>
        <div className="archive-view__sidebar">
          {collapsed ? (
            <button
              className="archive-view__expand-btn"
              onClick={() => setCollapsed(false)}
              title="Expand tree"
            >
              ▸
            </button>
          ) : (
            <PageTree
              archiveId={Number(archiveId)}
              archiveName={archiveName}
              archiveMeta={archiveMeta}
              activeLogId={logId}
              onSelect={handleSelectLog}
              onCollapse={() => setCollapsed(true)}
            />
          )}
        </div>
        <div className="archive-view__main">
          {logId ? (
            <Editor key={logId} embedded archiveId={archiveId} />
          ) : (
            <div className="archive-view__placeholder">
              <h2>{archiveName || 'Archive'}</h2>
              <p className="text-muted">Select a page from the sidebar to start editing.</p>
            </div>
          )}
        </div>
      </div>
    </StdLayout>
  );
}

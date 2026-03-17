/**
 * Cloud Codex - Editor Page
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import StdLayout from '../page_layouts/Std_Layout';
import JoditEditor from 'jodit-react';
import { serverReq, standardRedirect, getSessionTokenFromCookie } from '../util';

// --- Jodit Editor wrapper ---

function EditorComponent({ content, setContent }) {
  const editor = useRef(null);
  const config = useMemo(() => ({
    readonly: false,
    placeholder: 'Start typing...',
    theme: 'dark',
  }), []);

  return (
    <JoditEditor
      ref={editor}
      value={content}
      config={config}
      onBlur={setContent}
    />
  );
}

// --- Editor Page ---

export default function Editor() {
  const [content, setContent]           = useState('');
  const [documentData, setDocumentData] = useState(null);
  const [status, setStatus]             = useState(null); // { type: 'success'|'error', message }
  const [saving, setSaving]             = useState(false);

  // Read doc_id once — window.location doesn't change while mounted
  const doc_id = useMemo(() => new URLSearchParams(window.location.search).get('doc_id'), []);

  useEffect(() => {
    if (!doc_id) return;
    const load = async () => {
      const res = await serverReq('GET', `/api/document?doc_id=${encodeURIComponent(doc_id)}`);
      const doc = res?.document ?? null;
      setDocumentData(doc);
      setContent(doc?.html_content ?? '');
    };
    load();
  }, [doc_id]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setStatus(null);
    setSaving(true);

    const token = getSessionTokenFromCookie();
    const res = await serverReq('POST', '/api/save-document', {
      doc_id: Number(doc_id),
      html_content: content,
      token,
    });

    setSaving(false);

    if (res.success) {
      setStatus({ type: 'success', message: 'Document saved.' });
      setTimeout(() => standardRedirect('/'), 800);
    } else {
      setStatus({ type: 'error', message: `Error saving: ${res.message}` });
    }
  }, [doc_id, content, saving]);

  return (
    <StdLayout>
      <div className="editor-page">
        <div className="editor-header">
          <h2>{documentData?.title ?? 'Loading Document...'}</h2>
          <div className="document-meta">
            {documentData && (
              <>
                <span>Created by: {documentData.name} ({documentData.email})</span>
                <span>Created at: {new Date(documentData.created_at).toLocaleString()}</span>
              </>
            )}
          </div>
        </div>

        {status && (
          <p className={`editor-status ${status.type}`}>{status.message}</p>
        )}

        <div className="editor-toolbar">
          <button
            className="c2-btn save-button"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Document'}
          </button>
          <button className="c2-btn cancel-button" onClick={() => standardRedirect('/')}>
            Cancel
          </button>
        </div>

        <div className="editor-container">
          <EditorComponent content={content} setContent={setContent} />
        </div>
      </div>
    </StdLayout>
  );
}
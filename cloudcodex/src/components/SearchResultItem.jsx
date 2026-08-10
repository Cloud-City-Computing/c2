/**
 * Cloud Codex - Search Result Item Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { destroyModal, showModal, docUrl } from '../util';

function DocumentPreviewModal({ doc, onOpen }) {
  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>{doc.title}</h2>
      {doc.archive_name && <p className="text-muted">Archive: {doc.archive_name}</p>}
      <p>Created by: {doc.author} on {new Date(doc.created_at).toLocaleDateString()}</p>
      {doc.excerpt && <div className="preview-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(doc.excerpt) }} />}
      <button className="btn btn-primary stretched-button" onClick={() => { destroyModal(); onOpen(); }}>Open in Editor</button>
    </div>
  );
}

function SearchResultItem({ doc }) {
  const navigate = useNavigate();
  const openDoc = () => navigate(docUrl(doc));
  const openPreview = () => showModal(<DocumentPreviewModal doc={doc} onOpen={openDoc} />, 'modal-md');

  return (
    <div className="search-result-item" onClick={openPreview}>
      <h3 className="result-title">
        <button
          type="button"
          className="result-title-btn"
          onClick={(e) => { e.stopPropagation(); openPreview(); }}
        >
          {doc.title}
        </button>
      </h3>
      {doc.archive_name && <span className="result-archive">{doc.archive_name}</span>}
    </div>
  );
}

export default SearchResultItem;
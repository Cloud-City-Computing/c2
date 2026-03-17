/**
 * Cloud Codex - Search Result Item Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useNavigate } from 'react-router-dom';
import { destroyModal, showModal } from '../util';

function DocumentPreviewModal({ doc, onOpen }) {
  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>{doc.title}</h2>
      {doc.project_name && <p className="text-muted">Project: {doc.project_name}</p>}
      <p>Created by: {doc.author} on {new Date(doc.created_at).toLocaleDateString()}</p>
      {doc.excerpt && <div className="preview-content" dangerouslySetInnerHTML={{ __html: doc.excerpt }} />}
      <button className="btn btn-primary stretched-button" onClick={() => { destroyModal(); onOpen(); }}>Open in Editor</button>
    </div>
  );
}

function SearchResultItem({ doc }) {
  const navigate = useNavigate();
  const openDoc = () => navigate(`/editor/${doc.id}`);

  return (
    <div className="search-result-item" onClick={() => showModal(<DocumentPreviewModal doc={doc} onOpen={openDoc} />, 'modal-md')}>
      <h3 className="result-title">{doc.title}</h3>
      {doc.project_name && <span className="result-project">{doc.project_name}</span>}
    </div>
  );
}

export default SearchResultItem;
/**
 * Cloud Codex - Search Result Item Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import documentIcon from '../assets/document.png';
import { destroyModal, showModal, standardRedirect } from '../util';

function DocumentPreviewModal({ doc }) {
  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>{doc.title}</h2>
      <p>Created by: {doc.author} on {new Date(doc.created_at).toLocaleDateString()}</p>
      <p className="preview-content" dangerouslySetInnerHTML={{ __html: doc.excerpt }} />
      <button
        className="c2-btn stretched-button"
        onClick={() => standardRedirect(`/editor?doc_id=${doc.id}`)}
      >
        Launch Editor
      </button>
    </div>
  );
}

function SearchResultItem({ doc }) {
  return (
    <div onClick={() => showModal(<DocumentPreviewModal doc={doc} />, 'modal-md')}>
      <h3 className="result-title">{doc.title}</h3>
      <img src={documentIcon} alt="Document Icon" className="document-icon" />
    </div>
  );
}

export default SearchResultItem;
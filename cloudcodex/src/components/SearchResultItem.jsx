/**
 * Cloud Codex - Search Result Item Component
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2025
 * https://cloudcitycomputing.com
 */
import document from "../assets/document.png";
import { createRoot } from "react-dom/client";
import { createAndAppend, clearInner, destroyModal, showModalDimmer } from "../util";

/**
 * Renders a modal preview for a document.
 * @param { JSON } doc - Document data from search query results
 * @returns { JSX.Element }
 */
function previewModal( doc ) {
    return (
        <div className="modal">
            <div className="modal-content">
                <span className="close-button" onClick={ () => destroyModal() }>&times;</span>
                <h2>{ doc.title }</h2>
                <p>Created by: { doc.name } on { new Date( doc.created_at ).toLocaleDateString() }</p>
                <div className="modal-body" dangerouslySetInnerHTML={ { __html: doc.html_content } }></div>
            </div>
        </div>
    );
}

/**
 * Launches the document preview modal.
 * @param { JSON } doc - Document data from search query results
 * @returns { void }
 */
function launchDocumentPreviewModal( doc ) {
  const modalRoot = window.document.getElementById( 'modal-root' );
  clearInner( modalRoot );
  if ( modalRoot ) {
    const modalPreviewRoot = createRoot( createAndAppend( modalRoot, 'div', 'modal-document-preview' ) );
    showModalDimmer();
    modalPreviewRoot.render( previewModal( doc ) );
  }
}

/**
 * Destroys the result preview container content.
 * @returns { void }
 */
function destroyPreview() {
  const previewContainer = window.document.getElementById( 'resultPreviewContainer' );
  if ( previewContainer ) {
    clearInner( previewContainer );
  }
}

/**
 * Generates a preview component for a search result item.
 * @param { JSON } doc - Document data from search query results
 * @returns { JSX.Element }
 */
function resultPreview( doc ) {
    return (
      <>
        <div className="preview-container">
          <span className="close-button" onClick={ () => destroyPreview() }>&times;</span>
          <h3>{ doc.title }</h3>
          <p>Created by: { doc.name } on { new Date( doc.created_at ).toLocaleDateString() }</p>
          <div className="preview-content" dangerouslySetInnerHTML={ { __html: doc.html_content } }></div>
          <br/>
          <button className="c2-btn preview-button" onClick={ () => launchDocumentPreviewModal( doc ) }>Open Full Preview</button>
        </div>
      </>
    );
}

/**
 * Populates the result preview container with a preview of the selected document.
 * @param { JSON } doc - Document data from search query results
 * @returns { void }
 */
function populateResultPreviewContainer( doc ) {
    const container = window.document.getElementById( 'resultPreviewContainer' );
    clearInner( container );
    if ( container ) {
        const previewRoot = createRoot( createAndAppend( container, 'div', 'result-preview' ) );
        previewRoot.render( resultPreview( doc ) );
    }
}

/**
 * Basic representation of a single search result item.
 * @param { Object } props - Component properties
 * @param { JSON } props.doc - Document data from search query results
 * @returns { JSX.Element }
 */
function SearchResultItem( { doc } ) {
  return (
    <>
      <div onClick={ () => populateResultPreviewContainer( doc ) }>
        <h3 className="result-title">{ doc.title }</h3>
        <img src={ document } alt="Document Icon" className="document-icon"/>
      </div>
    </>
  )
}

export default SearchResultItem

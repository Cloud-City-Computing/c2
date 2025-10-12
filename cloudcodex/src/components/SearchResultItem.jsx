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
 * @param { String } title - Document title from search query results
 * @returns { JSX.Element }
 */
function previewModal( title ) {
    return (
        <div className="modal">
            <div className="modal-content">
                <span className="close-button" onClick={ () => destroyModal() }>&times;</span>
                <h2>{ title }</h2>
                <p>Document preview and details go here.</p>
                <img src={ document } alt="Document Icon" className="document-icon"/>
            </div>
        </div>
    );
}

/**
 * Launches the document preview modal.
 * @param { String } title - Document title from search query results
 * @returns { void }
 */
function launchDocumentPreviewModal( title ) {
  const modalRoot = window.document.getElementById( 'modal-root' );
  clearInner( modalRoot );
  if ( modalRoot ) {
    const modalPreviewRoot = createRoot( createAndAppend( modalRoot, 'div', 'modal-document-preview' ) );
    showModalDimmer();
    modalPreviewRoot.render( previewModal( title ) );
  }
}


/**
 * Generates a preview component for a search result item.
 * @param { String } title - Document title from search query results
 * @returns { JSX.Element }
 */
function resultPreview( title ) {
    return (
      <>
          <h3>Preview of: { title }</h3>
          <p>This is a brief preview of the document content.</p>
          <img src={ document } alt="Document Icon" className="document-icon"/>
          <br/>
          <button className="c2-btn preview-button" onClick={ () => launchDocumentPreviewModal( title ) }>Open Full Preview</button>
      </>
    );
}

/**
 * Populates the result preview container with a preview of the selected document.
 * @param { String } title - Document result preview content
 * @returns { void }
 */
function populateResultPreviewContainer( title ) {
    const container = window.document.getElementById( 'resultPreviewContainer' );
    clearInner( container );
    if ( container ) {
        const previewRoot = createRoot( createAndAppend( container, 'div', 'result-preview' ) );
        previewRoot.render( resultPreview( title ) );
    }
}

/**
 * Basic representation of a single search result item.
 * @returns { JSX.Element }
 */
function SearchResultItem( { title, description } ) {
  return (
    <>
      <div onClick={ () => populateResultPreviewContainer( title ) }>
          <h3 className="result-title">{ title }</h3>
          <p className="result-desc">{ description }</p>
          <img src={ document } alt="Document Icon" className="document-icon"/>
      </div>
    </>
  )
}

export default SearchResultItem

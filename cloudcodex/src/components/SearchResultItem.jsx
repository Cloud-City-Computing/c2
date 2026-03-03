/**
 * Cloud Codex - Search Result Item Component
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import document from "../assets/document.png";
import { destroyModal, showModal, standardRedirect } from "../util";

/**
 * Launches the editor for a given document.
 * @param { JSON } doc - Document data from search query results
 * @returns { void }
 */
function launchEditor( doc ) {
  standardRedirect( `/editor?doc_id=${ doc.id }` );
}

/**
 * Renders a modal preview for a document.
 * @param { JSON } doc - Document data from search query results
 * @returns { JSX.Element }
 */
function previewDocumentModal( doc ) {
    return (
      <div className="modal-content">
        <span className="close-button" onClick={ () => destroyModal() }>&times;</span>
        <h2>{ doc.title }</h2>
        <p>Created by: { doc.name } on { new Date( doc.created_at ).toLocaleDateString() }</p>
        <button className="c2-btn stretched-button" onClick={ () => launchEditor( doc ) }>Launch Editor</button>
      </div>
    );
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
      <div onClick={ () => showModal( previewDocumentModal( doc ), "modal-md" ) }>
        <h3 className="result-title">{ doc.title }</h3>
        <img src={ document } alt="Document Icon" className="document-icon"/>
      </div>
    </>
  )
}

export default SearchResultItem

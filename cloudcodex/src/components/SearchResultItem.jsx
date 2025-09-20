/**
 * Cloud Codex - Search Result Item Component
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2025
 * https://cloudcitycomputing.com
 */
import document from "../assets/document.png";

/**
 * Basic representation of a single search result item.
 * @returns { JSX.Element }
 */
function SearchResultItem( { title, description } ) {
  return (
    <>
        <h3 className="result-title">{ title }</h3>
        <p className="result-desc">{ description }</p>
        <img src={ document } alt="Document Icon" className="document-icon" />
    </>
  )
}

export default SearchResultItem

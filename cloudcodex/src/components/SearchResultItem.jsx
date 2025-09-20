import '../App.css'
import document from "../assets/document.png";

/**
 * Basic representation of a single search result item.
 * @returns { JSX.Element }
 */
function SearchResultItem() {
  return (
    <>
        <h3>Result Title</h3>
        <p>Result description goes here...</p>
        <img src={ document } alt="Document Icon" className="document-icon" />
    </>
  )
}

export default SearchResultItem

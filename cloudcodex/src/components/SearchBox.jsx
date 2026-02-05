/**
 * Cloud Codex - Search Box Component
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { getSearchResults } from '../pages/SearchPage.jsx';

/**
 * Renders the search box component.
 * @returns { JSX.Element } - The SearchBox component
 */
export default function SearchBox() {
  return (
    <section className="search-section">
      <div className="search-card">
        <label htmlFor="search" className="search-label">
          Search for Documents
        </label>
        <div className="search-box">
          <input type="text" placeholder="Search..." className="search-input" id="search" 
            onKeyDown={ 
              ( e ) => {
                if ( e.key === 'Enter' ) {
                    getSearchResults( document.getElementById( 'search' ).value );
                }
              }
            }
          />
          <button className="c2-btn search-button"
            onClick={
              () =>
              getSearchResults(
                  document.getElementById("search").value
              )
            }
          >Search</button>
        </div>
      </div>
    </section>
  );
}
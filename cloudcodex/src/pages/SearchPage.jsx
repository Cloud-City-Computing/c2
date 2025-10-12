/**
 * Cloud Codex - Search Page
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2025
 * https://cloudcitycomputing.com
 */
import SearchResultItem from '../components/SearchResultItem'
import { createRoot } from 'react-dom/client';
import { clearInner, createAndAppend } from '../util';

/**
 * Function to fetch and display search results
 * @param { String } query - The search query
 * @returns { void }
 */
function getSearchResults( query ) {
    const mockResults = [
        { title: 'Result 1', description: 'Description for result 1' },
        { title: 'Result 2', description: 'Description for result 2' },
        { title: 'Result 3', description: 'Description for result 3' },
    ];
    let container = document.getElementById( 'resultContainer' );
    if ( !container ) {
        const searchPageContainer = document.getElementById( 'searchPageContainer' );
        if ( searchPageContainer ) {
            const newContainer = createAndAppend( searchPageContainer, 'div', 'search-section' );
            newContainer.id = 'resultContainer';
        }
        container = document.getElementById( 'resultContainer' );
    }
    clearInner( container );
    for ( const result of mockResults ) {
        const itemRoot = createRoot( createAndAppend( container, 'div', 'search-result-item' ) );
        itemRoot.render( <SearchResultItem title={ result.title } description={ result.description } /> );
    };
}

/**
 * Facilitates searching and displays results alongside the necessary UI components.
 * @returns { JSX.Element }
 */
function SearchPage() {
  return (
    <>
        <div className="search-page-container" id="searchPageContainer">
            <div className="search-section">
                <h1>Cloud Codex</h1>
                <div className="search-box">
                    <label htmlFor="searchInput" className="search-label">Search for Documents:</label>
                    <input type="text" placeholder="Search..." className="search-input" />
                    <button className="c2-btn search-button" onClick={ () => getSearchResults( 'example query' ) }>Search</button>
                </div>
                <div id="resultPreviewContainer"></div>
            </div>
        </div>
    </>
  )
}

export default SearchPage

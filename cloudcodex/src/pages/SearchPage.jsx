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
    // send query to backend API and get results at /search?query=
    fetch( `/api/search?query=${ encodeURIComponent( query ) }` )
    .then( response => response.json() )
    .then( data => {
        const results = data.results;
        for ( const result of results ) {
            const itemRoot = createRoot( createAndAppend( container, 'div', 'search-result-item' ) );
            itemRoot.render( <SearchResultItem doc={ result } /> );
        };
    } )
    .catch( error => {
        console.error( 'Error fetching search results:', error );
    } );
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
                    <input type="text" placeholder="Search..." className="search-input" id="search" />
                    <button className="c2-btn search-button" onClick={ () => getSearchResults( document.getElementById( "search" ).value ) }>Search</button>
                </div>
                <div id="resultPreviewContainer"></div>
            </div>
        </div>
    </>
  )
}

export default SearchPage

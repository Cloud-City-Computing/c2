import SearchResultItem from '../components/SearchResultItem'
import { createRoot } from 'react-dom/client';
import { clearInner, createAndAppend } from '../util';
import '../App.css'

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
    const container = document.getElementById( 'resultContainer' );
    if ( container ) {
        clearInner( container );
        for ( const result of mockResults ) {
            const itemRoot = createRoot( createAndAppend( container, 'div', 'search-result-item' ) );
            itemRoot.render( <SearchResultItem title={ result.title } description={ result.description } /> );
        };
    }
}

/**
 * Facilitates searching and displays results alongside the necessary UI components.
 * @returns { JSX.Element }
 */
function SearchPage() {
  return (
    <>
        <h1>Cloud Codex</h1>
        <div className="search-page-container">
            <div className="search-section">
                <div className="search-box">
                    <input type="text" placeholder="Search..." className="search-input" />
                    <button className="search-button" onClick={ () => getSearchResults( 'example query' ) }>Search</button>
                </div>
            </div>
            <div id="resultContainer" className="search-section"/>
        </div>
    </>
  )
}

export default SearchPage

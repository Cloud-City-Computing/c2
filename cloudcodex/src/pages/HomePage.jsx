/**
 * Cloud Codex - Search Page
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import SearchResultItem from '../components/SearchResultItem'
import SearchBox from '../components/SearchBox';
import { createRoot } from 'react-dom/client';
import { clearInner, createAndAppend, serverReq } from '../util';
import StdLayout from '../page_layouts/Std_Layout';

/**
 * Function to fetch and display search results
 * @param { String } query - The search query
 * @returns { void }
 */
export async function getSearchResults( query ) {
    let container = document.getElementById( 'resultPreviewContainer' );
    if ( !container ) {
        const searchPageContainer = document.querySelector( '.page-container' );
        if ( searchPageContainer ) {
            const newContainer = createAndAppend( searchPageContainer, 'div', 'search-section' );
            newContainer.id = 'resultContainer';
        }
        container = document.getElementById( 'resultContainer' );
    }
    clearInner( container );
    const response = await serverReq( 'GET', `/api/search?query=${ encodeURIComponent( query ) }` );
    for ( const result of response.results ) {
        const itemRoot = createRoot( createAndAppend( container, 'div', 'search-result-item' ) );
        itemRoot.render( <SearchResultItem doc={ result } /> );
    }
}

/**
 * Facilitates searching and displays results alongside the necessary UI components.
 * @returns { JSX.Element }
 */
function HomePage() {
  return (
    <>
      <StdLayout>
        <SearchBox />
        <section className="results-section">
          <div id="resultPreviewContainer"></div>
        </section>
      </StdLayout>
    </>
  )
}

export default HomePage

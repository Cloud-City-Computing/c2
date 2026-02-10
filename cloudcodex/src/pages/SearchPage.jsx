/**
 * Cloud Codex - Search Page
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import SearchResultItem from '../components/SearchResultItem'
import Login from '../components/Login';
import SearchBox from '../components/SearchBox';
import { createRoot } from 'react-dom/client';
import { clearInner, createAndAppend, showModal, attemptAutoLogin, getSessionTokenFromCookie, serverReq } from '../util';

/**
 * Function to fetch and display search results
 * @param { String } query - The search query
 * @returns { void }
 */
export async function getSearchResults( query ) {
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
    const response = await serverReq( 'GET', `/api/search?query=${ encodeURIComponent( query ) }` );
    for ( const result of response.results ) {
        const itemRoot = createRoot( createAndAppend( container, 'div', 'search-result-item' ) );
        itemRoot.render( <SearchResultItem doc={ result } /> );
    }
}

function getHeaderElement( loggedIn ) {
  if ( !loggedIn ) {
    return (
        <header className="app-header">
          <h1 className="app-title">Cloud Codex</h1>
          <button className="c2-btn login-button" onClick={() => showModal( <Login /> )}>
            Login
          </button>
        </header>
    );
  }
  else {
    return (
      <header className="app-header">
        <h1 className="app-title">Cloud Codex</h1>
      </header>
    );
  }
}

/**
 * Facilitates searching and displays results alongside the necessary UI components.
 * @returns { JSX.Element }
 */
function SearchPage() {
  const sessionToken = getSessionTokenFromCookie();
  let userLoggedIn = false;
  if ( sessionToken && sessionToken !== "" ) {
    userLoggedIn = attemptAutoLogin( sessionToken );
  }
  return (
    <>
      <div className="app-shell">
        {/* Top Header */}
        { getHeaderElement( userLoggedIn ) }
        {/* Main Page Content */}
        <main className="search-page-container" id="searchPageContainer">
          {/* Search Column */}
          <SearchBox />
          {/* Results Column */}
          <section className="results-section">
            <div id="resultPreviewContainer"></div>
          </section>
        </main>
      </div>
    </>
  )
}

export default SearchPage

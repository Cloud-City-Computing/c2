/**
 * Cloud Codex - Editor Page
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { standardRedirect } from "../util"

/**
 * Generates the editor page.
 * @returns { JSX.Element } - The Editor component
 */
export default function Editor( { doc_id } ) {
    return (
        <>
          <div className="app-shell">
            {/* Top Header */}
            <header className="app-header">
              <h1 className="app-title">Cloud Codex</h1>
              <button className="c2-btn login-button" onClick={() => showModal( <Login /> )}>
                Login
              </button>
            </header>
            {/* Main Page Content */}
            <main className="editor-page">
                <h1>Editor Page</h1>
                <p>This is where the document editor will be implemented.</p>
                <button className="c2-btn" onClick={ () => standardRedirect( '/' ) }>Return Home</button>
            </main>
          </div>
        </>
    );
}
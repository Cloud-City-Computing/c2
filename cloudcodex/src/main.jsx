/**
 * Cloud Codex - Main Entry Point
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from "react-router-dom";
import './index.css'
import { applyPrefsToDOM, loadUserPrefs } from './userPrefs'
import { upgradeLegacySessionCookie } from './util'
import App from './App.jsx'

// Apply user preferences (accent color, density, etc.) before first render
applyPrefsToDOM(loadUserPrefs());

// A session held under the pre-__Host- cookie name moves across before the
// first render, since everything that authenticates reads the cookie. It asks
// the server only when such a cookie exists, and never rejects.
upgradeLegacySessionCookie().finally(() => {
  createRoot( document.getElementById( 'root' ) ).render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
  )
});

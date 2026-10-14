/**
 * Cloud Codex - Main Entry Point
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from "react-router-dom";
// The shared primitives first (core.css opens with the licence notice a
// minifier keeps only at the head of the bundle), then the font faces, then
// Codex's own bindings, then the app's styles. Vite hashes the font files
// into dist/assets/, never public/, which the uploads volume shadows.
import '../vendor/cloud-city-design/core.css'
import '../vendor/cloud-city-design/fonts.css'
import './codex.css'
import './index.css'
import { applyPrefsToDOM, loadUserPrefs } from './userPrefs'
import { migrateLegacy, watch } from './lib/appearance-prefs'
import { upgradeLegacySessionCookie } from './util'
import App from './App.jsx'

// The theme and accent (the appearance preference contract) are applied again here, the same as the pre-paint
// script did, and kept in step with other tabs and products. A stored Codex accent moves into the contract
// once; the editor font size is applied from the prefs object.
applyPrefsToDOM(loadUserPrefs());
watch();
void migrateLegacy();

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

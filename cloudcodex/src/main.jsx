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
import App from './App.jsx'

// Apply user preferences (accent color, density, etc.) before first render
applyPrefsToDOM(loadUserPrefs());

createRoot( document.getElementById( 'root' ) ).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

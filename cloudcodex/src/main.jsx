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
import App from './App.jsx'

// Apply user preferences (accent color, density, etc.) before first render
applyPrefsToDOM(loadUserPrefs());

createRoot( document.getElementById( 'root' ) ).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

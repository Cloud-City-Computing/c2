/**
 * Cloud Codex - Main Entry Point
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2025
 * https://cloudcitycomputing.com
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot( document.getElementById( 'root' ) ).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

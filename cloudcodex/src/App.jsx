/**
 * Cloud Codex - Main Application Entry
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { Routes, Route, Link } from "react-router-dom";
import HomePage from './pages/HomePage'
import Editor from './pages/Editor'
import AccountSettings from './pages/AccountSettings'

/**
 * Renders the main application component.
 * @returns { JSX.Element } - The App component
 */
function App() {
  return (
    <div>
      <nav>
        <Link to="/">Search</Link> |{" "}
        <Link to="/editor">Editor</Link> |{" "}
        <Link to="/account">Account Settings</Link>
      </nav>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/account" element={<AccountSettings />} />
      </Routes>
    </div>
  )
}

export default App

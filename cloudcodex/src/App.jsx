/**
 * Cloud Codex - Main Application Entry
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { Routes, Route, Navigate } from "react-router-dom";
import HomePage from './pages/HomePage'
import Editor from './pages/Editor'
import AccountSettings from './pages/AccountSettings'
import ProjectsPage from './pages/ProjectsPage'
import OrganizationsPage from './pages/OrganizationsPage'
import ResetPasswordPage from './pages/ResetPasswordPage'

function NotFound() {
  return (
    <div className="not-found-page">
      <h1>404</h1>
      <p>Page not found</p>
      <a href="/" className="btn btn-primary">Go Home</a>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/editor/:pageId" element={<Editor />} />
      <Route path="/account" element={<AccountSettings />} />
      <Route path="/settings" element={<Navigate to="/account" replace />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/projects/:projectId" element={<ProjectsPage />} />
      <Route path="/organizations" element={<OrganizationsPage />} />
      <Route path="/organizations/:orgId" element={<OrganizationsPage />} />
      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  )
}

export default App

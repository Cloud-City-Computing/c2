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
import ArchivesPage from './pages/ArchivesPage'
import ArchiveView from './pages/ArchiveView'
import WorkspacesPage from './pages/WorkspacesPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import AdminPage from './pages/AdminPage'
import GitHubPage from './pages/GitHubPage'

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
      <Route path="/editor/:logId" element={<Editor />} />
      <Route path="/account" element={<AccountSettings />} />
      <Route path="/settings" element={<Navigate to="/account" replace />} />
      <Route path="/archives" element={<ArchivesPage />} />
      <Route path="/archives/:archiveId" element={<ArchivesPage />} />
      <Route path="/archives/:archiveId/doc/:logId" element={<ArchiveView />} />
      <Route path="/archives/:archiveId/doc" element={<ArchiveView />} />
      <Route path="/workspaces" element={<WorkspacesPage />} />
      <Route path="/workspaces/:workspaceId" element={<WorkspacesPage />} />
      <Route path="/github" element={<GitHubPage />} />
      <Route path="/github/:owner/:repo" element={<GitHubPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  )
}

export default App

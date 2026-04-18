/**
 * Cloud Codex - Main Application Entry
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import HomePage from './pages/HomePage'

// Heavy pages are lazy-loaded so the initial bundle stays small.
// Editor alone pulls in Tiptap, Yjs, lowlight, marked, turndown, etc.
const Editor = lazy(() => import('./pages/Editor'));
const ArchiveView = lazy(() => import('./pages/ArchiveView'));
const GitHubPage = lazy(() => import('./pages/GitHubPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage'));
const AccountSettings = lazy(() => import('./pages/AccountSettings'));
const ArchivesPage = lazy(() => import('./pages/ArchivesPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));

function PageLoader() {
  return <div className="page-loader"><div className="spinner" /></div>;
}

function NotFound() {
  return (
    <div className="not-found-page">
      <h1>404</h1>
      <p>Page not found</p>
      <a href="/" className="btn btn-primary">Go Home</a>
    </div>
  );
}

/**
 * Redirects mobile visitors away from the standalone editor route.
 * On mobile, documents are view-only via the archive view.
 */
function MobileEditorGuard({ children }) {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (isMobile) return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/editor/:logId" element={<MobileEditorGuard><Editor /></MobileEditorGuard>} />
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
    </Suspense>
  )
}

export default App

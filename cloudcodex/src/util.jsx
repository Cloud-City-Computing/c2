/**
 * Utility functions for Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { createRoot } from 'react-dom/client';
import DOMPurify from 'dompurify';

// --- Constants ---

const STORAGE_PREFIX = 'c2-';

// Cached React roots to avoid creating multiple roots on the same DOM node,
// which causes React warnings and potential render conflicts
const reactRoots = new Map();

// --- Network ---

/**
 * Centralized API fetch wrapper that attaches auth headers and handles errors.
 * @param {'GET'|'POST'|'PUT'|'DELETE'} method
 * @param {string} url
 * @param {object} [data]
 * @returns {Promise<any>}
 */
export async function apiFetch(method, url, data) {
  const token = getSessionTokenFromCookie();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = { method, headers };
  if (data !== undefined && method !== 'GET' && method !== 'HEAD') {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(url, options).catch((error) => {
    console.error(`Network error during ${method} ${url}:`, error);
    throw error;
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const err = new Error(body.message || `${method} ${url} responded with ${response.status}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  return response.json();
}

/**
 * Legacy API request function — use apiFetch() for new code.
 * @param {'GET'|'POST'|'PUT'|'DELETE'} reqType
 * @param {string} url
 * @param {object} [data]
 * @param {object} [headers]
 * @returns {Promise<any>}
 */
export async function serverReq(reqType, url, data, headers = {}) {
  const options = {
    method: reqType,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (data !== undefined && reqType !== 'GET' && reqType !== 'HEAD') {
    options.body = JSON.stringify(data);
  }
  const response = await fetch(url, options).catch((error) => {
    console.error(`Network error during ${reqType} ${url}:`, error);
    throw error;
  });
  if (!response.ok) {
    const err = new Error(`${reqType} ${url} responded with ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

// --- Shared helpers ---

/** Human-readable relative time string (e.g. "3m ago", "2d ago"). */
export function timeAgo(dateStr) {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/** Build a URL to open a document, accounting for archive context. */
export const docUrl = (doc) =>
  doc.archive_id ? `/archives/${doc.archive_id}/doc/${doc.id}` : `/editor/${doc.id}`;

/** Extract a user-friendly message from an API error object. */
export function getErrorMessage(err) {
  return err?.body?.message || err?.message || 'An unexpected error occurred.';
}

/** Comment tag label map — single source of truth for tag display names. */
export const TAG_LABELS = {
  comment: 'Comment',
  suggestion: 'Suggestion',
  question: 'Question',
  issue: 'Issue',
  note: 'Note',
};

// --- Workspace APIs ---

export const fetchWorkspaces = () => apiFetch('GET', '/api/workspaces');
export const createWorkspace = (name, { squadName, archiveName } = {}) => apiFetch('POST', '/api/workspaces', { name, squadName, archiveName });
export const updateWorkspace = (id, name) => apiFetch('PUT', `/api/workspaces/${id}`, { name });
export const deleteWorkspace = (id) => apiFetch('DELETE', `/api/workspaces/${id}`);

// --- Archive Repo APIs ---

export const fetchArchiveRepos = (archiveId) => apiFetch('GET', `/api/archives/${archiveId}/repos`);
export const linkArchiveRepo = (archiveId, repo) => apiFetch('POST', `/api/archives/${archiveId}/repos`, repo);
export const unlinkArchiveRepo = (archiveId, repoId) => apiFetch('DELETE', `/api/archives/${archiveId}/repos/${repoId}`);

// --- Squad APIs ---

export const fetchSquads = (workspaceId) => apiFetch('GET', `/api/workspaces/${workspaceId}/squads`);
export const createSquad = (workspaceId, name, { archiveName } = {}) => apiFetch('POST', `/api/workspaces/${workspaceId}/squads`, { name, archiveName });
export const setupWorkspace = (opts) => apiFetch('POST', '/api/setup', opts);
export const updateSquad = (id, name) => apiFetch('PUT', `/api/squads/${id}`, { name });
export const deleteSquad = (id) => apiFetch('DELETE', `/api/squads/${id}`);

// --- Permission APIs ---

export const fetchPermissions = () => apiFetch('GET', '/api/permissions');
export const fetchUserPermissions = (userId) => apiFetch('GET', `/api/permissions/${userId}`);
export const updatePermissions = (userId, perms) => apiFetch('PUT', `/api/permissions/${userId}`, perms);
export const fetchSquadPermissions = (squadId) => apiFetch('GET', `/api/squads/${squadId}/permissions`);
export const updateSquadPermissions = (squadId, perms) => apiFetch('PUT', `/api/squads/${squadId}/permissions`, perms);

// --- Squad Member APIs ---

export const fetchSquadMembers = (squadId) => apiFetch('GET', `/api/squads/${squadId}/members`);
export const inviteSquadMember = (squadId, data) => apiFetch('POST', `/api/squads/${squadId}/members/invite`, data);
export const updateSquadMember = (squadId, userId, data) => apiFetch('PUT', `/api/squads/${squadId}/members/${userId}`, data);
export const removeSquadMember = (squadId, userId) => apiFetch('DELETE', `/api/squads/${squadId}/members/${userId}`);

// --- Invitation APIs ---

export const fetchMyInvitations = () => apiFetch('GET', '/api/invitations');
export const fetchSquadInvitations = (squadId) => apiFetch('GET', `/api/squads/${squadId}/invitations`);
export const acceptInvitation = (invId) => apiFetch('POST', `/api/invitations/${invId}/accept`);
export const declineInvitation = (invId) => apiFetch('POST', `/api/invitations/${invId}/decline`);
export const cancelInvitation = (invId) => apiFetch('DELETE', `/api/invitations/${invId}`);

// --- User Search API ---

export const searchUsers = (q) => apiFetch('GET', `/api/users/search?q=${encodeURIComponent(q)}`);

// --- Admin APIs ---

export const fetchAdminStatus = () => apiFetch('GET', '/api/admin/status');
export const fetchAdminStats = () => apiFetch('GET', '/api/admin/stats');
export const fetchAdminWorkspaces = () => apiFetch('GET', '/api/admin/workspaces');
export const createAdminWorkspace = (name, ownerEmail, { squadName, archiveName } = {}) =>
  apiFetch('POST', '/api/admin/workspaces', { name, ownerEmail, squadName, archiveName });
export const deleteAdminWorkspace = (id) => apiFetch('DELETE', `/api/admin/workspaces/${id}`);
export const fetchAdminUsers = () => apiFetch('GET', '/api/admin/users');
export const deleteAdminUser = (id) => apiFetch('DELETE', `/api/admin/users/${id}`);
export const fetchAdminUserPermissions = (id) => apiFetch('GET', `/api/admin/users/${id}/permissions`);
export const updateAdminUserPermissions = (id, perms) => apiFetch('PUT', `/api/admin/users/${id}/permissions`, perms);
export const updateAdminUserAdmin = (id, is_admin) => apiFetch('PUT', `/api/admin/users/${id}/admin`, { is_admin });
export const fetchAdminInvitations = () => apiFetch('GET', '/api/admin/invitations');
export const createAdminInvitation = (email) => apiFetch('POST', '/api/admin/invitations', { email });
export const deleteAdminInvitation = (id) => apiFetch('DELETE', `/api/admin/invitations/${id}`);
export const fetchAdminSquads = () => apiFetch('GET', '/api/admin/squads');
export const fetchAdminSquadMembers = (id) => apiFetch('GET', `/api/admin/squads/${id}/members`);
export const updateAdminSquadMember = (squadId, userId, updates) => apiFetch('PUT', `/api/admin/squads/${squadId}/members/${userId}`, updates);
export const removeAdminSquadMember = (squadId, userId) => apiFetch('DELETE', `/api/admin/squads/${squadId}/members/${userId}`);
export const fetchAdminPresence = () => apiFetch('GET', '/api/admin/presence');
export const validateInviteToken = (token) => apiFetch('GET', `/api/invite/validate/${encodeURIComponent(token)}`);

// --- Browse / Search APIs ---

export const browseLogs = ({ page = 1, limit = 12, sort = 'newest', favorites, workspaceId, squadId, archiveId } = {}) => {
  const params = new URLSearchParams({ page, limit, sort });
  if (favorites) params.set('favorites', '1');
  if (workspaceId) params.set('workspaceId', workspaceId);
  if (squadId) params.set('squadId', squadId);
  if (archiveId) params.set('archiveId', archiveId);
  return apiFetch('GET', `/api/browse?${params}`);
};

export const searchLogs = ({ query, page = 1, limit = 12, favorites, workspaceId, squadId, archiveId } = {}) => {
  const params = new URLSearchParams({ query, page, limit });
  if (favorites) params.set('favorites', '1');
  if (workspaceId) params.set('workspaceId', workspaceId);
  if (squadId) params.set('squadId', squadId);
  if (archiveId) params.set('archiveId', archiveId);
  return apiFetch('GET', `/api/search?${params}`);
};

export const fetchSearchFilters = () => apiFetch('GET', '/api/search/filters');

export const fetchPresence = () => apiFetch('GET', '/api/presence');

// --- Favorites APIs ---

export const fetchFavorites = ({ page = 1, limit = 12 } = {}) =>
  apiFetch('GET', `/api/favorites?page=${page}&limit=${limit}`);
export const checkFavorite = (logId) => apiFetch('GET', `/api/favorites/check?logId=${logId}`);
export const addFavorite = (logId) => apiFetch('POST', '/api/favorites', { logId });
export const removeFavorite = (logId) => apiFetch('DELETE', `/api/favorites/${logId}`);

// --- Comment APIs ---

export const fetchComments = (logId, status) => {
  let url = `/api/logs/${logId}/comments`;
  if (status) url += `?status=${encodeURIComponent(status)}`;
  return apiFetch('GET', url);
};
export const fetchCommentCount = (logId) => apiFetch('GET', `/api/logs/${logId}/comments/count`);
export const createComment = (logId, data) => apiFetch('POST', `/api/logs/${logId}/comments`, data);
export const updateComment = (commentId, data) => apiFetch('PUT', `/api/comments/${commentId}`, data);
export const resolveComment = (commentId, status) => apiFetch('POST', `/api/comments/${commentId}/resolve`, { status });
export const reopenComment = (commentId) => apiFetch('POST', `/api/comments/${commentId}/reopen`);
export const deleteComment = (commentId) => apiFetch('DELETE', `/api/comments/${commentId}`);
export const clearAllComments = (logId) => apiFetch('DELETE', `/api/logs/${logId}/comments`);
export const addCommentReply = (commentId, content) => apiFetch('POST', `/api/comments/${commentId}/replies`, { content });
export const deleteCommentReply = (replyId) => apiFetch('DELETE', `/api/replies/${replyId}`);

// --- Archive APIs ---

export const fetchArchives = () => apiFetch('GET', '/api/archives');
export const createArchive = (name, squad_id) => apiFetch('POST', '/api/archives', { name, squad_id });
export const updateArchive = (id, name) => apiFetch('PUT', `/api/archives/${id}`, { name });
export const deleteArchive = (id) => apiFetch('DELETE', `/api/archives/${id}`);
export const manageArchiveAccess = (id, userId, accessType, action) =>
  apiFetch('POST', `/api/archives/${id}/access`, { userId, accessType, action });
export const manageArchiveSquadAccess = (id, squadId, accessType, action) =>
  apiFetch('POST', `/api/archives/${id}/access`, { squadId, accessType, action });
export const manageArchiveWorkspaceAccess = (id, accessType, action) =>
  apiFetch('POST', `/api/archives/${id}/access`, { workspace: true, accessType, action });
export const fetchArchiveAccess = (id) => apiFetch('GET', `/api/archives/${id}/access`);

// --- Log APIs ---

export const fetchLogs = (archiveId) => apiFetch('GET', `/api/archives/${archiveId}/logs`);
export const createLog = (archiveId, title, parent_id) =>
  apiFetch('POST', `/api/archives/${archiveId}/logs`, { title, parent_id });
export const updateLog = (archiveId, logId, data) =>
  apiFetch('PUT', `/api/archives/${archiveId}/logs/${logId}`, data);
export const deleteLog = (archiveId, logId) =>
  apiFetch('DELETE', `/api/archives/${archiveId}/logs/${logId}`);

// --- Document APIs ---

export const fetchDocument = (docId) => apiFetch('GET', `/api/document?doc_id=${docId}`);
export const saveDocument = (docId, htmlContent, markdownContent) =>
  apiFetch('POST', '/api/save-document', { doc_id: docId, html_content: htmlContent, ...(markdownContent !== undefined ? { markdown_content: markdownContent } : {}) });
export const updateLogTitle = (logId, title) =>
  apiFetch('PUT', `/api/document/${logId}/title`, { title });

// --- Version APIs ---

export const fetchVersions = (logId) => apiFetch('GET', `/api/document/${logId}/versions`);
export const fetchVersion = (logId, versionId) =>
  apiFetch('GET', `/api/document/${logId}/versions/${versionId}`);
export const restoreVersion = (logId, versionId) =>
  apiFetch('POST', `/api/document/${logId}/versions/${versionId}/restore`);
export const deleteVersion = (logId, versionId) =>
  apiFetch('DELETE', `/api/document/${logId}/versions/${versionId}`);
export const publishVersion = (logId, { title, notes } = {}) =>
  apiFetch('POST', `/api/document/${logId}/publish`, { title, notes });

// --- Upload API ---

/**
 * Upload a document file to create a new log in a archive.
 * Uses FormData (multipart) instead of JSON.
 */
export async function uploadDocument(archiveId, file, parentId) {
  const token = getSessionTokenFromCookie();
  const formData = new FormData();
  formData.append('file', file);
  if (parentId) formData.append('parent_id', parentId);

  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`/api/archives/${archiveId}/logs/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const err = new Error(body.message || `Upload failed with status ${response.status}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  return response.json();
}

// --- Export API ---

/**
 * Export/download a document in the specified format.
 * Triggers a browser download of the resulting file.
 * @param {number} logId
 * @param {'html'|'md'|'txt'|'docx'|'pdf'} format
 * @param {string} [title] - Document title for PDF filename
 * @param {string} [htmlContent] - HTML content for client-side PDF generation
 */
export async function exportDocument(logId, format, title, htmlContent) {
  // PDF uses the browser's native print-to-PDF via a print window.
  // This gives perfect text selection, formatting, and pagination.
  if (format === 'pdf') {
    const docTitle = (title || 'Document').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const safeHtml = DOMPurify.sanitize(htmlContent || '');
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      throw new Error('Pop-up blocked. Please allow pop-ups for this site to export PDF.');
    }
    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${docTitle}</title>
  <style>
    * { color: #000 !important; }
    body {
      margin: 20mm;
      font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #000;
      background: #fff;
    }
    img { max-width: 100%; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
    pre, code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; font-size: 13px; }
    pre { padding: 12px; overflow-x: auto; }
    a { color: #000 !important; text-decoration: underline; }
    @media print {
      body { margin: 0; }
    }
  </style>
</head>
<body>
  ${safeHtml}
  <script>
    window.onafterprint = function() { window.close(); };
    window.onload = function() { window.print(); };
  ${"<"}/script>
</body>
</html>`);
    printWindow.document.close();
    return;
  }

  // All other formats are handled server-side
  const token = getSessionTokenFromCookie();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`/api/document/${logId}/export?format=${format}`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const err = new Error(body.message || `Export failed with status ${response.status}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  const disposition = response.headers.get('Content-Disposition');
  const match = disposition?.match(/filename="(.+)"/);
  const filename = match?.[1] || `document.${format}`;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- DOM Helpers ---

/**
 * Removes all children from an element
 * @param {HTMLElement} element
 */
export function clearInner(element) {
  element.replaceChildren();
}

export function createAndAppend(parent, tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  parent.appendChild(el);
  return el;
}

export const standardRedirect = (url) => { window.location.href = url; };

// --- Modal ---

function getModalDimmer() { return document.getElementById('modal-dimmer'); }
function getModalRoot()   { return document.getElementById('modal-root');   }

function getOrCreateRoot(el) {
  if (!reactRoots.has(el)) {
    reactRoots.set(el, createRoot(el));
  }
  return reactRoots.get(el);
}

export function hideModalDimmer() {
  const dimmer = getModalDimmer();
  if (dimmer) dimmer.style.display = 'none';
}

export function destroyModal() {
  const modalRoot = getModalRoot();
  if (modalRoot) clearInner(modalRoot);
  hideModalDimmer();
}

export function showModalDimmer(onClose) {
  const dimmer = getModalDimmer();
  if (!dimmer) return;
  dimmer.style.display = 'block';
  dimmer.onclick = () => {
    onClose?.();
    dimmer.style.display = 'none';
  };
}

/**
 * Render a React element inside the global modal overlay.
 * The modal is dismissed on Escape key or clicking the dimmer backdrop.
 * @param {import('react').ReactNode} content — React element to render inside the modal
 * @param {string} [extraClass] — Additional CSS class for the modal wrapper
 */
export function showModal(content, extraClass = '') {
  const modalRoot = getModalRoot();
  if (!modalRoot) return;

  clearInner(modalRoot);
  const wrapper = createAndAppend(modalRoot, 'div', `modal-content-wrapper ${extraClass}`.trim());
  getOrCreateRoot(wrapper).render(content);
  showModalDimmer(destroyModal);

  // Close on Escape key
  const handler = (e) => {
    if (e.key === 'Escape') {
      destroyModal();
      document.removeEventListener('keydown', handler);
    }
  };
  document.removeEventListener('keydown', handler);
  document.addEventListener('keydown', handler);
}

/**
 * Render a React element inside the global dropdown overlay.
 * Dismissed when clicking the dimmer backdrop.
 * @param {import('react').ReactNode} content — React element to render
 */
export function showDropdownMenu(content) {
  const dropdownRoot = document.getElementById('dropdown-root');
  if (!dropdownRoot) return;

  clearInner(dropdownRoot);
  const wrapper = createAndAppend(dropdownRoot, 'div', 'dropdown-content-wrapper');
  getOrCreateRoot(wrapper).render(content);
  dropdownRoot.style.display = 'block';

  showModalDimmer(() => {
    dropdownRoot.style.display = 'none';
  });
}

// --- Session Storage ---

export function setSessStorage(key, value) {
  sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
}

export function getSessStorage(key) {
  const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function removeSessStorage(key) {
  sessionStorage.removeItem(STORAGE_PREFIX + key);
}

// --- Auth ---

/**
 * Extract the session token from the `sessionToken` cookie.
 * Clears the cached user from session storage if no token is found.
 * @returns {string|null}
 */
export function getSessionTokenFromCookie() {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith('sessionToken='));

  const token = match?.split('=')[1] ?? null;
  if (!token) removeSessStorage('currentUser');
  return token;
}

/**
 * Attempt to restore a user session from cache or by validating the token with the server.
 * @param {string} sessionToken
 * @returns {Promise<Object|null>} The user object if valid, otherwise null
 */
export async function attemptAutoLogin(sessionToken) {
  const cached = getSessStorage('currentUser');
  if (cached) return cached;
  if (!sessionToken) return null;

  const response = await serverReq('POST', '/api/validate-session', { token: sessionToken });
  if (response.valid) {
    setSessStorage('currentUser', response.user);
    return response.user;
  }

  return null;
}
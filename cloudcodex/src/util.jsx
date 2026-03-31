/**
 * Utility functions for Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { createRoot } from 'react-dom/client';

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

// --- Organization APIs ---

export const fetchOrganizations = () => apiFetch('GET', '/api/organizations');
export const createOrganization = (name) => apiFetch('POST', '/api/organizations', { name });
export const updateOrganization = (id, name) => apiFetch('PUT', `/api/organizations/${id}`, { name });
export const deleteOrganization = (id) => apiFetch('DELETE', `/api/organizations/${id}`);

// --- Team APIs ---

export const fetchTeams = (orgId) => apiFetch('GET', `/api/organizations/${orgId}/teams`);
export const createTeam = (orgId, name) => apiFetch('POST', `/api/organizations/${orgId}/teams`, { name });
export const updateTeam = (id, name) => apiFetch('PUT', `/api/teams/${id}`, { name });
export const deleteTeam = (id) => apiFetch('DELETE', `/api/teams/${id}`);

// --- Permission APIs ---

export const fetchPermissions = () => apiFetch('GET', '/api/permissions');
export const fetchUserPermissions = (userId) => apiFetch('GET', `/api/permissions/${userId}`);
export const updatePermissions = (userId, perms) => apiFetch('PUT', `/api/permissions/${userId}`, perms);
export const fetchTeamPermissions = (teamId) => apiFetch('GET', `/api/teams/${teamId}/permissions`);
export const updateTeamPermissions = (teamId, perms) => apiFetch('PUT', `/api/teams/${teamId}/permissions`, perms);

// --- Team Member APIs ---

export const fetchTeamMembers = (teamId) => apiFetch('GET', `/api/teams/${teamId}/members`);
export const inviteTeamMember = (teamId, data) => apiFetch('POST', `/api/teams/${teamId}/members/invite`, data);
export const updateTeamMember = (teamId, userId, data) => apiFetch('PUT', `/api/teams/${teamId}/members/${userId}`, data);
export const removeTeamMember = (teamId, userId) => apiFetch('DELETE', `/api/teams/${teamId}/members/${userId}`);

// --- Invitation APIs ---

export const fetchMyInvitations = () => apiFetch('GET', '/api/invitations');
export const fetchTeamInvitations = (teamId) => apiFetch('GET', `/api/teams/${teamId}/invitations`);
export const acceptInvitation = (invId) => apiFetch('POST', `/api/invitations/${invId}/accept`);
export const declineInvitation = (invId) => apiFetch('POST', `/api/invitations/${invId}/decline`);
export const cancelInvitation = (invId) => apiFetch('DELETE', `/api/invitations/${invId}`);

// --- User Search API ---

export const searchUsers = (q) => apiFetch('GET', `/api/users/search?q=${encodeURIComponent(q)}`);

// --- Project APIs ---

export const fetchProjects = () => apiFetch('GET', '/api/projects');
export const createProject = (name, team_id) => apiFetch('POST', '/api/projects', { name, team_id });
export const updateProject = (id, name) => apiFetch('PUT', `/api/projects/${id}`, { name });
export const deleteProject = (id) => apiFetch('DELETE', `/api/projects/${id}`);
export const manageProjectAccess = (id, userId, accessType, action) =>
  apiFetch('POST', `/api/projects/${id}/access`, { userId, accessType, action });

// --- Page APIs ---

export const fetchPages = (projectId) => apiFetch('GET', `/api/projects/${projectId}/pages`);
export const createPage = (projectId, title, parent_id) =>
  apiFetch('POST', `/api/projects/${projectId}/pages`, { title, parent_id });
export const updatePage = (projectId, pageId, data) =>
  apiFetch('PUT', `/api/projects/${projectId}/pages/${pageId}`, data);
export const deletePage = (projectId, pageId) =>
  apiFetch('DELETE', `/api/projects/${projectId}/pages/${pageId}`);

// --- Document APIs ---

export const fetchDocument = (docId) => apiFetch('GET', `/api/document?doc_id=${docId}`);
export const saveDocument = (docId, htmlContent) =>
  apiFetch('POST', '/api/save-document', { doc_id: docId, html_content: htmlContent });
export const updatePageTitle = (pageId, title) =>
  apiFetch('PUT', `/api/document/${pageId}/title`, { title });

// --- Version APIs ---

export const fetchVersions = (pageId) => apiFetch('GET', `/api/document/${pageId}/versions`);
export const fetchVersion = (pageId, versionId) =>
  apiFetch('GET', `/api/document/${pageId}/versions/${versionId}`);
export const restoreVersion = (pageId, versionId) =>
  apiFetch('POST', `/api/document/${pageId}/versions/${versionId}/restore`);
export const deleteVersion = (pageId, versionId) =>
  apiFetch('DELETE', `/api/document/${pageId}/versions/${versionId}`);
export const publishVersion = (pageId, { title, notes } = {}) =>
  apiFetch('POST', `/api/document/${pageId}/publish`, { title, notes });

// --- Upload API ---

/**
 * Upload a document file to create a new page in a project.
 * Uses FormData (multipart) instead of JSON.
 */
export async function uploadDocument(projectId, file, parentId) {
  const token = getSessionTokenFromCookie();
  const formData = new FormData();
  formData.append('file', file);
  if (parentId) formData.append('parent_id', parentId);

  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`/api/projects/${projectId}/pages/upload`, {
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
 * @param {number} pageId
 * @param {'html'|'md'|'txt'|'docx'|'pdf'} format
 * @param {string} [title] - Document title for PDF filename
 * @param {string} [htmlContent] - HTML content for client-side PDF generation
 */
export async function exportDocument(pageId, format, title, htmlContent) {
  // PDF uses the browser's native print-to-PDF via a print window.
  // This gives perfect text selection, formatting, and pagination.
  if (format === 'pdf') {
    const docTitle = title || 'Document';
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
  ${htmlContent || ''}
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

  const response = await fetch(`/api/document/${pageId}/export?format=${format}`, {
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
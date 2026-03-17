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
 * Makes a JSON API request
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} reqType
 * @param {string} url
 * @param {object} [data]
 * @returns {Promise<any>}
 */
export async function serverReq(reqType, url, data) {
  const options = {
    method: reqType,
    headers: { 'Content-Type': 'application/json' },
  };

  // Don't serialize a body for GET/HEAD — it's ignored and can cause issues
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

// --- DOM Helpers ---

/**
 * Removes all children from an element
 * @param {HTMLElement} element
 */
export function clearInner(element) {
  element.replaceChildren();
}

/**
 * Returns the element with the given id
 * @param {string} id
 * @returns {HTMLElement | null}
 */
export const getElById = (id) => document.getElementById(id);

/**
 * Gets the value of an input element by id
 * @param {string} id
 * @returns {string | null}
 */
export const getVal = (id) => getElById(id)?.value ?? null;

/**
 * Sets the value of an input element by id
 * @param {string} id
 * @param {any} value
 */
export function setVal(id, value) {
  const el = getElById(id);
  if (el) el.value = value;
}

/**
 * Creates an element, optionally assigns a class, and appends it to a parent
 * @param {HTMLElement} parent
 * @param {string} tag
 * @param {string} [className]
 * @returns {HTMLElement}
 */
export function createAndAppend(parent, tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  parent.appendChild(el);
  return el;
}

/**
 * Redirects to a URL
 * @param {string} url
 */
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
  // Always replace onclick to avoid stale closures from previous calls
  dimmer.onclick = () => {
    onClose?.();
    dimmer.style.display = 'none';
  };
}

/**
 * Renders a React component into the modal root
 * @param {JSX.Element} content
 * @param {string} [extraClass]
 */
export function showModal(content, extraClass = '') {
  const modalRoot = getModalRoot();
  if (!modalRoot) return;

  clearInner(modalRoot);
  const wrapper = createAndAppend(modalRoot, 'div', `modal-content-wrapper ${extraClass}`.trim());
  getOrCreateRoot(wrapper).render(content);
  showModalDimmer(destroyModal);
}

/**
 * Renders a React component into the dropdown root
 * @param {JSX.Element} content
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

/**
 * Stores a value in sessionStorage under the c2- namespace
 * @param {string} key
 * @param {any} value
 */
export function setSessStorage(key, value) {
  sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
}

/**
 * Retrieves a value from sessionStorage under the c2- namespace
 * @param {string} key
 * @returns {any | null}
 */
export function getSessStorage(key) {
  const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Removes a value from sessionStorage under the c2- namespace
 * @param {string} key
 */
export function removeSessStorage(key) {
  sessionStorage.removeItem(STORAGE_PREFIX + key);
}

// --- Auth ---

/**
 * Gets the session token from cookies
 * @returns {string | null}
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
 * Validates the session token and caches the user in sessionStorage.
 * Returns the cached user immediately if already stored.
 * @param {string} sessionToken
 * @returns {Promise<object | null>}
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

/**
 * Fetches search results and renders them into the results container
 * @param {string} query
 */
export async function getSearchResults(query) {
  let container = document.getElementById('resultPreviewContainer') 
               ?? document.getElementById('resultContainer');

  if (!container) {
    const pageContainer = document.querySelector('.page-container');
    if (!pageContainer) return;
    container = createAndAppend(pageContainer, 'div', 'search-section');
    container.id = 'resultContainer';
  }

  clearInner(container);

  const token = getSessionTokenFromCookie();
  const response = await serverReq('GET', `/api/search?query=${encodeURIComponent(query)}&token=${token}`);

  // Lazily import to avoid a circular dep between util and component files
  const { default: SearchResultItem } = await import('./components/SearchResultItem');

  for (const result of response.results) {
    const wrapper = createAndAppend(container, 'div', 'search-result-item');
    getOrCreateRoot(wrapper).render(<SearchResultItem doc={result} />);
  }
}
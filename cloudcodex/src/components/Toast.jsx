/**
 * Cloud Codex - Toast Notification Component
 *
 * Lightweight notification system for surfacing success/error messages
 * from actions that don't use modals (e.g. version restore, delete).
 *
 * Usage:
 *   import { showToast } from './Toast';
 *   showToast('Document saved!');
 *   showToast('Permission denied: Write access required', 'error');
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { createRoot } from 'react-dom/client';
import { useState, useEffect, useCallback } from 'react';

let addToastFn = null;
let toastRoot = null;

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 * @param {number} duration - ms before auto-dismiss (default 4000)
 */
export function showToast(message, type = 'info', duration = 4000) {
  if (!addToastFn) mountContainer();
  addToastFn?.({ message, type, duration, id: Date.now() + Math.random() });
}

/**
 * Build a user-friendly toast message from an API error.
 */
export function toastError(err) {
  const msg = err?.body?.message || err?.message || 'An unexpected error occurred.';
  if (err?.status === 403) {
    showToast(`Permission denied: ${msg}`, 'error', 5000);
  } else {
    showToast(msg, 'error', 5000);
  }
}

function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((toast) => {
    setToasts(prev => [...prev, toast]);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setExiting(true), toast.duration - 300);
    const remove = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => { clearTimeout(timer); clearTimeout(remove); };
  }, [toast, onDismiss]);

  return (
    <div
      className={`toast toast--${toast.type}${exiting ? ' toast--exit' : ''}`}
      onClick={() => onDismiss(toast.id)}
      role="alert"
    >
      <span className="toast__icon">
        {toast.type === 'error' ? '✕' : toast.type === 'success' ? '✓' : 'ℹ'}
      </span>
      <span className="toast__message">{toast.message}</span>
    </div>
  );
}

function mountContainer() {
  let el = document.getElementById('toast-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-root';
    document.body.appendChild(el);
  }
  if (!toastRoot) {
    toastRoot = createRoot(el);
  }
  toastRoot.render(<ToastContainer />);
}

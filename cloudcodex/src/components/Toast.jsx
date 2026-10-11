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
import { useState, useEffect, useCallback, useRef } from 'react';

let addToastFn = null;
let toastRoot = null;

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 * @param {number} duration - ms before auto-dismiss (default 4000)
 */
/* eslint-disable react-refresh/only-export-components */
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

  // No aria-live here: each toast is its own live region (role="alert" or "status"), so an
  // announcement is made once, not once by the container and again by the toast inside it.
  // tabIndex -1 lets a dismissed toast's focus land here, rather than on the body.
  return (
    <div className="toast-container" tabIndex={-1}>
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const rootRef = useRef(null);
  // Where focus came from when it entered this toast, so a dismiss can send it back there.
  const returnTo = useRef(null);
  // The time left on the toast, kept across pauses; `since` is when the current run began.
  const left = useRef(toast.duration);
  const since = useRef(0);
  const held = hovered || focused;

  // A toast is held while the pointer or the keyboard is on it, and its timers run only otherwise.
  useEffect(() => {
    if (held) return undefined;
    since.current = Date.now();
    const timer = setTimeout(() => setExiting(true), Math.max(0, left.current - 300));
    const remove = setTimeout(() => onDismiss(toast.id), left.current);
    return () => {
      clearTimeout(timer);
      clearTimeout(remove);
      left.current = Math.max(0, left.current - (Date.now() - since.current));
    };
  }, [held, toast, onDismiss]);

  const dismissFromHere = () => {
    const root = rootRef.current;
    const holdsFocus = Boolean(root && root.contains(document.activeElement));
    const back = returnTo.current;
    onDismiss(toast.id);
    if (holdsFocus) {
      const target = back && back.isConnected ? back : root?.parentElement;
      target?.focus?.();
    }
  };

  return (
    <div
      ref={rootRef}
      className={`toast toast--${toast.type}${exiting ? ' toast--exit' : ''}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) returnTo.current = e.relatedTarget;
        setFocused(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <span className="toast__icon">
        {toast.type === 'error' ? '✕' : toast.type === 'success' ? '✓' : 'ℹ'}
      </span>
      <span className="toast__message">{toast.message}</span>
      <button type="button" className="toast__dismiss" aria-label="Dismiss notification"
              onClick={dismissFromHere}>
        ×
      </button>
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

/**
 * Cloud Codex - the header's Appearance popover (W6-CDX-44)
 *
 * The control in every page header. It opens a small non-modal panel: Theme (System, Light, Dark) and the
 * eight accents with Default. It is non-modal on purpose: an overlay would make the
 * shell's chrome inert, and the toggle lives in that chrome. The focus contract:
 *   - Opening moves focus to the checked Theme option.
 *   - Tab and Shift+Tab stay inside the panel (trapTab, src/lib/focus-trap.js); Tab from the toggle enters it.
 *   - Escape closes and returns focus to the toggle.
 *   - A press outside closes it. Focus returns to the toggle when the press landed on plain content; a press
 *     on another control keeps the focus that control takes.
 * The panel is portalled to the body and placed from the toggle's rectangle, so a header row that scrolls
 * (the phone strip) cannot clip it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FOCUSABLE, trapTab } from '../lib/focus-trap.js';
import { AccentOptions, ThemeOptions } from './AppearanceOptions.jsx';

// The panel's width in CSS (index.css, .appearance-panel): 288 px, or the viewport less a gutter.
const PANEL_WIDTH = 288;

function ContrastIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  );
}

export default function AppearanceControl() {
  const panelId = useId();
  const rootRef = useRef(null);
  const toggleRef = useRef(null);
  const panelRef = useRef(null);
  const returnFocusOnClick = useRef(false);
  const [isOpen, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 8 });

  // Under the toggle, its right edge on the toggle's, but never off the screen: a phone's header wraps, and the
  // toggle can sit at the left edge. Re-measured while open if the viewport or the page moves.
  function measure() {
    const rect = toggleRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    setPlace({ top: rect.bottom + 8, left });
  }
  useEffect(() => {
    if (!isOpen) return undefined;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  });

  // Opening focuses the checked Theme option, once the panel is in the document.
  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.querySelector('[aria-pressed="true"]')?.focus();
  }, [isOpen]);

  // A press outside closes it. The click that follows decides where focus goes (below).
  useEffect(() => {
    if (!isOpen) return undefined;
    function onPointerDown(event) {
      returnFocusOnClick.current = false;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) === true || panelRef.current?.contains(target) === true) return;
      returnFocusOnClick.current = true;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [isOpen]);

  useEffect(() => {
    function onDocumentClick(event) {
      if (!returnFocusOnClick.current) return;
      returnFocusOnClick.current = false;
      const target = event.target instanceof Element ? event.target : null;
      if (target !== null && target.closest(FOCUSABLE) !== null) return;
      toggleRef.current?.focus();
    }
    document.addEventListener('click', onDocumentClick, true);
    return () => {
      document.removeEventListener('click', onDocumentClick, true);
    };
  }, []);

  // React events bubble through the portal, so the panel's keys reach this handler.
  function onKeyDown(event) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
      toggleRef.current?.focus();
      return;
    }
    if (event.key !== 'Tab') return;
    if (toggleRef.current === document.activeElement) {
      const stops = panelRef.current?.querySelectorAll(FOCUSABLE);
      const target = event.shiftKey ? stops?.[stops.length - 1] : stops?.[0];
      if (target !== undefined) {
        event.preventDefault();
        target.focus();
      }
      return;
    }
    trapTab(event, panelRef.current);
  }

  return (
    <div className="appearance-control" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={toggleRef}
        type="button"
        className="btn btn-ghost btn-icon appearance-toggle"
        aria-label="Appearance"
        title="Appearance"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        onClick={() => {
          if (!isOpen) measure();
          setOpen(!isOpen);
        }}
      >
        <ContrastIcon />
      </button>
      {isOpen && createPortal(
        <div
          ref={panelRef}
          id={panelId}
          className="appearance-panel"
          role="group"
          aria-label="Appearance"
          style={{ top: place.top, left: place.left }}
        >
          <div className="appearance-section" role="group" aria-label="Theme">
            <p className="appearance-section__title" aria-hidden="true">Theme</p>
            <ThemeOptions />
          </div>
          <div className="appearance-section" role="group" aria-label="Accent">
            <p className="appearance-section__title" aria-hidden="true">Accent</p>
            <AccentOptions />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * Cloud Codex - The suite cluster in the top bar's brand slot (W6-CDX-25)
 *
 * A NON-MODAL DISCLOSURE, not role="menu": the toggle is a button with aria-expanded and
 * aria-controls; the panel is a short list of links reached with Tab, in this order: Cloud Codex
 * (this product, aria-current="true"), Cloud Command (the workspace this instance belongs to), a
 * separator, and All workspaces (Cloud Command's `/?switch=1`, so a one-workspace person is not
 * bounced back to their workspace). Every entry navigates in the same tab.
 *
 * Keyboard and focus, as Cloud Command's switcher confirms them: Enter or Space open and close
 * the toggle; Escape closes and returns focus to it; Tab out of the last link closes the panel
 * and leaves focus where Tab put it; an outside press closes the panel and returns focus to the
 * toggle, unless the press landed on another focusable control, which keeps the focus it was
 * given. Activating the current product's link closes the panel and returns focus to the toggle
 * when that link is the page already shown. Any change of history entry closes the panel.
 *
 * The panel stays mounted with the `hidden` attribute, so aria-controls always names an element.
 * It is positioned under the toggle, inside this component's own box, with no portal: the top
 * bar does not clip, so the panel is not cut off.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import transparent_logo from '../assets/ccc_brand/ccc_transparent.png';

/** This product's name. Cloud Codex is the product's own name across src/, not a suite literal. */
const PRODUCT_NAME = 'Cloud Codex';

/** Anything the browser can focus, for the outside-press focus rule. */
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function SuiteCluster({ suiteName, commandWorkspaceUrl }) {
  // Keyed on the history ENTRY (location.key), not the path, so Back or Forward cannot reopen a
  // panel on a path it was opened on. Adjusting state while rendering keeps this out of an effect.
  const location = useLocation();
  const [isOpen, setOpen] = useState(false);
  const [shownKey, setShownKey] = useState(location.key);
  if (shownKey !== location.key) {
    setShownKey(location.key);
    setOpen(false);
  }
  const pathname = location.pathname;

  const panelId = useId();
  const rootRef = useRef(null);
  const toggleRef = useRef(null);
  const isOpenRef = useRef(isOpen);
  const returnFocusOnClick = useRef(false);

  const allWorkspacesUrl = new URL('/?switch=1', commandWorkspaceUrl).href;

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Registered once, for the life of the cluster: the outside press closes the panel on
  // pointerdown, so a listener removed with the panel would miss the click that follows it.
  useEffect(() => {
    // Every pointerdown starts a new gesture: it clears any return left armed by an earlier one,
    // then arms it again only for a press outside an open panel.
    function onDocumentPointerDown(event) {
      returnFocusOnClick.current = false;
      if (!isOpenRef.current) return;
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return;
      returnFocusOnClick.current = true;
      setOpen(false);
    }

    // A press that becomes a scroll is cancelled and produces no click, so a return it armed must
    // not survive into the next gesture.
    function onDocumentPointerCancel() {
      returnFocusOnClick.current = false;
    }

    // The click follows the press, after the browser has moved focus for it. Focus goes back to the
    // toggle only when the press landed on non-focusable content: stealing focus from a control the
    // person just clicked would break typing in the field they chose.
    function onDocumentClick(event) {
      if (!returnFocusOnClick.current) return;
      returnFocusOnClick.current = false;
      const target = event.target instanceof Element ? event.target : null;
      if (target !== null && target.closest(FOCUSABLE) !== null) return;
      toggleRef.current?.focus();
    }

    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('pointercancel', onDocumentPointerCancel, true);
    document.addEventListener('click', onDocumentClick, true);
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      document.removeEventListener('pointercancel', onDocumentPointerCancel, true);
      document.removeEventListener('click', onDocumentClick, true);
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  // The current product's link goes to the page the person is already on. Its panel hides on
  // activation, so focus would fall to the body; the toggle takes focus first, while the link is
  // still visible.
  function closeFromCurrent(target) {
    return () => {
      if (target === pathname) toggleRef.current?.focus();
      setOpen(false);
    };
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !isOpen) return;
    event.stopPropagation();
    setOpen(false);
    toggleRef.current?.focus();
  }

  // Tab out of the cluster: a focus move to something outside it closes the panel. A null
  // relatedTarget (a press on inert content in the panel, or focus leaving the document) is not a
  // Tab, so it does not close the panel here.
  function onBlur(event) {
    if (!isOpen) return;
    const next = event.relatedTarget;
    if (next instanceof Node && rootRef.current !== null && !rootRef.current.contains(next)) {
      setOpen(false);
    }
  }

  return (
    <div
      className="cc-suite"
      ref={rootRef}
      data-open={isOpen ? 'true' : 'false'}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <button
        ref={toggleRef}
        type="button"
        className="cc-suite__toggle"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={`${PRODUCT_NAME}, ${suiteName}: switch app`}
        onClick={() => {
          setOpen(!isOpen);
        }}
      >
        <img src={transparent_logo} alt="" aria-hidden="true" className="cc-suite__logo" />
        <span className="cc-suite__text">
          <span className="cc-suite__name">{PRODUCT_NAME}</span>
          <span className="cc-suite__eyebrow">{suiteName}</span>
        </span>
        <svg className="cc-suite__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div id={panelId} className="cc-suite__panel" hidden={!isOpen}>
        <ul className="cc-suite__list">
          <li>
            <Link
              className="cc-suite__link"
              to="/"
              aria-current="true"
              onClick={closeFromCurrent('/')}
            >
              <span className="cc-suite__tick" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.5 5 9l4.5-5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              {PRODUCT_NAME}
            </Link>
          </li>
          <li>
            <a className="cc-suite__link" href={commandWorkspaceUrl} onClick={close}>
              <span className="cc-suite__tick" aria-hidden="true" />
              Cloud Command
            </a>
          </li>
          <li className="cc-suite__separator" aria-hidden="true" />
          <li>
            <a className="cc-suite__link" href={allWorkspacesUrl} onClick={close}>
              <span className="cc-suite__tick" aria-hidden="true" />
              All workspaces
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}

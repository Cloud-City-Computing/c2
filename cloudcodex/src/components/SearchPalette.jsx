/**
 * Cloud Codex - the search palette (W6-CDX-40, X13; on the dialog stack, W6-CDX-40 review item 2)
 *
 * The sidebar's "Search or jump to" trigger, with a Ctrl K hint, and a centred dialog it opens. The dialog lists
 * documents from the existing search API and archives by name. It is registered with openDialog (lib/dialog.js), so
 * Escape and Tab stay inside it and the page behind is inert, exactly as for any other modal. Ctrl K (Meta K) opens
 * it from anywhere, but is a no-op while another modal is open, and is left to the browser inside an editable field.
 * A result click sends focus to the page's main region once the new page is in place. The palette closes when the
 * session notice is about to appear (the c2:close-overlays event), so two dialogs never stack.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { apiFetch, docUrl } from '../util.jsx';
import { SearchIcon } from './ShellIcons.jsx';
import { openDialog, closeDialog } from '../lib/dialog.js';
import { openOverlayCount } from '../lib/overlay.js';

const DEBOUNCE_MS = 200;
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** The node the palette is portalled into. Created once; nothing else writes to it. */
function paletteRoot() {
  let el = document.getElementById('palette-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'palette-root';
    document.body.appendChild(el);
  }
  return el;
}

/** The page's main region, which takes focus after a result is opened. */
function mainRegion() {
  const main = document.querySelector('.main-content');
  if (main && !main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  return main;
}

export default function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState([]);
  const [archives, setArchives] = useState(null);
  const location = useLocation();
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const entryRef = useRef(null);
  const openRef = useRef(open);
  openRef.current = open;
  // Set by a result click: the next location change moves focus to the page.
  const focusPageNext = useRef(false);

  const close = useCallback((returnFocus = true) => {
    const entry = entryRef.current;
    entryRef.current = null;
    setOpen(false);
    setQuery('');
    setDocuments([]);
    if (entry) {
      // closeDialog puts focus back on the opener (the trigger) and releases the inert page.
      closeDialog(entry);
    }
    if (!returnFocus) return;
    triggerRef.current?.focus();
  }, []);

  // Ctrl K and Meta K: toggle the palette, unless it is another modal's turn or the key belongs to an editable field.
  useEffect(() => {
    function onKeyDown(event) {
      if (!((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(EDITABLE)) return;
      if (openRef.current) {
        event.preventDefault();
        close(true);
        return;
      }
      if (openOverlayCount() > 0) return;
      event.preventDefault();
      setOpen(true);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close]);

  // The session notice is about to appear: close the palette first, so the notice gets the focus.
  useEffect(() => {
    const onNotice = () => { if (openRef.current) close(false); };
    window.addEventListener('c2:close-overlays', onNotice);
    return () => window.removeEventListener('c2:close-overlays', onNotice);
  }, [close]);

  // Register the open palette with the dialog stack: Escape, Tab, focus in and the inert page are the stack's.
  // The cleanup closes the entry too, so an unmount while open never leaves the page inert.
  useEffect(() => {
    if (!open || !dialogRef.current) return undefined;
    const entry = openDialog(dialogRef.current, {
      onEscape: () => close(true),
      opener: triggerRef.current,
    });
    entryRef.current = entry;
    return () => {
      closeDialog(entry);
      if (entryRef.current === entry) entryRef.current = null;
    };
  }, [open, close]);

  // A result click has navigated: once the page has changed, focus its main region.
  useEffect(() => {
    if (!focusPageNext.current) return;
    focusPageNext.current = false;
    mainRegion()?.focus({ preventScroll: false });
  }, [location.key]);

  // Load the archives once per open, so the archive matches are current.
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    apiFetch('GET', '/api/archives').then(
      (body) => { if (live) setArchives(Array.isArray(body?.archives) ? body.archives : []); },
      () => { if (live) setArchives([]); },
    );
    return () => { live = false; };
  }, [open]);

  // Documents: a debounced search of the existing search API. An empty query asks nothing.
  useEffect(() => {
    const q = query.trim();
    if (!open || q === '') return undefined;
    let live = true;
    const timer = setTimeout(() => {
      apiFetch('GET', `/api/search?query=${encodeURIComponent(q)}`).then(
        (body) => { if (live) setDocuments(Array.isArray(body?.results) ? body.results : []); },
        () => { if (live) setDocuments([]); },
      );
    }, DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [query, open]);

  const needle = query.trim().toLowerCase();
  const shownDocuments = needle === '' ? [] : documents;
  const matchingArchives = needle === ''
    ? []
    : (archives ?? []).filter((a) => String(a.name ?? '').toLowerCase().includes(needle));

  const opened = () => {
    focusPageNext.current = true;
    close(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="search-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
        <span className="search-trigger__text">Search or jump to</span>
        <kbd className="search-trigger__key" aria-hidden="true">Ctrl K</kbd>
      </button>
      {open && createPortal(
        <div className="palette-scrim">
          <div
            ref={dialogRef}
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label="Search or jump to"
          >
            <input
              ref={inputRef}
              type="search"
              role="searchbox"
              className="palette__input"
              aria-label="Search documents and archives"
              placeholder="Search or jump to…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="palette__results">
              {needle === '' && <p className="palette__hint">Type to search documents and archives.</p>}
              {shownDocuments.length > 0 && (
                <section className="palette__group" aria-label="Documents">
                  <p className="palette__group-title">Documents</p>
                  <ul className="palette__list">
                    {shownDocuments.map((doc) => (
                      <li key={`doc-${doc.id}`}>
                        <Link className="palette__result" to={docUrl(doc)} onClick={opened}>
                          <span className="palette__result-title">{doc.title}</span>
                          {doc.author && <span className="palette__result-meta">{doc.author}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {matchingArchives.length > 0 && (
                <section className="palette__group" aria-label="Archives">
                  <p className="palette__group-title">Archives</p>
                  <ul className="palette__list">
                    {matchingArchives.map((a) => (
                      <li key={`archive-${a.id}`}>
                        <Link className="palette__result" to={`/archives/${a.id}`} onClick={opened}>
                          <span className="palette__result-title">{a.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {needle !== '' && shownDocuments.length === 0 && matchingArchives.length === 0 && (
                <p className="palette__hint">No matches.</p>
              )}
            </div>
          </div>
        </div>,
        paletteRoot(),
      )}
    </>
  );
}

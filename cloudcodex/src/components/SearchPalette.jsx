/**
 * Cloud Codex - the search palette (W6-CDX-40, X13)
 *
 * The sidebar's "Search or jump to" trigger, with a Ctrl K hint, and a centred dialog it opens. The dialog lists
 * documents from the existing search API and archives by name, and is reachable at every width. Ctrl K (and Meta K)
 * opens and closes it from anywhere in the app. It is a modal dialog: it takes focus on open, keeps Tab inside
 * itself, closes on Escape and gives focus back to the trigger. It is portalled into its own node, #palette-root,
 * which nothing else writes to, so the sidebar's stacking and overflow cannot clip it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { apiFetch, docUrl } from '../util.jsx';
import { SearchIcon } from './ShellIcons.jsx';

const DEBOUNCE_MS = 200;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

export default function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState([]);
  const [archives, setArchives] = useState(null);
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const openRef = useRef(open);
  openRef.current = open;

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setQuery('');
    setDocuments([]);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Ctrl K and Meta K toggle the palette from anywhere. Registered once for the life of the sidebar.
  useEffect(() => {
    function onKeyDown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (openRef.current) close(true);
        else setOpen(true);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close]);

  // Focus the input on open; load the archives once per open, so the archive matches are current.
  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
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

  // Escape closes from anywhere while the palette is open, so it works whichever element holds focus.
  useEffect(() => {
    if (!open) return undefined;
    function onEscape(event) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close(true);
    }
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, close]);

  function onDialogKeyDown(event) {
    if (event.key !== 'Tab') return;
    // Keep Tab inside the dialog: wrap from the last focusable to the first, and back.
    const items = [...(dialogRef.current?.querySelectorAll(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const needle = query.trim().toLowerCase();
  const shownDocuments = needle === '' ? [] : documents;
  const matchingArchives = needle === ''
    ? []
    : (archives ?? []).filter((a) => String(a.name ?? '').toLowerCase().includes(needle));

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
            onKeyDown={onDialogKeyDown}
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
                        <Link className="palette__result" to={docUrl(doc)} onClick={() => close(false)}>
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
                        <Link className="palette__result" to={`/archives/${a.id}`} onClick={() => close(false)}>
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

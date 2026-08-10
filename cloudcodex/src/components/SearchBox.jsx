/**
 * Cloud Codex - Search Box Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, docUrl } from '../util';

export default function SearchBox({ inline = false, onResults }) {
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const handleSearch = async () => {
    const query = inputRef.current?.value?.trim();
    if (!query) return;

    try {
      const response = await apiFetch('GET', `/api/search?query=${encodeURIComponent(query)}`);
      if (inline) {
        setResults(response.results || []);
        setShowDropdown(true);
        // Dismissal is driven entirely by focus leaving the container, so the
        // dropdown must never open while focus is outside it or nothing can
        // close it. Clicking the magnifier is exactly that case: the same
        // browsers that do not focus a link on mousedown do not focus a button
        // either, so the press blurs the input to <body> and the results then
        // open unreachable, overlaying the page at z-index 200.
        inputRef.current?.focus();
      }
      onResults?.(response.results || []);
    } catch {
      setResults([]);
    }
  };

  // Drop the results, not just the overlay. Leaving them in state means the
  // next focus of the input silently reopens the previous query's dropdown,
  // because onFocus reopens whenever results is non-empty.
  const handleResultClick = () => {
    setShowDropdown(false);
    setResults([]);
    if (inputRef.current) inputRef.current.value = '';
  };

  // The results are real links, so focus can land inside the dropdown. Close it
  // only when focus leaves the whole search box, never when it moves from the
  // input onto a result: that is what a blur timeout on the input alone got
  // wrong, and why the results used to need onMouseDown to be reachable at all.
  const handleBlur = (e) => {
    if (!containerRef.current?.contains(e.relatedTarget)) setShowDropdown(false);
  };

  // Escape is a real dismissal, so it discards the results too: otherwise the
  // next focus of the input undoes it. Focus returns to the input because the
  // element being dismissed may be the one holding it.
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setShowDropdown(false);
      setResults([]);
      inputRef.current?.focus();
    }
  };

  // Do not let a mouse press inside the dropdown move focus at all. Chromium
  // focuses a link on mousedown, but Firefox and Safari do not, so there the
  // input would blur with a null relatedTarget, handleBlur would unmount the
  // results before mouseup, and the click would never land on the link. This
  // suppresses focus, not the click, so the anchor still navigates. Keyboard
  // users are unaffected: Tab never fires mousedown.
  //
  // Whether this also freezes scrollbar thumb dragging is an open question,
  // recorded in open-questions.md B13. It is NOT settled here: a headless
  // Chromium probe suggested it did, but a control on a plain scrollable div
  // with no handler at all failed identically, so the method was measuring
  // nothing. Wheel and keyboard scrolling are unaffected either way.
  const handleDropdownMouseDown = (e) => e.preventDefault();

  if (inline) {
    return (
      <div
        className="search-inline"
        ref={containerRef}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Search documents..."
          className="search-input"
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
        />
        <button className="search-icon-btn" onClick={handleSearch} aria-label="Search">
          <svg xmlns="http://www.w3.workspace/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        {showDropdown && results.length > 0 && (
          <div className="search-dropdown" onMouseDown={handleDropdownMouseDown}>
            {results.map(doc => (
              <Link
                key={doc.id}
                className="search-dropdown-item"
                to={docUrl(doc)}
                onClick={handleResultClick}
              >
                <h4>{doc.title}</h4>
                <p>{doc.author}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="search-section">
      <div className="search-card">
        <label htmlFor="search" className="search-label">
          Search for Documents
        </label>
        <div className="search-box">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search..."
            className="search-input"
            id="search"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          />
          <button className="btn btn-primary search-button" onClick={handleSearch}>
            Search
          </button>
        </div>
      </div>
    </section>
  );
}
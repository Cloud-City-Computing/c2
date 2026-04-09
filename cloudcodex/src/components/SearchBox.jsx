/**
 * Cloud Codex - Search Box Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../util';

export default function SearchBox({ inline = false, onResults }) {
  const inputRef = useRef(null);
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const navigate = useNavigate();

  const handleSearch = async () => {
    const query = inputRef.current?.value?.trim();
    if (!query) return;

    try {
      const response = await apiFetch('GET', `/api/search?query=${encodeURIComponent(query)}`);
      if (inline) {
        setResults(response.results || []);
        setShowDropdown(true);
      }
      onResults?.(response.results || []);
    } catch {
      setResults([]);
    }
  };

  const handleResultClick = (doc) => {
    setShowDropdown(false);
    if (inputRef.current) inputRef.current.value = '';
    navigate(doc.archive_id ? `/archives/${doc.archive_id}/doc/${doc.id}` : `/editor/${doc.id}`);
  };

  if (inline) {
    return (
      <div className="search-inline">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search documents..."
          className="search-input"
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        />
        <button className="search-icon-btn" onClick={handleSearch} aria-label="Search">
          <svg xmlns="http://www.w3.workspace/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        {showDropdown && results.length > 0 && (
          <div className="search-dropdown">
            {results.map(doc => (
              <div key={doc.id} className="search-dropdown-item" onMouseDown={() => handleResultClick(doc)}>
                <h4>{doc.title}</h4>
                <p>{doc.author}</p>
              </div>
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
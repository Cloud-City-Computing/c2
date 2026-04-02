/**
 * Cloud Codex - Explore / Browse Component
 *
 * Provides a visual, paginated browse view of all accessible documents
 * with integrated search that shows contextual match snippets.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { browsePages, searchPages } from '../util';

const ITEMS_PER_PAGE = 12;

function HighlightedSnippet({ snippet, matchStart, matchEnd }) {
  if (matchStart < 0 || matchEnd < 0 || matchStart >= snippet.length) {
    return <span>{snippet}</span>;
  }
  return (
    <span>
      {snippet.slice(0, matchStart)}
      <mark className="explore-match">{snippet.slice(matchStart, matchEnd)}</mark>
      {snippet.slice(matchEnd)}
    </span>
  );
}

function ExploreCard({ item, isSearch, onClick }) {
  const date = item.created_at ? new Date(item.created_at).toLocaleDateString() : null;
  const words = item.char_count ? Math.round(item.char_count / 5) : null;

  return (
    <div className="explore-card" onClick={onClick}>
      <div className="explore-card__header">
        <h3 className="explore-card__title">{item.title}</h3>
        {item.matchedOn && (
          <span className={`explore-badge explore-badge--${item.matchedOn}`}>
            {item.matchedOn === 'title' ? 'Title match' : 'Content match'}
          </span>
        )}
      </div>
      <div className="explore-card__meta">
        {item.project_name && <span className="explore-card__project">{item.project_name}</span>}
        {item.author && <span className="explore-card__author">{item.author}</span>}
        {date && <span className="explore-card__date">{date}</span>}
        {words != null && <span className="explore-card__words">~{words.toLocaleString()} words</span>}
      </div>
      {isSearch && item.snippet ? (
        <p className="explore-card__snippet">
          <HighlightedSnippet snippet={item.snippet} matchStart={item.matchStart} matchEnd={item.matchEnd} />
        </p>
      ) : item.excerpt ? (
        <p className="explore-card__excerpt">{item.excerpt}</p>
      ) : null}
    </div>
  );
}

function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const pages = [];
  const maxVisible = 5;
  let start = Math.max(1, page - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages, start + maxVisible - 1);
  if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);

  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="explore-pagination">
      <button
        className="btn btn-ghost btn-sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        &laquo; Prev
      </button>
      {start > 1 && (
        <>
          <button className="explore-pagination__num" onClick={() => onPageChange(1)}>1</button>
          {start > 2 && <span className="explore-pagination__dots">&hellip;</span>}
        </>
      )}
      {pages.map(p => (
        <button
          key={p}
          className={`explore-pagination__num${p === page ? ' explore-pagination__num--active' : ''}`}
          onClick={() => onPageChange(p)}
        >
          {p}
        </button>
      ))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="explore-pagination__dots">&hellip;</span>}
          <button className="explore-pagination__num" onClick={() => onPageChange(totalPages)}>{totalPages}</button>
        </>
      )}
      <button
        className="btn btn-ghost btn-sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next &raquo;
      </button>
    </div>
  );
}

export default function ExploreBrowser() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);

  const isSearch = query.trim().length > 0;

  const load = useCallback(async (q, pg, s) => {
    setLoading(true);
    try {
      const res = q.trim()
        ? await searchPages({ query: q.trim(), page: pg, limit: ITEMS_PER_PAGE })
        : await browsePages({ page: pg, limit: ITEMS_PER_PAGE, sort: s });
      setResults(res.results || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 0);
    } catch {
      setResults([]);
      setTotal(0);
      setTotalPages(0);
    }
    setLoading(false);
  }, []);

  // Load on mount and when page/sort changes (non-search)
  useEffect(() => {
    if (!isSearch) load('', page, sort);
  }, [page, sort, isSearch, load]);

  // Debounced search as user types
  useEffect(() => {
    if (!isSearch) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      load(query, 1, sort);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, load, isSearch, sort]);

  const handlePageChange = (pg) => {
    setPage(pg);
    if (isSearch) load(query, pg, sort);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSortChange = (e) => {
    setSort(e.target.value);
    setPage(1);
  };

  const clearSearch = () => {
    setQuery('');
    setPage(1);
    if (inputRef.current) inputRef.current.value = '';
    load('', 1, sort);
  };

  return (
    <section className="explore-browser">
      <div className="explore-controls">
        <div className="explore-search-bar">
          <svg className="explore-search-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="explore-search-input"
            placeholder="Search all documents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="explore-clear-btn" onClick={clearSearch} aria-label="Clear search">
              &times;
            </button>
          )}
        </div>
        <div className="explore-filters">
          <select className="explore-sort" value={sort} onChange={handleSortChange}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">By title</option>
            <option value="project">By project</option>
          </select>
        </div>
      </div>

      <div className="explore-status-bar">
        <span className="explore-count">
          {loading ? 'Loading...' : `${total} document${total !== 1 ? 's' : ''}${isSearch ? ' found' : ''}`}
        </span>
      </div>

      {!loading && results.length === 0 && (
        <div className="explore-empty">
          {isSearch
            ? <p>No documents match &ldquo;{query.trim()}&rdquo;. Try a different search term.</p>
            : <p>No documents yet. Head to Projects to create your first document.</p>}
        </div>
      )}

      <div className="explore-grid">
        {results.map(item => (
          <ExploreCard
            key={item.id}
            item={item}
            isSearch={isSearch}
            onClick={() => navigate(`/editor/${item.id}`)}
          />
        ))}
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={handlePageChange} />
    </section>
  );
}

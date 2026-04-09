/**
 * Cloud Codex - Favorites Page
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import { ExploreCard, Pagination } from '../components/ExploreBrowser';
import { fetchFavorites, removeFavorite } from '../util';
import usePresence from '../hooks/usePresence';

const ITEMS_PER_PAGE = 12;

export default function FavoritesPage() {
  const navigate = useNavigate();
  const { getLogUsers } = usePresence();
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [favIds, setFavIds] = useState(new Set());

  const load = useCallback(async (pg) => {
    setLoading(true);
    try {
      const res = await fetchFavorites({ page: pg, limit: ITEMS_PER_PAGE });
      const items = res.results || [];
      setResults(items);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 0);
      setFavIds(new Set(items.map(r => r.id)));
    } catch {
      setResults([]);
      setTotal(0);
      setTotalPages(0);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(page); }, [page, load]);

  const handleToggleFavorite = useCallback(async (logId) => {
    try {
      await removeFavorite(logId);
      // Reload current page after unfavoriting
      load(page);
    } catch { /* ignore */ }
  }, [page, load]);

  const handlePageChange = (pg) => {
    setPage(pg);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <StdLayout>
      <div className="favorites-page">
        <div className="favorites-page__header">
          <h1>★ Favorites</h1>
          <span className="text-muted">
            {loading ? 'Loading...' : `${total} favorited document${total !== 1 ? 's' : ''}`}
          </span>
        </div>

        {!loading && results.length === 0 && (
          <div className="explore-empty">
            <p>You haven't favorited any documents yet. Click the ☆ star on any document to add it here.</p>
          </div>
        )}

        <div className="explore-grid">
          {results.map(item => (
            <ExploreCard
              key={item.id}
              item={item}
              isSearch={false}
              activeUsers={getLogUsers(item.id)}
              isFavorited={favIds.has(item.id)}
              onToggleFavorite={handleToggleFavorite}
              onClick={() => navigate(item.archive_id ? `/archives/${item.archive_id}/doc/${item.id}` : `/editor/${item.id}`)}
            />
          ))}
        </div>

        <Pagination page={page} totalPages={totalPages} onPageChange={handlePageChange} />
      </div>
    </StdLayout>
  );
}

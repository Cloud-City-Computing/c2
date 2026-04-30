/**
 * WorkspaceActivity — chronological feed of activity in a workspace.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import ActivityItem from '../components/ActivityItem';
import { fetchWorkspaceActivity, fetchWorkspaces, getErrorMessage } from '../util';

const FILTERS = [
  { key: 'all', label: 'All', prefix: '' },
  { key: 'log', label: 'Documents', prefix: 'log' },
  { key: 'comment', label: 'Comments', prefix: 'comment' },
  { key: 'archive', label: 'Archives', prefix: 'archive' },
  { key: 'squad', label: 'Squads', prefix: 'squad' },
];

const PAGE_SIZE = 50;

export default function WorkspaceActivity() {
  const { workspaceId: paramId } = useParams();
  const [searchParams] = useSearchParams();
  const queryWorkspace = searchParams.get('workspace');
  const [workspaceId, setWorkspaceId] = useState(paramId || queryWorkspace || null);
  const [workspaces, setWorkspaces] = useState([]);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);

  // Load the user's workspaces so the user can switch context.
  useEffect(() => {
    fetchWorkspaces()
      .then((res) => {
        const list = res?.workspaces || [];
        setWorkspaces(list);
        if (!workspaceId && list[0]) setWorkspaceId(String(list[0].id));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async ({ replace }) => {
    if (!workspaceId) return;
    setLoading(replace);
    setError(null);
    try {
      const before = replace || items.length === 0 ? undefined : items[items.length - 1].created_at;
      const prefix = FILTERS.find((f) => f.key === filter)?.prefix || '';
      const res = await fetchWorkspaceActivity({
        workspaceId,
        before,
        limit: PAGE_SIZE,
        actionPrefix: prefix,
      });
      const more = res?.results || [];
      setItems((prev) => (replace ? more : [...prev, ...more]));
      setHasMore(more.length === PAGE_SIZE);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, filter, items]);

  useEffect(() => {
    setItems([]);
    setHasMore(true);
    load({ replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, filter]);

  return (
    <StdLayout>
      <div className="activity-page">
        <header className="activity-page__header">
          <h1>Activity</h1>
          {workspaces.length > 1 && (
            <select
              value={workspaceId || ''}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="activity-page__workspace-select"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          )}
        </header>

        <nav className="activity-page__filters" aria-label="Filter activity">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`activity-page__filter${filter === f.key ? ' active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </nav>

        {error && <p className="form-error">{error}</p>}

        {loading && items.length === 0 ? (
          <div className="activity-page__empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="activity-page__empty">No activity yet.</div>
        ) : (
          <div className="activity-page__list">
            {items.map((entry) => (
              <ActivityItem key={entry.id} entry={entry} />
            ))}
          </div>
        )}

        {hasMore && items.length > 0 && (
          <div className="activity-page__load-more">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => load({ replace: false })}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}

        <p className="activity-page__footer">
          <Link to="/notifications">View your notifications →</Link>
        </p>
      </div>
    </StdLayout>
  );
}

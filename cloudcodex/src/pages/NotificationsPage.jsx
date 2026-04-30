/**
 * NotificationsPage — full inbox with filter tabs and mark-all.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import NotificationItem from '../components/NotificationItem';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../util';

const FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'unread', label: 'Unread', match: (n) => !n.read_at },
  { key: 'mention', label: 'Mentions', match: (n) => n.type === 'mention' },
  { key: 'comment', label: 'Comments', match: (n) => n.type === 'comment_on_my_doc' || n.type === 'watched_comment' },
  { key: 'watching', label: 'Watching', match: (n) => n.type?.startsWith('watched_') },
];

const PAGE_SIZE = 30;

export default function NotificationsPage() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const navigate = useNavigate();

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchNotifications({ limit: PAGE_SIZE });
      setItems(res?.results || []);
      setHasMore((res?.results || []).length === PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const loadMore = async () => {
    if (!hasMore || items.length === 0) return;
    const before = items[items.length - 1].created_at;
    const res = await fetchNotifications({ limit: PAGE_SIZE, before });
    const more = res?.results || [];
    setItems((prev) => [...prev, ...more]);
    if (more.length < PAGE_SIZE) setHasMore(false);
  };

  const handleActivate = async (notification) => {
    if (!notification.read_at) {
      try { await markNotificationRead(notification.id); } catch { /* ignore */ }
      setItems((prev) => prev.map((n) =>
        n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n,
      ));
    }
    if (notification.link_url && notification.link_url.startsWith('/')) {
      navigate(notification.link_url);
    }
  };

  const handleMarkAll = async () => {
    try { await markAllNotificationsRead(); } catch { /* ignore */ }
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
  };

  const visible = items.filter(FILTERS.find((f) => f.key === filter).match);
  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <StdLayout>
      <div className="notifications-page">
        <header className="notifications-page__header">
          <h1>Notifications</h1>
          <div className="notifications-page__actions">
            <Link to="/notifications/preferences" className="btn btn-ghost">Preferences</Link>
            {unreadCount > 0 && (
              <button type="button" className="btn btn-ghost" onClick={handleMarkAll}>
                Mark all read
              </button>
            )}
          </div>
        </header>

        <nav className="notifications-page__filters" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`notifications-page__filter${filter === f.key ? ' active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </nav>

        {loading ? (
          <div className="notifications-page__empty">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="notifications-page__empty">No notifications.</div>
        ) : (
          <div className="notifications-page__list">
            {visible.map((n) => (
              <NotificationItem key={n.id} notification={n} onActivate={handleActivate} />
            ))}
          </div>
        )}

        {hasMore && !loading && visible.length > 0 && (
          <div className="notifications-page__load-more">
            <button type="button" className="btn btn-ghost" onClick={loadMore}>
              Load more
            </button>
          </div>
        )}
      </div>
    </StdLayout>
  );
}

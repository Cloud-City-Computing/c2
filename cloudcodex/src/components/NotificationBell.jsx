/**
 * NotificationBell — header bell icon + dropdown of recent inbox items.
 *
 * Subscribes to the notification WebSocket via useNotificationChannel,
 * shows an unread badge, and opens a dropdown with the last 10 items.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useRef, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useNotificationChannel from '../hooks/useNotificationChannel';
import NotificationItem from './NotificationItem';
import useClickOutside from '../hooks/useClickOutside';

function BellIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export default function NotificationBell({ enabled = true }) {
  const { unreadCount, recent, markRead, markAllRead } = useNotificationChannel(enabled);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();

  useClickOutside(wrapRef, open, () => setOpen(false));

  // Close dropdown on Escape
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleActivate = (notification) => {
    if (!notification.read_at) markRead(notification.id);
    setOpen(false);
    if (notification.link_url && notification.link_url.startsWith('/')) {
      navigate(notification.link_url);
    }
  };

  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div className="notification-bell" ref={wrapRef}>
      <button
        type="button"
        className={`notification-bell__button${unreadCount > 0 ? ' has-unread' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications, ${unreadCount} unread`}
        aria-expanded={open}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="notification-bell__badge" aria-hidden="true">{badgeText}</span>
        )}
      </button>
      {open && (
        <div className="notification-bell__dropdown" role="menu" aria-live="polite">
          <div className="notification-bell__header">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button type="button" className="notification-bell__action" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          <div className="notification-bell__list">
            {recent.length === 0 ? (
              <div className="notification-bell__empty">You&rsquo;re all caught up.</div>
            ) : (
              recent.map((n) => (
                <NotificationItem key={n.id} notification={n} onActivate={handleActivate} />
              ))
            )}
          </div>
          <div className="notification-bell__footer">
            <Link to="/notifications" onClick={() => setOpen(false)}>View all</Link>
          </div>
        </div>
      )}
    </div>
  );
}

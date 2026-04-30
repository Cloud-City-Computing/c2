/**
 * NotificationItem — single row inside the inbox dropdown / page.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { Link } from 'react-router-dom';
import { timeAgo } from '../util';

function ActorAvatar({ name, url }) {
  if (url) {
    return <img src={url} alt={name || ''} className="notification-item__avatar" />;
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return <div className="notification-item__avatar notification-item__avatar--placeholder">{initial}</div>;
}

export default function NotificationItem({ notification, onActivate }) {
  const unread = !notification.read_at;
  const href = notification.link_url || '#';
  const isInternal = href.startsWith('/');

  const handleClick = () => {
    if (onActivate) onActivate(notification);
  };

  const inner = (
    <>
      <ActorAvatar name={notification.actor_name} url={notification.actor_avatar} />
      <div className="notification-item__body">
        <div className="notification-item__title">{notification.title}</div>
        {notification.body && (
          <div className="notification-item__snippet">{notification.body.replace(/<[^>]*>/g, '').slice(0, 200)}</div>
        )}
        <div className="notification-item__meta">{timeAgo(notification.created_at)}</div>
      </div>
      {unread && <span className="notification-item__dot" aria-label="Unread" />}
    </>
  );

  const className = `notification-item${unread ? ' notification-item--unread' : ''}`;

  if (isInternal) {
    return (
      <Link to={href} className={className} onClick={handleClick}>
        {inner}
      </Link>
    );
  }
  return (
    <a href={href} className={className} onClick={handleClick}>
      {inner}
    </a>
  );
}

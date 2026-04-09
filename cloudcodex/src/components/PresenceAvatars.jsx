/**
 * PresenceAvatars — Compact presence indicator showing active users on a log.
 *
 * Shows colored avatar circles (like CollabPresence) that can be embedded
 * in cards, log tree items, and other compact layouts.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';

export default function PresenceAvatars({ users }) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!users || users.length === 0) return null;

  return (
    <div
      className="presence-avatars"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span className="presence-dot" />
      {users.slice(0, 3).map((u) => (
        <span
          key={u.id}
          className="presence-avatar"
          style={{ backgroundColor: u.avatar_url ? 'transparent' : u.color }}
          title={u.name}
        >
          {u.avatar_url
            ? <img src={u.avatar_url} alt={u.name} />
            : (u.name?.charAt(0)?.toUpperCase() || '?')}
        </span>
      ))}
      {users.length > 3 && (
        <span className="presence-overflow">+{users.length - 3}</span>
      )}
      {showTooltip && users.length > 0 && (
        <div className="presence-tooltip">
          {users.map((u) => (
            <div key={u.id} className="presence-tooltip__user">
              <span className="presence-avatar presence-avatar--sm" style={{ backgroundColor: u.avatar_url ? 'transparent' : u.color }}>
                {u.avatar_url
                  ? <img src={u.avatar_url} alt={u.name} />
                  : (u.name?.charAt(0)?.toUpperCase() || '?')}
              </span>
              <span>{u.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

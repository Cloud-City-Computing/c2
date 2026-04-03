/**
 * CollabPresence — Shows who is currently editing the document.
 *
 * Displays colored avatar circles for each connected user.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';

export default function CollabPresence({ users, connected }) {
  const [expanded, setExpanded] = useState(false);

  if (!connected) {
    return (
      <div className="collab-presence collab-presence--disconnected" title="Reconnecting...">
        <span className="collab-status-dot collab-status-dot--offline" />
        <span className="collab-status-label">Offline</span>
      </div>
    );
  }

  return (
    <div className="collab-presence" onClick={() => setExpanded(e => !e)}>
      <span className="collab-status-dot collab-status-dot--online" />
      <div className="collab-avatars">
        {users.map((u) => (
          <span
            key={u.id}
            className="collab-avatar"
            style={{ backgroundColor: u.avatar_url ? 'transparent' : u.color }}
            title={u.name}
          >
            {u.avatar_url
              ? <img src={u.avatar_url} alt={u.name} />
              : (u.name?.charAt(0)?.toUpperCase() || '?')}
          </span>
        ))}
      </div>
      {expanded && users.length > 0 && (
        <div className="collab-user-list">
          {users.map((u) => (
            <div key={u.id} className="collab-user-list__item">
              <span className="collab-avatar collab-avatar--sm" style={{ backgroundColor: u.avatar_url ? 'transparent' : u.color }}>
                {u.avatar_url
                  ? <img src={u.avatar_url} alt={u.name} />
                  : (u.name?.charAt(0)?.toUpperCase() || '?')}
              </span>
              <span className="collab-user-list__name">{u.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

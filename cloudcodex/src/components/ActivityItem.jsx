/**
 * ActivityItem — single row in the workspace / per-doc activity feed.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { Link } from 'react-router-dom';
import { timeAgo } from '../util';

function safeMetadata(meta) {
  if (!meta) return {};
  if (typeof meta === 'string') {
    try { return JSON.parse(meta); } catch { return {}; }
  }
  return meta;
}

function actionVerb(action) {
  switch (action) {
    case 'log.create':       return 'created';
    case 'log.update':       return 'edited';
    case 'log.publish':      return 'published';
    case 'log.restore':      return 'restored';
    case 'log.rename':       return 'renamed';
    case 'log.delete':       return 'deleted a log in';
    case 'log.move':         return 'moved';
    case 'comment.create':   return 'commented on';
    case 'comment.reply':    return 'replied on';
    case 'comment.resolve':  return 'resolved a comment on';
    case 'comment.dismiss':  return 'dismissed a comment on';
    case 'comment.reopen':   return 'reopened a comment on';
    case 'comment.delete':   return 'deleted a comment on';
    case 'archive.create':   return 'created the archive';
    case 'archive.rename':   return 'renamed the archive';
    case 'archive.delete':   return 'deleted the archive';
    case 'version.delete':   return 'deleted a version of';
    case 'squad.member_join':   return 'joined the squad';
    case 'squad.member_leave':  return 'left the squad';
    case 'squad.invite_create': return 'invited a member to';
    default: return action;
  }
}

function ResourceLink({ entry, meta }) {
  if (entry.resource_type === 'log') {
    return <Link to={`/editor/${entry.resource_id}`}>{meta.title || `log #${entry.resource_id}`}</Link>;
  }
  if (entry.resource_type === 'archive') {
    return <Link to={`/archives/${entry.resource_id}`}>{meta.name || `archive #${entry.resource_id}`}</Link>;
  }
  if (entry.resource_type === 'comment' && meta.log_id) {
    return <Link to={`/editor/${meta.log_id}#comment-${entry.resource_id}`}>{meta.snippet ? `“${meta.snippet}”` : `log #${meta.log_id}`}</Link>;
  }
  return <span>{entry.resource_type} #{entry.resource_id}</span>;
}

function ActorAvatar({ name, url }) {
  if (url) return <img src={url} alt="" className="activity-item__avatar" />;
  const ch = (name || '?').charAt(0).toUpperCase();
  return <div className="activity-item__avatar activity-item__avatar--placeholder">{ch}</div>;
}

export default function ActivityItem({ entry }) {
  const meta = safeMetadata(entry.metadata);
  return (
    <div className="activity-item">
      <ActorAvatar name={entry.actor_name} url={entry.actor_avatar} />
      <div className="activity-item__body">
        <div className="activity-item__line">
          <span className="activity-item__actor">{entry.actor_name || 'Someone'}</span>{' '}
          <span className="activity-item__verb">{actionVerb(entry.action)}</span>{' '}
          <ResourceLink entry={entry} meta={meta} />
        </div>
        <div className="activity-item__meta">{timeAgo(entry.created_at)}</div>
      </div>
    </div>
  );
}

/**
 * CommentSidebar — Google Docs-style margin comments for the editor.
 *
 * Displays floating comments in the right margin, anchored to their highlighted
 * text selection. Supports creating, replying, resolving, dismissing, reopening,
 * and deleting comments. Tags drive visual styling.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';
import { toastError } from './Toast';

const TAG_LABELS = {
  comment: 'Comment',
  suggestion: 'Suggestion',
  question: 'Question',
  issue: 'Issue',
  note: 'Note',
};

const TAG_OPTIONS = Object.entries(TAG_LABELS);

function timeAgo(dateStr) {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function CommentThread({
  comment,
  currentUserId,
  onResolve,
  onDismiss,
  onReopen,
  onDelete,
  onReply,
  onDeleteReply,
  isHighlighted,
  onMouseEnter,
  onMouseLeave,
}) {
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleReply = async () => {
    if (!replyText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onReply(comment.id, replyText.trim());
      setReplyText('');
      setShowReply(false);
    } catch (e) { toastError(e); }
    setSubmitting(false);
  };

  const isAuthor = comment.user_id === currentUserId;
  const isOpen = comment.status === 'open';

  return (
    <div
      className={`comment-thread comment-thread--${comment.tag} ${comment.status !== 'open' ? 'comment-thread--resolved' : ''} ${isHighlighted ? 'comment-thread--highlighted' : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onMouseEnter}
      onBlur={(e) => {
        // Only fire leave if focus is leaving the thread entirely
        if (!e.currentTarget.contains(e.relatedTarget)) onMouseLeave?.();
      }}
      data-comment-id={comment.id}
    >
      <div className="comment-thread__header">
        <span className={`comment-tag comment-tag--${comment.tag}`}>{TAG_LABELS[comment.tag] || comment.tag}</span>
        <span className="comment-thread__meta">{comment.user_name} &middot; {timeAgo(comment.created_at)}</span>
        {comment.status !== 'open' && (
          <span className="comment-thread__status-badge">{comment.status}</span>
        )}
      </div>

      {comment.selected_text && (
        <div className="comment-thread__selection">
          <span className="comment-thread__selection-icon">&#8220;</span>
          {comment.selected_text}
        </div>
      )}

      <div className="comment-thread__body">{comment.content}</div>

      {/* Replies */}
      {comment.replies?.length > 0 && (
        <div className="comment-thread__replies">
          {comment.replies.map(r => (
            <div key={r.id} className="comment-reply">
              <div className="comment-reply__header">
                <span className="comment-reply__author">{r.user_name}</span>
                <span className="comment-reply__time">{timeAgo(r.created_at)}</span>
                {r.user_id === currentUserId && (
                  <button className="comment-btn comment-btn--icon" onClick={() => onDeleteReply(r.id, comment.id)} title="Delete reply">&times;</button>
                )}
              </div>
              <div className="comment-reply__body">{r.content}</div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="comment-thread__actions">
        {isOpen && (
          <>
            <button className="comment-btn comment-btn--sm" onClick={() => setShowReply(s => !s)}>Reply</button>
            <button className="comment-btn comment-btn--sm comment-btn--resolve" onClick={() => onResolve(comment.id)}>Resolve</button>
            <button className="comment-btn comment-btn--sm comment-btn--dismiss" onClick={() => onDismiss(comment.id)}>Dismiss</button>
          </>
        )}
        {!isOpen && (
          <button className="comment-btn comment-btn--sm" onClick={() => onReopen(comment.id)}>Reopen</button>
        )}
        {isAuthor && (
          <button className="comment-btn comment-btn--sm comment-btn--delete" onClick={() => onDelete(comment.id)}>Delete</button>
        )}
      </div>

      {/* Reply form */}
      {showReply && (
        <div className="comment-thread__reply-form">
          <textarea
            className="comment-textarea"
            placeholder="Write a reply..."
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleReply(); }}
          />
          <div className="comment-thread__reply-actions">
            <button className="comment-btn comment-btn--primary comment-btn--sm" onClick={handleReply} disabled={submitting || !replyText.trim()}>
              {submitting ? 'Sending...' : 'Reply'}
            </button>
            <button className="comment-btn comment-btn--sm" onClick={() => setShowReply(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CommentSidebar({
  comments,
  currentUserId,
  onResolve,
  onDismiss,
  onReopen,
  onDelete,
  onReply,
  onDeleteReply,
  highlightedCommentId,
  onHoverComment,
  filterStatus,
  onFilterChange,
}) {
  const openComments = comments.filter(c => c.status === 'open');
  const closedComments = comments.filter(c => c.status !== 'open');
  const showAll = filterStatus === 'all';

  return (
    <div className="comment-sidebar">
      <div className="comment-sidebar__header">
        <h3 className="comment-sidebar__title">
          Comments
          {openComments.length > 0 && <span className="comment-sidebar__count">{openComments.length}</span>}
        </h3>
        <div className="comment-sidebar__filter">
          <button
            className={`comment-btn comment-btn--sm ${!showAll ? 'comment-btn--active' : ''}`}
            onClick={() => onFilterChange?.('open')}
          >Open</button>
          <button
            className={`comment-btn comment-btn--sm ${showAll ? 'comment-btn--active' : ''}`}
            onClick={() => onFilterChange?.('all')}
          >All</button>
        </div>
      </div>
      <div className="comment-sidebar__list">
        {openComments.length === 0 && !showAll && (
          <p className="comment-sidebar__empty">No open comments</p>
        )}
        {openComments.map(c => (
          <CommentThread
            key={c.id}
            comment={c}
            currentUserId={currentUserId}
            onResolve={onResolve}
            onDismiss={onDismiss}
            onReopen={onReopen}
            onDelete={onDelete}
            onReply={onReply}
            onDeleteReply={onDeleteReply}
            isHighlighted={highlightedCommentId === c.id}
            onMouseEnter={() => onHoverComment?.(c.id)}
            onMouseLeave={() => onHoverComment?.(null)}
          />
        ))}
        {showAll && closedComments.length > 0 && (
          <>
            <div className="comment-sidebar__divider">Resolved / Dismissed</div>
            {closedComments.map(c => (
              <CommentThread
                key={c.id}
                comment={c}
                currentUserId={currentUserId}
                onResolve={onResolve}
                onDismiss={onDismiss}
                onReopen={onReopen}
                onDelete={onDelete}
                onReply={onReply}
                onDeleteReply={onDeleteReply}
                isHighlighted={highlightedCommentId === c.id}
                onMouseEnter={() => onHoverComment?.(c.id)}
                onMouseLeave={() => onHoverComment?.(null)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

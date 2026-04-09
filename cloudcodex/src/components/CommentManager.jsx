/**
 * CommentManager — Modal dialog for managing all comments on a log.
 *
 * Features: filter by tag/status, bulk resolve, clear all, navigate to comment.
 * Can be invoked from the Editor toolbar or ArchiveBrowser.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import { toastError } from './Toast';
import {
  fetchComments,
  resolveComment,
  reopenComment,
  deleteComment,
  clearAllComments,
  addCommentReply,
  deleteCommentReply,
} from '../util';

const TAG_LABELS = {
  comment: 'Comment',
  suggestion: 'Suggestion',
  question: 'Question',
  issue: 'Issue',
  note: 'Note',
};

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

export default function CommentManager({ logId, logTitle, onClose, onNavigate }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterTag, setFilterTag] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [clearing, setClearing] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');

  const loadComments = useCallback(async () => {
    try {
      const res = await fetchComments(logId);
      setComments(res.comments || []);
    } catch (e) { toastError(e); }
    setLoading(false);
  }, [logId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  const filtered = comments.filter(c => {
    if (filterTag !== 'all' && c.tag !== filterTag) return false;
    if (filterStatus !== 'all' && c.status !== filterStatus) return false;
    return true;
  });

  const handleResolve = async (id) => {
    try {
      const res = await resolveComment(id, 'resolved');
      setComments(prev => prev.map(c => c.id === id ? { ...c, ...res.comment, replies: c.replies } : c));
    } catch (e) { toastError(e); }
  };

  const handleDismiss = async (id) => {
    try {
      const res = await resolveComment(id, 'dismissed');
      setComments(prev => prev.map(c => c.id === id ? { ...c, ...res.comment, replies: c.replies } : c));
    } catch (e) { toastError(e); }
  };

  const handleReopen = async (id) => {
    try {
      await reopenComment(id);
      setComments(prev => prev.map(c => c.id === id ? { ...c, status: 'open', resolved_by: null, resolved_at: null } : c));
    } catch (e) { toastError(e); }
  };

  const handleDelete = async (id) => {
    try {
      await deleteComment(id);
      setComments(prev => prev.filter(c => c.id !== id));
    } catch (e) { toastError(e); }
  };

  const handleClearAll = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await clearAllComments(logId);
      setComments([]);
    } catch (e) { toastError(e); }
    setClearing(false);
  };

  const handleReply = async (commentId) => {
    if (!replyText.trim()) return;
    try {
      const res = await addCommentReply(commentId, replyText.trim());
      setComments(prev => prev.map(c =>
        c.id === commentId ? { ...c, replies: [...(c.replies || []), res.reply] } : c
      ));
      setReplyText('');
      setReplyingTo(null);
    } catch (e) { toastError(e); }
  };

  const handleDeleteReply = async (replyId, commentId) => {
    try {
      await deleteCommentReply(replyId);
      setComments(prev => prev.map(c =>
        c.id === commentId ? { ...c, replies: (c.replies || []).filter(r => r.id !== replyId) } : c
      ));
    } catch (e) { toastError(e); }
  };

  const openCount = comments.filter(c => c.status === 'open').length;
  const resolvedCount = comments.filter(c => c.status !== 'open').length;

  return (
    <div className="comment-manager">
      <div className="comment-manager__header">
        <h2>Comments{logTitle ? ` — ${logTitle}` : ''}</h2>
        <button className="btn btn-ghost" onClick={onClose}>&times;</button>
      </div>

      <div className="comment-manager__stats">
        <span className="comment-manager__stat">{openCount} open</span>
        <span className="comment-manager__stat">{resolvedCount} resolved</span>
        <span className="comment-manager__stat">{comments.length} total</span>
      </div>

      <div className="comment-manager__filters">
        <div className="comment-manager__filter-group">
          <label>Tag:</label>
          <select value={filterTag} onChange={e => setFilterTag(e.target.value)}>
            <option value="all">All</option>
            {Object.entries(TAG_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="comment-manager__filter-group">
          <label>Status:</label>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>
        <button className="btn btn-ghost btn-sm btn-danger" onClick={handleClearAll} disabled={clearing || comments.length === 0}>
          {clearing ? 'Clearing...' : 'Clear All'}
        </button>
      </div>

      {loading ? (
        <p className="text-muted">Loading comments...</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted">No comments match the current filters.</p>
      ) : (
        <div className="comment-manager__list">
          {filtered.map(c => (
            <div key={c.id} className={`comment-manager__item comment-manager__item--${c.tag} ${c.status !== 'open' ? 'comment-manager__item--closed' : ''}`}>
              <div className="comment-manager__item-header">
                <span className={`comment-tag comment-tag--${c.tag}`}>{TAG_LABELS[c.tag] || c.tag}</span>
                <span className="comment-manager__item-author">{c.user_name}</span>
                <span className="comment-manager__item-time">{timeAgo(c.created_at)}</span>
                {c.status !== 'open' && <span className="comment-manager__item-status">{c.status}</span>}
              </div>

              {c.selected_text && (
                <div className="comment-manager__item-quote">
                  &#8220;{c.selected_text}&#8221;
                </div>
              )}

              <div className="comment-manager__item-body">{c.content}</div>

              {/* Replies */}
              {c.replies?.length > 0 && (
                <div className="comment-manager__replies">
                  {c.replies.map(r => (
                    <div key={r.id} className="comment-manager__reply">
                      <span className="comment-manager__reply-author">{r.user_name}</span>
                      <span className="comment-manager__reply-time">{timeAgo(r.created_at)}</span>
                      <div className="comment-manager__reply-body">{r.content}</div>
                      {r.user_id && (
                        <button className="comment-btn comment-btn--icon" onClick={() => handleDeleteReply(r.id, c.id)} title="Delete reply">&times;</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="comment-manager__item-actions">
                {onNavigate && (
                  <button className="comment-btn comment-btn--sm" onClick={() => onNavigate(c)}>Go to</button>
                )}
                {replyingTo === c.id ? (
                  <div className="comment-manager__reply-form">
                    <textarea
                      className="comment-textarea"
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder="Write a reply..."
                      rows={2}
                    />
                    <button className="comment-btn comment-btn--primary comment-btn--sm" onClick={() => handleReply(c.id)} disabled={!replyText.trim()}>Reply</button>
                    <button className="comment-btn comment-btn--sm" onClick={() => { setReplyingTo(null); setReplyText(''); }}>Cancel</button>
                  </div>
                ) : (
                  <button className="comment-btn comment-btn--sm" onClick={() => setReplyingTo(c.id)}>Reply</button>
                )}
                {c.status === 'open' ? (
                  <>
                    <button className="comment-btn comment-btn--sm comment-btn--resolve" onClick={() => handleResolve(c.id)}>Resolve</button>
                    <button className="comment-btn comment-btn--sm comment-btn--dismiss" onClick={() => handleDismiss(c.id)}>Dismiss</button>
                  </>
                ) : (
                  <button className="comment-btn comment-btn--sm" onClick={() => handleReopen(c.id)}>Reopen</button>
                )}
                <button className="comment-btn comment-btn--sm comment-btn--delete" onClick={() => handleDelete(c.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

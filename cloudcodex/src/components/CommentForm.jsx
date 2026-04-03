/**
 * CommentForm — Floating form for creating a new comment from a text selection.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useRef, useEffect } from 'react';

const TAG_OPTIONS = [
  ['comment', 'Comment'],
  ['suggestion', 'Suggestion'],
  ['question', 'Question'],
  ['issue', 'Issue'],
  ['note', 'Note'],
];

export default function CommentForm({ selectedText, onSubmit, onCancel }) {
  const [content, setContent] = useState('');
  const [tag, setTag] = useState('comment');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ content: content.trim(), tag });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="comment-form">
      {selectedText && (
        <div className="comment-form__selection">
          <span className="comment-form__selection-label">Selected:</span>
          <span className="comment-form__selection-text">&#8220;{selectedText.length > 80 ? selectedText.slice(0, 80) + '...' : selectedText}&#8221;</span>
        </div>
      )}
      <div className="comment-form__tag-row">
        {TAG_OPTIONS.map(([value, label]) => (
          <button
            key={value}
            className={`comment-tag-btn comment-tag-btn--${value} ${tag === value ? 'comment-tag-btn--active' : ''}`}
            onClick={() => setTag(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        className="comment-textarea"
        placeholder="Add a comment..."
        value={content}
        onChange={e => setContent(e.target.value)}
        rows={3}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
      />
      <div className="comment-form__actions">
        <button
          className="comment-btn comment-btn--primary"
          onClick={handleSubmit}
          disabled={submitting || !content.trim()}
        >
          {submitting ? 'Adding...' : 'Add Comment'}
        </button>
        <button className="comment-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

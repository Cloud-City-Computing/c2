/**
 * NotificationPreferences — per-user toggles for email-on-event.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
  getErrorMessage,
} from '../util';

const TOGGLES = [
  { key: 'email_mention', label: 'When someone @mentions me', description: 'Document or comment mentions.' },
  { key: 'email_comment_on_my_doc', label: 'Comments on my documents', description: 'Anyone comments on a doc I created.' },
  { key: 'email_watched_comment', label: 'Comments on docs I watch', description: 'New comments on docs / archives I subscribed to.' },
  { key: 'email_watched_publish', label: 'New version published', description: 'Someone publishes a version of a watched doc.' },
  { key: 'email_watched_log_update', label: 'Edits to docs I watch', description: 'Off by default — can be noisy on active docs.' },
  { key: 'email_squad_invite', label: 'Squad invitations', description: 'You are invited to join a squad.' },
];

export default function NotificationPreferences() {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchNotificationPreferences();
      setPrefs(res?.prefs || {});
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (key, value) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaving(true);
    setError(null);
    try {
      const res = await updateNotificationPreferences({ [key]: value });
      setPrefs(res?.prefs || next);
      setSavedAt(Date.now());
    } catch (err) {
      setError(getErrorMessage(err));
      // Revert
      setPrefs(prefs);
    } finally {
      setSaving(false);
    }
  };

  return (
    <StdLayout>
      <div className="notification-prefs-page">
        <header className="notification-prefs-page__header">
          <h1>Notification preferences</h1>
          <Link to="/notifications">&larr; Back to inbox</Link>
        </header>

        {error && <p className="form-error">{error}</p>}

        {!prefs ? (
          <p>Loading…</p>
        ) : (
          <ul className="notification-prefs-page__list">
            {TOGGLES.map(({ key, label, description }) => (
              <li key={key} className="notification-prefs-page__item">
                <label className="notification-prefs-page__label">
                  <input
                    type="checkbox"
                    checked={Boolean(prefs[key])}
                    onChange={(e) => handleToggle(key, e.target.checked)}
                    disabled={saving}
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {savedAt && <p className="notification-prefs-page__saved">Saved.</p>}
      </div>
    </StdLayout>
  );
}

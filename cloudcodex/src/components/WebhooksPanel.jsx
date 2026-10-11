/**
 * Cloud Codex - Outbound Webhooks Panel (admin console)
 *
 * The subscriptions, a create form, the secret shown once, enable/disable,
 * rotate and delete behind a confirmation, and each subscription's recent
 * deliveries with Redeliver on a dead one. A stalled subscription says why in
 * plain words: its failures, the receiver's last answer and the next try.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import {
  fetchWebhooks,
  createWebhook,
  rotateWebhook,
  setWebhookEnabled,
  deleteWebhook,
  fetchWebhookDeliveries,
  redeliverWebhook,
  showModal,
  destroyModal,
  timeAgo,
} from '../util';
import ConfirmDialog from './ConfirmDialog';
import { showToast, toastError } from './Toast';

const EVENT_LABELS = {
  'log.update': 'Document saved',
  'log.publish': 'Version published',
  'log.restore': 'Version restored',
  'log.rename': 'Document renamed',
  'log.move': 'Document moved',
  'log.delete': 'Document deleted',
  'archive.rename': 'Archive renamed',
  'archive.delete': 'Archive deleted',
};

const STATE_LABELS = { delivering: 'Delivering', stalled: 'Stalled', off: 'Off' };
const DELIVERY_LABELS = { pending: 'Waiting to send', delivered: 'Delivered', dead: 'Not delivered' };

/** A subscription's state for the admin: off, stalled (failing in a row) or delivering. */
function stateOf(webhook) {
  if (!webhook.enabled) return 'off';
  if (webhook.consecutive_failures > 0) return 'stalled';
  return 'delivering';
}

/** The newest delivery that recorded a receiver's answer, or undefined. An expiry is not an answer. */
function lastFailure(rows) {
  return rows?.find((d) => d.last_error && !d.expired);
}

/** The receiver's last answer, in words an admin can act on. */
function describeAnswer(delivery) {
  const { last_status: status, last_error: error } = delivery;
  if (status === 401 || status === 403) {
    return `the receiver rejected the signature (${error}). Check that it uses the secret shown when this webhook was created or rotated. If it has lost that secret, rotate it and update the receiver.`;
  }
  return `${error}.`;
}

/**
 * Whether a dead delivery can go out again. `expired` is the server's own test
 * of the 72-hour window, the one its redeliver route answers 409 by.
 */
function canRedeliver(delivery) {
  return delivery.status === 'dead' && !delivery.expired;
}

function EventsSummary({ types }) {
  if (!types) return 'All events';
  return types.map((t) => EVENT_LABELS[t] ?? t).join(', ');
}

function CreateForm({ onCreated, onClose }) {
  const [url, setUrl] = useState('');
  const [types, setTypes] = useState([]);
  const [workspace, setWorkspace] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const toggleType = (type) => {
    setTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (url.trim() === '') {
      setError('A webhook url is required');
      return;
    }
    const body = { url: url.trim() };
    if (types.length > 0) body.event_types = types;
    if (workspace.trim() !== '') body.workspace_id = Number(workspace);

    setSaving(true);
    setError(null);
    try {
      const res = await createWebhook(body);
      onCreated(res);
    } catch (err) {
      setError(err.body?.message || err.message);
    }
    setSaving(false);
  };

  return (
    <form className="webhook-form" onSubmit={handleCreate} noValidate>
      <h4>New webhook</h4>
      <label className="webhook-form__label" htmlFor="webhook-new-url">Receiver URL</label>
      <input
        id="webhook-new-url"
        type="url"
        className="admin-filter-input webhook-form__input"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://receiver.example/codex"
      />
      <p className="webhook-form__help">It must be https. Private addresses are refused unless the server allows them.</p>

      <fieldset className="webhook-form__events">
        <legend>Events</legend>
        <p className="webhook-form__help">Leave all unticked to receive every event.</p>
        {Object.entries(EVENT_LABELS).map(([type, label]) => (
          <label key={type} className="webhook-form__check">
            <input type="checkbox" checked={types.includes(type)} onChange={() => toggleType(type)} />
            {label}
          </label>
        ))}
      </fieldset>

      <label className="webhook-form__label" htmlFor="webhook-new-workspace">Only this workspace (optional)</label>
      <input
        id="webhook-new-workspace"
        type="number"
        min="1"
        inputMode="numeric"
        className="admin-filter-input webhook-form__input"
        value={workspace}
        onChange={(e) => setWorkspace(e.target.value)}
      />

      {error && <p className="form-error webhook-form__error">{error}</p>}
      <div className="webhook-form__actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? 'Creating...' : 'Create webhook'}
        </button>
      </div>
    </form>
  );
}

function StalledNotice({ webhook, deliveries }) {
  const failure = lastFailure(deliveries);
  const next = webhook.paused_until ? new Date(webhook.paused_until) : null;
  const attempts = webhook.consecutive_failures;
  return (
    <div className="webhooks-stalled" role="alert">
      <p className="webhooks-stalled__title">
        Not delivering. {attempts} failed {attempts === 1 ? 'attempt' : 'attempts'} in a row. Later events wait behind the
        first one that has not gone through.
      </p>
      {failure && <p>Last answer: {describeAnswer(failure)}</p>}
      {next && next > new Date() && <p>Next try at {next.toLocaleTimeString()}.</p>}
      <p>Fix the receiver, or the event expires after 72 hours and is given up.</p>
    </div>
  );
}

function DeliveriesTable({ webhook, entry, onRedeliver }) {
  if (!entry) return <p className="text-muted">Loading...</p>;
  if (entry.error) return <p className="form-error">{entry.error}</p>;
  if (entry.rows.length === 0) return <p className="text-muted">No deliveries yet.</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table admin-table--compact webhook-deliveries">
        <caption className="webhook-deliveries__caption">Recent deliveries for {webhook.url}</caption>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">Status</th>
            <th scope="col">Attempts</th>
            <th scope="col">Last answer</th>
            <th scope="col">When</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {entry.rows.map((d) => (
            <tr key={d.id}>
              <td data-label="Event">{EVENT_LABELS[d.type] ?? d.type}</td>
              <td data-label="Status">{DELIVERY_LABELS[d.status] ?? d.status}</td>
              <td data-label="Attempts">{d.attempts}</td>
              <td data-label="Last answer">{d.last_error ?? '-'}</td>
              <td data-label="When">{timeAgo(d.created_at)}</td>
              <td className="webhook-deliveries__action">
                {!webhook.managed && canRedeliver(d) && (
                  <button className="btn btn-ghost btn-sm" onClick={() => onRedeliver(webhook, d)}>Redeliver</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WebhookCard({ webhook, entry, expanded, revealOpen, onToggle, onRedeliver, onToggleEnabled, onRotate, onDelete }) {
  const state = stateOf(webhook);
  const managed = webhook.managed;
  const urlId = `webhook-${webhook.id}-url`;
  const deliveriesId = `webhook-${webhook.id}-deliveries`;

  return (
    <article className={`webhook-card webhook-card--${state}`} aria-labelledby={urlId}>
      <header className="webhook-card__header">
        <code id={urlId} className="webhook-card__url">{webhook.url}</code>
        <span className={`status-badge webhook-state webhook-state--${state}`}>{STATE_LABELS[state]}</span>
      </header>

      {managed && <p className="webhook-card__source">Configured in the server environment</p>}
      {managed && <p className="text-muted webhook-card__note">Change it in the environment and restart to alter it.</p>}
      {state === 'off' && webhook.disabled_reason && <p className="webhook-card__reason">{webhook.disabled_reason}</p>}
      {state === 'stalled' && <StalledNotice webhook={webhook} deliveries={entry?.rows} />}

      <dl className="webhook-card__facts">
        <div>
          <dt>Events</dt>
          <dd><EventsSummary types={webhook.event_types} /></dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>{webhook.workspace_id ? `Workspace ${webhook.workspace_id}` : 'All workspaces'}</dd>
        </div>
        {!managed && (
          <div>
            <dt>Secret fingerprint</dt>
            <dd><code>{webhook.secret_fingerprint}</code></dd>
          </div>
        )}
      </dl>

      <div className="webhook-card__actions">
        {!managed && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => onToggleEnabled(webhook)}>
              {webhook.enabled ? 'Turn off' : 'Turn on'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onRotate(webhook)} disabled={revealOpen}>Rotate secret</button>
            <button className="btn btn-ghost btn-sm btn-danger" onClick={() => onDelete(webhook)}>Delete</button>
          </>
        )}
        <button
          className="btn btn-ghost btn-sm"
          aria-expanded={expanded}
          aria-controls={deliveriesId}
          onClick={() => onToggle(webhook)}
        >
          {expanded ? 'Hide recent deliveries' : 'Recent deliveries'}
        </button>
      </div>

      {expanded && (
        <div id={deliveriesId} className="webhook-card__deliveries">
          <DeliveriesTable webhook={webhook} entry={entry} onRedeliver={onRedeliver} />
        </div>
      )}
    </article>
  );
}

export default function WebhooksPanel() {
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  // The one secret on screen: held here only until Done, never fetched again.
  const [reveal, setReveal] = useState(null);
  // Per subscription id: { rows } or { error }, and which cards are expanded.
  const [deliveries, setDeliveries] = useState({});
  const [expanded, setExpanded] = useState({});

  const loadDeliveries = useCallback(async (id) => {
    try {
      const res = await fetchWebhookDeliveries(id);
      setDeliveries((prev) => ({ ...prev, [id]: { rows: res.deliveries || [] } }));
    } catch (err) {
      setDeliveries((prev) => ({ ...prev, [id]: { error: err.body?.message || 'Could not load the deliveries.' } }));
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetchWebhooks();
      const list = res.webhooks || [];
      setWebhooks(list);
      // A stalled card states its last answer, so its deliveries are read up front.
      list.filter((w) => stateOf(w) === 'stalled').forEach((w) => loadDeliveries(w.id));
    } catch (err) {
      toastError(err);
    }
    setLoading(false);
  }, [loadDeliveries]);

  useEffect(() => { load(); }, [load]);

  const handleCreated = (res) => {
    setShowCreate(false);
    setReveal({ title: `Secret for ${res.webhook.url}`, secret: res.secret });
    load();
  };

  /**
   * Runs a confirmed action. However it ends, the dialog closes, so a failure is
   * never left behind a dimmer the user dismissed: it is reported as a toast, and
   * the list reloads, because a 404 means the row is already gone.
   */
  const settle = (action, { onDone = load, onFail = load } = {}) => async () => {
    try {
      await action();
      destroyModal();
      onDone();
    } catch (err) {
      destroyModal();
      if (err.status === 404) showToast(err.body?.message || 'That webhook no longer exists', 'error', 5000);
      else toastError(err);
      onFail();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(reveal.secret);
      showToast('Secret copied', 'success');
    } catch {
      showToast('Could not copy. Select the secret and copy it by hand.', 'error');
    }
  };

  const handleRotate = (webhook) => {
    showModal(
      <ConfirmDialog
        title={`Rotate the secret for ${webhook.url}?`}
        message="The current secret stops working at once. Set the new one on the receiver straight after; it is shown once."
        confirmLabel="Rotate secret"
        danger
        onConfirm={settle(async () => {
          const res = await rotateWebhook(webhook.id);
          setReveal({ title: `New secret for ${webhook.url}`, secret: res.secret });
        })}
      />
    );
  };

  const handleToggleEnabled = (webhook) => {
    const turningOn = !webhook.enabled;
    showModal(
      <ConfirmDialog
        title={`${turningOn ? 'Turn on' : 'Turn off'} ${webhook.url}?`}
        message={turningOn
          ? 'Cloud Codex starts sending to this receiver again. Turning it on clears the failure count, so the queued events go out in order.'
          : 'Cloud Codex stops sending to this receiver. Events keep queuing, and go out in order if you turn it on again.'}
        confirmLabel={turningOn ? 'Turn on' : 'Turn off'}
        danger={false}
        onConfirm={settle(() => setWebhookEnabled(webhook.id, turningOn))}
      />
    );
  };

  const handleDelete = (webhook) => {
    showModal(
      <ConfirmDialog
        title={`Delete ${webhook.url}?`}
        message="Its queued and past deliveries are removed too, and the receiver stops getting events at once. This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={settle(() => deleteWebhook(webhook.id))}
      />
    );
  };

  const handleRedeliver = (webhook, delivery) => {
    showModal(
      <ConfirmDialog
        title="Redeliver this event?"
        message="It goes back in the queue and is sent again, in order, before newer events for this webhook. Only do this once the receiver is fixed."
        confirmLabel="Redeliver"
        danger={false}
        onConfirm={settle(() => redeliverWebhook(delivery.id), {
          onDone: () => {
            showToast('Queued to send again', 'success');
            loadDeliveries(webhook.id);
            load();
          },
          onFail: () => {
            loadDeliveries(webhook.id);
            load();
          },
        })}
      />
    );
  };

  const handleToggleDeliveries = (webhook) => {
    const opening = !expanded[webhook.id];
    setExpanded((prev) => ({ ...prev, [webhook.id]: opening }));
    if (opening) loadDeliveries(webhook.id);
  };

  return (
    <div className="admin-panel webhooks-panel">
      <div className="admin-panel__header">
        <h3>Webhooks</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)} disabled={showCreate || Boolean(reveal)}>
          + New Webhook
        </button>
      </div>
      <p className="text-muted webhooks-panel__intro">
        Cloud Codex tells these receivers about document and archive changes. A secret is shown once, when it is made.
      </p>

      {reveal && (
        <section className="webhook-reveal" aria-labelledby="webhook-reveal-title">
          <h4 id="webhook-reveal-title">{reveal.title}</h4>
          <p className="webhook-reveal__warning">This secret will not be shown again</p>
          <p>Copy it now and set it on the receiver.</p>
          <div className="webhook-reveal__row">
            <code className="webhook-reveal__secret">{reveal.secret}</code>
            <button className="btn btn-ghost btn-sm" onClick={handleCopy}>Copy secret</button>
          </div>
          <p className="text-muted webhook-reveal__pause">Create and rotate are paused until you choose Done.</p>
          <button className="btn btn-primary btn-sm" onClick={() => setReveal(null)}>Done</button>
        </section>
      )}

      {showCreate && <CreateForm onCreated={handleCreated} onClose={() => setShowCreate(false)} />}

      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : webhooks.length === 0 ? (
        <p className="text-muted">No webhooks yet. Add one to tell a receiver about document and archive changes.</p>
      ) : (
        <div className="webhook-list">
          {webhooks.map((w) => (
            <WebhookCard
              key={w.id}
              webhook={w}
              entry={deliveries[w.id]}
              expanded={Boolean(expanded[w.id])}
              revealOpen={Boolean(reveal)}
              onToggle={handleToggleDeliveries}
              onRedeliver={handleRedeliver}
              onToggleEnabled={handleToggleEnabled}
              onRotate={handleRotate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

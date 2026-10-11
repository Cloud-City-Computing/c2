/**
 * Cloud Codex — Tests for src/components/WebhooksPanel.jsx
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebhooksPanel from '../../../src/components/WebhooksPanel.jsx';

const api = vi.hoisted(() => ({
  fetchWebhooks: vi.fn(),
  createWebhook: vi.fn(),
  rotateWebhook: vi.fn(),
  setWebhookEnabled: vi.fn(),
  deleteWebhook: vi.fn(),
  fetchWebhookDeliveries: vi.fn(),
  redeliverWebhook: vi.fn(),
  showModal: vi.fn(),
  destroyModal: vi.fn(),
}));

vi.mock('../../../src/util.jsx', () => ({ ...api, timeAgo: () => '1m ago' }));
vi.mock('../../../src/components/Toast.jsx', () => ({ showToast: vi.fn(), toastError: vi.fn() }));

const FUTURE = new Date(Date.now() + 5 * 60 * 1000).toISOString();
const CREATED = '2026-10-01T00:00:00.000Z';
const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);

const ENV_ROW = {
  id: 1, url: 'https://env.example/hook', source: 'env', managed: true, enabled: true,
  event_types: null, workspace_id: null, disabled_reason: null, consecutive_failures: 0,
  paused_until: null, created_by: null, created_at: CREATED, secret_fingerprint: null,
};
const HEALTHY = {
  id: 2, url: 'https://healthy.example/hook', source: 'admin', managed: false, enabled: true,
  event_types: ['log.rename'], workspace_id: null, disabled_reason: null, consecutive_failures: 0,
  paused_until: null, created_by: 5, created_at: CREATED, secret_fingerprint: '1a2b3c4d',
};
const STALLED = {
  id: 3, url: 'https://stalled.example/hook', source: 'admin', managed: false, enabled: true,
  event_types: null, workspace_id: 4, disabled_reason: null, consecutive_failures: 4,
  paused_until: FUTURE, created_by: 5, created_at: CREATED, secret_fingerprint: '9f8e7d6c',
};
const DISABLED = {
  id: 4, url: 'https://off.example/hook', source: 'admin', managed: false, enabled: false,
  event_types: null, workspace_id: null, disabled_reason: 'Disabled by an administrator',
  consecutive_failures: 0, paused_until: null, created_by: 5, created_at: CREATED,
  secret_fingerprint: '00ff00ff',
};

const STALLED_DELIVERIES = {
  success: true,
  deliveries: [
    { id: 31, event_id: 905, type: 'log.update', status: 'pending', attempts: 4, last_status: 401,
      last_error: 'HTTP 401', delivered_at: null, created_at: CREATED },
    { id: 30, event_id: 904, type: 'log.rename', status: 'dead', attempts: 0, last_status: 422,
      last_error: 'receiver answered 422', delivered_at: null, created_at: CREATED },
    { id: 29, event_id: 900, type: 'log.move', status: 'dead', attempts: 0, last_status: null,
      last_error: 'expired after 72h', delivered_at: null, created_at: CREATED },
  ],
};

/** Renders the last dialog the panel handed to showModal, as the overlay would. */
function renderLastModal() {
  const element = api.showModal.mock.calls.at(-1)[0];
  return render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchWebhooks.mockResolvedValue({ success: true, webhooks: [ENV_ROW, HEALTHY, STALLED, DISABLED] });
  api.fetchWebhookDeliveries.mockImplementation(async (id) =>
    id === STALLED.id ? STALLED_DELIVERIES : { success: true, deliveries: [] }
  );
});

describe('WebhooksPanel: rendering', () => {
  it('lists every subscription by its URL, with the env row read-only and labelled', async () => {
    render(<WebhooksPanel />);
    expect(await screen.findByText('https://env.example/hook')).toBeInTheDocument();
    expect(screen.getByText('Configured in the server environment')).toBeInTheDocument();
    const envCard = screen.getByText('https://env.example/hook').closest('article');
    expect(within(envCard).queryByRole('button', { name: /rotate|delete|turn off|turn on/i })).toBeNull();
  });

  it('shows a healthy, a stalled and an off subscription as three readable states', async () => {
    render(<WebhooksPanel />);
    await screen.findByText('https://healthy.example/hook');
    // The env row and the healthy row are both delivering.
    expect(screen.getAllByText('Delivering')).toHaveLength(2);
    expect(screen.getByText('Stalled')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('explains a stalled subscription in plain words: the failures, the rejected signature and the next try', async () => {
    render(<WebhooksPanel />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/4 failed attempts in a row/i);
    expect(alert).toHaveTextContent(/rejected the signature/i);
    expect(alert).toHaveTextContent(/next try/i);
    expect(alert).toHaveTextContent(/72 hours/i);
  });

  it('shows the fingerprint and never a secret in the list', async () => {
    const { container } = render(<WebhooksPanel />);
    await screen.findByText('https://healthy.example/hook');
    expect(screen.getByText(/1a2b3c4d/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[0-9a-f]{64}/);
  });

  it('says so when no subscription exists yet', async () => {
    api.fetchWebhooks.mockResolvedValue({ success: true, webhooks: [] });
    render(<WebhooksPanel />);
    expect(await screen.findByText(/no webhooks yet/i)).toBeInTheDocument();
  });
});

describe('WebhooksPanel: create', () => {
  it('refuses an empty URL in the form without calling the API', async () => {
    const user = userEvent.setup();
    render(<WebhooksPanel />);
    await screen.findByText('https://healthy.example/hook');
    await user.click(screen.getByRole('button', { name: /new webhook/i }));
    await user.click(screen.getByRole('button', { name: /create webhook/i }));
    expect(screen.getByText('A webhook url is required')).toBeInTheDocument();
    expect(api.createWebhook).not.toHaveBeenCalled();
  });

  it('shows the API guard refusal as its own sentence', async () => {
    const user = userEvent.setup();
    api.createWebhook.mockRejectedValue(Object.assign(
      new Error('Receiver addresses must be https.'), { status: 400, body: { success: false, message: 'Receiver addresses must be https.' } }
    ));
    render(<WebhooksPanel />);
    await screen.findByText('https://healthy.example/hook');
    await user.click(screen.getByRole('button', { name: /new webhook/i }));
    await user.type(screen.getByLabelText(/receiver url/i), 'http://plain.example/hook');
    await user.click(screen.getByRole('button', { name: /create webhook/i }));
    expect(await screen.findByText('Receiver addresses must be https.')).toBeInTheDocument();
  });

  it('shows the cap refusal as the API sentence', async () => {
    const user = userEvent.setup();
    const message = 'This instance already has the maximum of 50 webhook subscriptions; remove one first';
    api.createWebhook.mockRejectedValue(Object.assign(new Error(message), { status: 409, body: { message } }));
    render(<WebhooksPanel />);
    await screen.findByText('https://healthy.example/hook');
    await user.click(screen.getByRole('button', { name: /new webhook/i }));
    await user.type(screen.getByLabelText(/receiver url/i), 'https://new.example/hook');
    await user.click(screen.getByRole('button', { name: /create webhook/i }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('creates with the URL, the chosen events and the workspace, and shows the new secret once', async () => {
    const user = userEvent.setup();
    api.createWebhook.mockResolvedValue({ success: true, webhook: { ...HEALTHY, id: 9, url: 'https://new.example/hook' }, secret: SECRET_A });
    render(<WebhooksPanel />);
    await screen.findByText('https://healthy.example/hook');
    await user.click(screen.getByRole('button', { name: /new webhook/i }));
    await user.type(screen.getByLabelText(/receiver url/i), 'https://new.example/hook');
    await user.click(screen.getByRole('checkbox', { name: /document renamed/i }));
    await user.type(screen.getByLabelText(/only this workspace/i), '4');
    await user.click(screen.getByRole('button', { name: /create webhook/i }));

    await waitFor(() => expect(api.createWebhook).toHaveBeenCalledWith({
      url: 'https://new.example/hook', event_types: ['log.rename'], workspace_id: 4,
    }));
    expect(await screen.findByText(SECRET_A)).toBeInTheDocument();
    expect(screen.getByText('This secret will not be shown again')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy secret/i })).toBeInTheDocument();
  });

  it('sends no event list or workspace when none is chosen', async () => {
    const user = userEvent.setup();
    api.createWebhook.mockResolvedValue({ success: true, webhook: { ...HEALTHY, id: 9 }, secret: SECRET_A });
    render(<WebhooksPanel />);
    await screen.findByText('https://healthy.example/hook');
    await user.click(screen.getByRole('button', { name: /new webhook/i }));
    await user.type(screen.getByLabelText(/receiver url/i), 'https://new.example/hook');
    await user.click(screen.getByRole('button', { name: /create webhook/i }));
    await waitFor(() => expect(api.createWebhook).toHaveBeenCalledWith({ url: 'https://new.example/hook' }));
  });
});

describe('WebhooksPanel: rotate', () => {
  it('confirms first, then shows the new secret once and not after it is dismissed', async () => {
    const user = userEvent.setup();
    api.rotateWebhook.mockResolvedValue({ success: true, secret: SECRET_B, secret_fingerprint: 'bbbbbbbb' });
    const { unmount } = render(<WebhooksPanel />);
    const card = (await screen.findByText('https://healthy.example/hook')).closest('article');

    await user.click(within(card).getByRole('button', { name: /rotate secret/i }));
    expect(api.rotateWebhook).not.toHaveBeenCalled();
    const dialog = renderLastModal();
    await user.click(within(dialog.container).getByRole('button', { name: /rotate secret/i }));

    await waitFor(() => expect(api.rotateWebhook).toHaveBeenCalledWith(HEALTHY.id));
    expect(await screen.findByText(SECRET_B)).toBeInTheDocument();
    expect(screen.getAllByText(SECRET_B)).toHaveLength(1);
    expect(screen.getByText('This secret will not be shown again')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^done$/i }));
    expect(screen.queryByText(SECRET_B)).toBeNull();

    // A second mount fetches the list again; no response carries a secret.
    unmount();
    render(<WebhooksPanel />);
    await screen.findByText('https://healthy.example/hook');
    expect(screen.queryByText(SECRET_B)).toBeNull();
  });
});

describe('WebhooksPanel: enable, disable and delete', () => {
  it('turns a subscription off only after the confirmation', async () => {
    const user = userEvent.setup();
    api.setWebhookEnabled.mockResolvedValue({ success: true, webhook: { ...HEALTHY, enabled: false } });
    render(<WebhooksPanel />);
    const card = (await screen.findByText('https://healthy.example/hook')).closest('article');
    await user.click(within(card).getByRole('button', { name: /turn off/i }));
    expect(api.setWebhookEnabled).not.toHaveBeenCalled();
    const dialog = renderLastModal();
    await user.click(within(dialog.container).getByRole('button', { name: /turn off/i }));
    await waitFor(() => expect(api.setWebhookEnabled).toHaveBeenCalledWith(HEALTHY.id, false));
  });

  it('turns a disabled subscription back on, and says that it clears the failure count', async () => {
    const user = userEvent.setup();
    api.setWebhookEnabled.mockResolvedValue({ success: true, webhook: { ...DISABLED, enabled: true } });
    render(<WebhooksPanel />);
    const card = (await screen.findByText('https://off.example/hook')).closest('article');
    await user.click(within(card).getByRole('button', { name: /turn on/i }));
    expect(api.showModal.mock.calls.at(-1)[0].props.message).toMatch(/clears the failure count/i);
    const dialog = renderLastModal();
    await user.click(within(dialog.container).getByRole('button', { name: /turn on/i }));
    await waitFor(() => expect(api.setWebhookEnabled).toHaveBeenCalledWith(DISABLED.id, true));
  });

  it('deletes only after the confirmation', async () => {
    const user = userEvent.setup();
    api.deleteWebhook.mockResolvedValue({ success: true });
    render(<WebhooksPanel />);
    const card = (await screen.findByText('https://healthy.example/hook')).closest('article');
    await user.click(within(card).getByRole('button', { name: /delete/i }));
    expect(api.deleteWebhook).not.toHaveBeenCalled();
    const dialog = renderLastModal();
    await user.click(within(dialog.container).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(api.deleteWebhook).toHaveBeenCalledWith(HEALTHY.id));
  });
});

describe('WebhooksPanel: deliveries and redeliver', () => {
  it('lists a subscription deliveries, and offers Redeliver only on a dead one that can still go out', async () => {
    const user = userEvent.setup();
    render(<WebhooksPanel />);
    const card = (await screen.findByText('https://stalled.example/hook')).closest('article');
    await user.click(within(card).getByRole('button', { name: /recent deliveries/i }));

    const deadRow = (await within(card).findByText('receiver answered 422')).closest('tr');
    expect(within(deadRow).getByRole('button', { name: /redeliver/i })).toBeInTheDocument();

    const expiredRow = within(card).getByText('expired after 72h').closest('tr');
    expect(within(expiredRow).queryByRole('button', { name: /redeliver/i })).toBeNull();
  });

  it('redelivers after the confirmation', async () => {
    const user = userEvent.setup();
    api.redeliverWebhook.mockResolvedValue({ success: true, id: 30 });
    render(<WebhooksPanel />);
    const card = (await screen.findByText('https://stalled.example/hook')).closest('article');
    await user.click(within(card).getByRole('button', { name: /recent deliveries/i }));
    const deadRow = (await within(card).findByText('receiver answered 422')).closest('tr');
    await user.click(within(deadRow).getByRole('button', { name: /redeliver/i }));
    expect(api.redeliverWebhook).not.toHaveBeenCalled();

    const dialog = renderLastModal();
    await user.click(within(dialog.container).getByRole('button', { name: /^redeliver$/i }));
    await waitFor(() => expect(api.redeliverWebhook).toHaveBeenCalledWith(30));
  });

  it('shows a refusal from the redeliver route inside the confirmation', async () => {
    const user = userEvent.setup();
    const message = 'This event is older than 72 hours, so redelivering it would expire it again; it is not queued';
    api.redeliverWebhook.mockRejectedValue(Object.assign(new Error(message), { status: 409, body: { message } }));
    render(<WebhooksPanel />);
    const card = (await screen.findByText('https://stalled.example/hook')).closest('article');
    await user.click(within(card).getByRole('button', { name: /recent deliveries/i }));
    const deadRow = (await within(card).findByText('receiver answered 422')).closest('tr');
    await user.click(within(deadRow).getByRole('button', { name: /redeliver/i }));
    const dialog = renderLastModal();
    await user.click(within(dialog.container).getByRole('button', { name: /^redeliver$/i }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});

/**
 * The env-declared webhook subscription across boots, against a live MySQL server
 *
 * Each "boot" is one reconcileEnvSubscription call under a different
 * environment, which is what server.js runs before the port opens. The
 * receiver is a public address literal, so no DNS server is asked.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { reconcileEnvSubscription, ENV_UNSET_REASON } from '../../services/webhooks.js';

const SECRET = 'e'.repeat(64);
const URL_A = 'https://203.0.113.20/codex/events/instance-a';
const URL_B = 'https://203.0.113.21/codex/events/instance-b';
const NAMES = ['WEBHOOK_URL', 'WEBHOOK_SECRET', 'WEBHOOK_WORKSPACE_ID'];
const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));

/** One boot under `env`: its reconcile outcome, and the env rows after it. */
async function boot(env) {
  for (const name of NAMES) {
    if (env[name] === undefined) delete process.env[name];
    else process.env[name] = env[name];
  }
  const outcome = await reconcileEnvSubscription();
  const rows = await c2_query(
    `SELECT id, url, secret, enabled, workspace_id, disabled_reason, consecutive_failures
       FROM webhook_subscriptions WHERE source = 'env'`,
    []
  );
  return { outcome, rows };
}

/** A pending delivery of a fresh event to `subscription`. */
async function queueDelivery(subscription, uuid) {
  const event = await c2_query(
    `INSERT INTO webhook_events (event_uuid, type, workspace_id, occurred_at, body)
     VALUES (?, 'log.rename', 3, '2026-09-28 00:00:00.000', ?)`,
    [uuid, Buffer.from('{}', 'utf8')]
  );
  await c2_query('INSERT INTO webhook_deliveries (subscription_id, event_id) VALUES (?, ?)', [subscription, event.insertId]);
}

const pending = async (subscription) =>
  (await c2_query(`SELECT COUNT(*) AS n FROM webhook_deliveries WHERE subscription_id = ? AND status = 'pending'`, [
    subscription,
  ]))[0].n;

afterAll(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe('the env subscription across boots, on a real server', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  afterAll(() => errorSpy.mockRestore());

  it('an install with nothing configured writes nothing', async () => {
    const { outcome, rows } = await boot({});
    expect(outcome).toBe('none');
    expect(rows).toEqual([]);
  });

  let id;

  it('the first configured boot creates one row, enabled, with no stored secret', async () => {
    const { outcome, rows } = await boot({ WEBHOOK_URL: URL_A, WEBHOOK_SECRET: SECRET, WEBHOOK_WORKSPACE_ID: '3' });
    expect(outcome).toBe('created');
    expect(rows).toEqual([
      expect.objectContaining({ url: URL_A, secret: null, enabled: 1, workspace_id: 3, disabled_reason: null }),
    ]);
    id = rows[0].id;
  });

  it('an unchanged boot keeps the row and its queue', async () => {
    await queueDelivery(id, '00000000-0000-4000-8000-00000000e001');
    const { outcome, rows } = await boot({ WEBHOOK_URL: URL_A, WEBHOOK_SECRET: SECRET, WEBHOOK_WORKSPACE_ID: '3' });
    expect(outcome).toBe('updated');
    expect(rows.map((r) => r.id)).toEqual([id]);
    expect(await pending(id)).toBe(1);
  });

  it('a boot naming another workspace drops what was queued for the old one', async () => {
    await c2_query('UPDATE webhook_subscriptions SET consecutive_failures = 4 WHERE id = ?', [id]);
    const { outcome, rows } = await boot({ WEBHOOK_URL: URL_A, WEBHOOK_SECRET: SECRET, WEBHOOK_WORKSPACE_ID: '4' });
    expect(outcome).toBe('retargeted');
    expect(rows).toEqual([expect.objectContaining({ id, workspace_id: 4, consecutive_failures: 0, enabled: 1 })]);
    expect(await pending(id)).toBe(0);
  });

  it('a boot naming another receiver does the same', async () => {
    await queueDelivery(id, '00000000-0000-4000-8000-00000000e002');
    const { outcome, rows } = await boot({ WEBHOOK_URL: URL_B, WEBHOOK_SECRET: SECRET, WEBHOOK_WORKSPACE_ID: '4' });
    expect(outcome).toBe('retargeted');
    expect(rows).toEqual([expect.objectContaining({ id, url: URL_B })]);
    expect(await pending(id)).toBe(0);
  });

  it('a boot without the secret disables the row and keeps its queue', async () => {
    await queueDelivery(id, '00000000-0000-4000-8000-00000000e003');
    const { outcome, rows } = await boot({ WEBHOOK_URL: URL_B });
    expect(outcome).toBe('disabled');
    expect(rows).toEqual([expect.objectContaining({ id, enabled: 0, disabled_reason: ENV_UNSET_REASON })]);
    expect(await pending(id)).toBe(1);
  });

  it('a boot with a mistyped workspace disables it rather than widen it to every workspace', async () => {
    const { outcome, rows } = await boot({ WEBHOOK_URL: URL_B, WEBHOOK_SECRET: SECRET, WEBHOOK_WORKSPACE_ID: '4x' });
    expect(outcome).toBe('disabled');
    expect(rows).toEqual([
      expect.objectContaining({ id, enabled: 0, workspace_id: 4, disabled_reason: 'WEBHOOK_WORKSPACE_ID is not a positive whole number' }),
    ]);
  });

  it('a boot naming a metadata address disables it with the guard\'s sentence', async () => {
    const { outcome, rows } = await boot({ WEBHOOK_URL: 'http://169.254.169.254/latest', WEBHOOK_SECRET: SECRET });
    expect(outcome).toBe('disabled');
    expect(rows[0].disabled_reason).toMatch(/^The webhook URL resolves to 169\.254\.169\.254/);
    expect(rows[0].url).toBe(URL_B);
  });

  it('a boot with it all set again re-enables the same row, and never two', async () => {
    const { outcome, rows } = await boot({ WEBHOOK_URL: URL_B, WEBHOOK_SECRET: SECRET, WEBHOOK_WORKSPACE_ID: '4' });
    expect(outcome).toBe('updated');
    expect(rows).toEqual([expect.objectContaining({ id, enabled: 1, disabled_reason: null, secret: null })]);
    expect(await pending(id)).toBe(1);
  });

  it('never logs the secret', () => {
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(SECRET);
  });
});

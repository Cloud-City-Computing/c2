/**
 * Tests for outbound webhooks: the subscription cache, the env subscription and emitEvent
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { c2_query, withTransaction } from '../../mysql_connect.js';
import {
  EMITTED_TYPES,
  TEXT_BOUND,
  boundText,
  serializeEnvelope,
  loadSubscriptions,
  reconcileEnvSubscription,
  emitEvent,
  webhookTargetOptions,
  ENV_UNSET_REASON,
} from '../../services/webhooks.js';
import { resetMocks, TEST_USER } from '../helpers.js';

const SPEC_TYPES = [
  'log.update', 'log.publish', 'log.restore', 'log.rename',
  'log.move', 'log.delete', 'archive.rename', 'archive.delete',
];

const ENVELOPE_KEYS = ['schema', 'id', 'sequence', 'type', 'occurred_at', 'workspace_id', 'actor', 'data'];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A cached subscription row as loadSubscriptions reads it. */
const sub = (id, over = {}) => ({
  id, url: `https://r${id}.example/`, source: 'admin', enabled: 1, event_types: null, workspace_id: null,
  paused_until: null, ...over,
});

/** Load `rows` into the cache through the real loader. */
async function cache(rows) {
  c2_query.mockResolvedValueOnce(rows);
  await loadSubscriptions();
  c2_query.mockClear();
}

/**
 * Queue the writes an emit makes after its logs lookup: the event insert, the
 * body update and the deliveries insert.
 */
function queueEmitWrites(eventId = 1042) {
  c2_query
    .mockResolvedValueOnce({ insertId: eventId })
    .mockResolvedValueOnce({ affectedRows: 1 })
    .mockResolvedValueOnce({ affectedRows: 1 });
}

/** The SQL and params of every c2_query call, in order. */
const calls = () => c2_query.mock.calls.map(([sql, params]) => ({ sql, params }));

/** The stored body of the one emitted event, parsed. */
function emittedEnvelope() {
  const update = calls().find((c) => /UPDATE webhook_events SET body/.test(c.sql));
  expect(Buffer.isBuffer(update.params[0])).toBe(true);
  return JSON.parse(update.params[0].toString('utf8'));
}

const ctx = (over = {}) => ({
  user: TEST_USER,
  action: 'log.rename',
  resourceType: 'log',
  resourceId: 113,
  metadata: { title: 'Release checklist' },
  ...over,
});

describe('services/webhooks', () => {
  let errorSpy;
  const savedEnv = { ...process.env };

  beforeEach(async () => {
    resetMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await cache([]);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    for (const name of ['WEBHOOK_URL', 'WEBHOOK_SECRET', 'WEBHOOK_WORKSPACE_ID', 'WEBHOOK_ALLOW_PRIVATE_TARGETS', 'NODE_ENV']) {
      if (name in savedEnv) process.env[name] = savedEnv[name];
      else delete process.env[name];
    }
  });

  describe('the contract', () => {
    it('emits exactly the eight allowlisted types', () => {
      expect([...EMITTED_TYPES].sort()).toEqual([...SPEC_TYPES].sort());
    });

    it('bounds a 70,000-character title to its first 255 code points', () => {
      const long = 'x'.repeat(70_000);
      expect(boundText(long)).toBe('x'.repeat(TEXT_BOUND));
      expect(TEXT_BOUND).toBe(255);
    });

    it('keeps an astral 255th code point whole, with no lone surrogate', () => {
      const title = `${'a'.repeat(254)}\u{1F680}tail`;
      const bounded = boundText(title);
      expect(Array.from(bounded)).toHaveLength(255);
      expect(bounded.endsWith('\u{1F680}')).toBe(true);
      expect(bounded).toHaveLength(256); // 254 units plus one surrogate pair
      expect(bounded.isWellFormed()).toBe(true);
    });

    it('leaves a shorter title, and anything that is not a string, unchanged', () => {
      expect(boundText('Release checklist')).toBe('Release checklist');
      expect(boundText('')).toBe('');
      expect(boundText(null)).toBe(null);
      expect(boundText(undefined)).toBe(undefined);
    });

    it('serializes the worst case under 4 KiB, however its text escapes', () => {
      // Larger than any real envelope: the longest type, every data field of
      // every type at once, unbounded text of U+0001 (six bytes in JSON), the
      // BIGINT maximum as the sequence and the INT maximum everywhere else.
      const escapes = '\u0001'.repeat(70_000);
      const INT_MAX = 2_147_483_647;
      const longestType = [...EMITTED_TYPES].reduce((a, b) => (b.length > a.length ? b : a));
      const body = serializeEnvelope({
        id: '5b0e3c0e-8f0e-4a8c-9b7e-2c1d0f6a9e11',
        sequence: Number(9_223_372_036_854_775_807n),
        type: longestType,
        occurredAt: '2026-09-24T15:04:05.123Z',
        workspaceId: INT_MAX,
        actor: { id: INT_MAX, name: escapes },
        data: {
          log_id: INT_MAX, archive_id: INT_MAX, parent_id: INT_MAX, previous_parent_id: INT_MAX,
          version: INT_MAX, title: escapes, name: escapes,
        },
      });
      const bytes = Buffer.byteLength(body, 'utf8');
      expect(bytes).toBeLessThan(4096);
      // Measured when the bound landed; a change here means the envelope grew.
      expect(bytes).toBe(3631);
    });
  });

  describe('loadSubscriptions', () => {
    it('reads only enabled rows, and never a secret', async () => {
      c2_query.mockResolvedValueOnce([]);
      await loadSubscriptions();
      const [{ sql }] = calls();
      expect(sql).toMatch(/FROM webhook_subscriptions\s+WHERE enabled = TRUE/);
      expect(sql).not.toMatch(/secret/);
    });

    it('keeps the cache it had when the read fails, and says so', async () => {
      await cache([sub(1)]);
      c2_query.mockRejectedValueOnce(new Error('connection lost'));
      expect(await loadSubscriptions()).toBe(false);
      expect(errorSpy).toHaveBeenCalled();

      c2_query.mockResolvedValueOnce([{ archive_id: 29, title: 'T', parent_id: null }]);
      queueEmitWrites();
      expect(await emitEvent(ctx(), { workspaceId: 3, squadId: null })).toMatchObject({ eventId: 1042 });
    });

    it('accepts event_types as MySQL returns JSON, parsed or as text', async () => {
      await cache([
        sub(1, { event_types: ['log.delete'] }),
        sub(2, { event_types: '["log.rename"]' }),
      ]);
      c2_query.mockResolvedValueOnce([{ archive_id: 29, title: 'T', parent_id: null }]);
      queueEmitWrites();
      const result = await emitEvent(ctx(), { workspaceId: 3, squadId: null });
      expect(result.subscriptionIds).toEqual([2]);
    });
  });

  describe('emitEvent', () => {
    it('issues no query for an action outside the allowlist', async () => {
      await cache([sub(1)]);
      expect(await emitEvent(ctx({ action: 'comment.create', resourceType: 'comment' }), { workspaceId: 3 })).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
      expect(withTransaction).not.toHaveBeenCalled();
    });

    it('issues no query when no subscription is cached', async () => {
      for (const action of SPEC_TYPES) {
        expect(await emitEvent(ctx({ action }), { workspaceId: 3 })).toBeNull();
      }
      expect(c2_query).not.toHaveBeenCalled();
      expect(withTransaction).not.toHaveBeenCalled();
    });

    it('narrows by workspace: every-workspace and same-workspace subscriptions match, another workspace\'s does not', async () => {
      await cache([sub(1), sub(2, { workspace_id: 3 }), sub(3, { workspace_id: 4 })]);
      c2_query.mockResolvedValueOnce([{ archive_id: 29, title: 'T', parent_id: null }]);
      queueEmitWrites();
      const result = await emitEvent(ctx(), { workspaceId: 3, squadId: 8 });
      expect(result.subscriptionIds).toEqual([1, 2]);

      const deliveries = calls().find((c) => /INSERT INTO webhook_deliveries/.test(c.sql));
      // The database re-checks what the cache matched: the subscription is
      // still there, enabled, and for this workspace and type.
      expect(deliveries.sql).toMatch(/SELECT id, \? FROM webhook_subscriptions/);
      expect(deliveries.sql).toMatch(/enabled = TRUE/);
      expect(deliveries.sql).toMatch(/workspace_id IS NULL OR workspace_id = \?/);
      expect(deliveries.sql).toMatch(/event_types IS NULL OR JSON_CONTAINS\(event_types, JSON_QUOTE\(\?\)\)/);
      expect(deliveries.params).toEqual([1042, 1, 2, 3, 'log.rename']);
    });

    it('issues no query when only another workspace\'s subscription is cached', async () => {
      await cache([sub(3, { workspace_id: 4 })]);
      expect(await emitEvent(ctx(), { workspaceId: 3 })).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('narrows by event type', async () => {
      await cache([sub(1, { event_types: ['log.delete'] }), sub(2, { event_types: ['log.rename', 'log.move'] })]);
      c2_query.mockResolvedValueOnce([{ archive_id: 29, title: 'T', parent_id: null }]);
      queueEmitWrites();
      expect((await emitEvent(ctx(), { workspaceId: 3 })).subscriptionIds).toEqual([2]);
    });

    it('writes the envelope with every spec field and nothing else, in one transaction', async () => {
      await cache([sub(1)]);
      c2_query.mockResolvedValueOnce([{ archive_id: 29, title: 'Stored title', parent_id: null }]);
      queueEmitWrites(1042);
      const before = Date.now();
      await emitEvent(ctx({ user: { id: 42, name: 'kyle', email: 'kyle@example.com', is_admin: true } }), { workspaceId: 3, squadId: 8 });

      const envelope = emittedEnvelope();
      expect(Object.keys(envelope)).toEqual(ENVELOPE_KEYS);
      expect(envelope).toMatchObject({
        schema: 'codex.event.v1',
        sequence: 1042,
        type: 'log.rename',
        workspace_id: 3,
        actor: { id: 42, name: 'kyle' },
        data: { log_id: 113, archive_id: 29, title: 'Release checklist' },
      });
      // The actor is id and name only: no email, no admin flag.
      expect(Object.keys(envelope.actor)).toEqual(['id', 'name']);
      expect(Object.keys(envelope.data)).toEqual(['log_id', 'archive_id', 'title']);
      expect(envelope.id).toMatch(UUID_V4);
      expect(envelope.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Date.parse(envelope.occurred_at)).toBeGreaterThanOrEqual(before - 1);

      const [lookup, insert, update, deliveries] = calls();
      expect(lookup.sql).toMatch(/SELECT archive_id, title, parent_id FROM logs WHERE id = \?/);
      expect(lookup.params).toEqual([113]);
      expect(insert.sql).toMatch(/INSERT INTO webhook_events \(event_uuid, type, workspace_id, occurred_at, body\)/);
      // The row carries the same uuid and instant as the body, the instant in UTC.
      expect(insert.params[0]).toBe(envelope.id);
      expect(insert.params.slice(1, 3)).toEqual(['log.rename', 3]);
      expect(insert.params[3]).toBe(envelope.occurred_at.slice(0, 23).replace('T', ' '));
      expect(update.params[1]).toBe(1042);
      expect(deliveries.params[0]).toBe(1042);
      expect(withTransaction).toHaveBeenCalledTimes(1);
    });

    it('builds each type\'s data from the spec\'s table', async () => {
      await cache([sub(1)]);
      const row = { archive_id: 29, title: 'Stored title', parent_id: 7 };
      const cases = [
        [ctx({ action: 'log.update', metadata: { title: 'Saved' } }), { log_id: 113, archive_id: 29, title: 'Saved' }, true],
        [ctx({ action: 'log.publish', metadata: { version: 4, title: null } }), { log_id: 113, archive_id: 29, title: 'Stored title', version: 4 }, true],
        // A publish's metadata.title is the version's name, never the document's.
        [ctx({ action: 'log.publish', metadata: { version: 4, title: 'v1.0 release' } }), { log_id: 113, archive_id: 29, title: 'Stored title', version: 4 }, true],
        [ctx({ action: 'log.restore', metadata: { title: 'Restored', version: 5 } }), { log_id: 113, archive_id: 29, title: 'Restored', version: 5 }, true],
        [ctx({ action: 'log.rename', metadata: { title: 'Renamed' } }), { log_id: 113, archive_id: 29, title: 'Renamed' }, true],
        [ctx({ action: 'log.move', metadata: { title: 'x', parent_id: 7, previous_parent_id: null } }), { log_id: 113, archive_id: 29, parent_id: 7, previous_parent_id: null }, true],
        [ctx({ action: 'log.delete', resourceType: 'archive', resourceId: 29, metadata: { log_id: 113 } }), { log_id: 113, archive_id: 29 }, false],
        [ctx({ action: 'archive.rename', resourceType: 'archive', resourceId: 29, metadata: { name: 'Runbooks' } }), { archive_id: 29, name: 'Runbooks' }, false],
        [ctx({ action: 'archive.delete', resourceType: 'archive', resourceId: 29, metadata: undefined }), { archive_id: 29 }, false],
      ];
      for (const [event, data, readsLog] of cases) {
        c2_query.mockClear();
        if (readsLog) c2_query.mockResolvedValueOnce([row]);
        queueEmitWrites();
        await emitEvent(event, { workspaceId: 3 });
        expect(emittedEnvelope().data, event.action).toEqual(data);
        expect(calls().some((c) => /FROM logs/.test(c.sql)), event.action).toBe(readsLog);
      }
    });

    it('falls back to the stored parent for a move whose metadata does not carry one', async () => {
      await cache([sub(1)]);
      c2_query.mockResolvedValueOnce([{ archive_id: 29, title: 'T', parent_id: 7 }]);
      queueEmitWrites();
      await emitEvent(ctx({ action: 'log.move', metadata: undefined }), { workspaceId: 3 });
      expect(emittedEnvelope().data).toEqual({ log_id: 113, archive_id: 29, parent_id: 7, previous_parent_id: null });
    });

    it('emits a 70,000-character title as its first 255 code points', async () => {
      await cache([sub(1)]);
      c2_query.mockResolvedValueOnce([{ archive_id: 29, title: 'T', parent_id: null }]);
      queueEmitWrites();
      await emitEvent(ctx({ metadata: { title: '\u{1F680}'.repeat(70_000) } }), { workspaceId: 3 });
      const { data } = emittedEnvelope();
      expect(Array.from(data.title)).toHaveLength(255);
      expect(data.title).toBe('\u{1F680}'.repeat(255));
    });

    it('bounds an archive name and the actor name the same way', async () => {
      await cache([sub(1)]);
      queueEmitWrites();
      await emitEvent(
        ctx({ user: { id: 42, name: 'n'.repeat(500) }, action: 'archive.rename', resourceType: 'archive', resourceId: 29, metadata: { name: 'a'.repeat(300) } }),
        { workspaceId: 3 }
      );
      const envelope = emittedEnvelope();
      expect(envelope.data.name).toBe('a'.repeat(255));
      expect(envelope.actor.name).toBe('n'.repeat(32));
    });

    it('carries only integers or null in the id fields, whatever the metadata holds', async () => {
      await cache([sub(1)]);
      c2_query.mockResolvedValueOnce([{ archive_id: 29, title: 'T', parent_id: null }]);
      queueEmitWrites();
      await emitEvent(
        ctx({ action: 'log.publish', metadata: { title: 'T', version: 'x'.repeat(10_000) } }),
        { workspaceId: 3 }
      );
      expect(emittedEnvelope().data.version).toBeNull();
    });

    it('writes nothing when the document is already gone', async () => {
      await cache([sub(1)]);
      c2_query.mockResolvedValueOnce([]);
      expect(await emitEvent(ctx(), { workspaceId: 3 })).toBeNull();
      expect(c2_query).toHaveBeenCalledTimes(1);
      expect(withTransaction).not.toHaveBeenCalled();
    });

    it('never throws: a failed write is logged and resolves null', async () => {
      await cache([sub(1)]);
      c2_query.mockResolvedValueOnce([{ archive_id: 29, title: 'T', parent_id: null }]);
      withTransaction.mockRejectedValueOnce(new Error('outbox insert failed'));
      await expect(emitEvent(ctx(), { workspaceId: 3 })).resolves.toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/webhook emit failed/), expect.any(Error));
    });

    it('ignores a context with no workspace', async () => {
      await cache([sub(1)]);
      expect(await emitEvent(ctx(), { workspaceId: null })).toBeNull();
      expect(await emitEvent(ctx(), undefined)).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });
  });

  describe('webhookTargetOptions', () => {
    it('allows private targets only for exactly 1, and knows production', () => {
      delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
      delete process.env.NODE_ENV;
      expect(webhookTargetOptions()).toEqual({ allowPrivate: false, production: false });
      process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = 'true';
      expect(webhookTargetOptions().allowPrivate).toBe(false);
      process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = '1';
      process.env.NODE_ENV = 'production';
      expect(webhookTargetOptions()).toEqual({ allowPrivate: true, production: true });
    });
  });

  describe('reconcileEnvSubscription', () => {
    const SECRET = 's'.repeat(40);
    const publicResolver = vi.fn(async () => [{ address: '93.184.215.14', family: 4 }]);

    function configure({ url, secret, workspace } = {}) {
      for (const [name, value] of [['WEBHOOK_URL', url], ['WEBHOOK_SECRET', secret], ['WEBHOOK_WORKSPACE_ID', workspace]]) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }

    /** No param any reconcile query binds may be the secret. */
    const expectSecretNeverBound = () => {
      for (const { params } of calls()) expect(params ?? []).not.toContain(SECRET);
    };

    it('does nothing, and says nothing, on an install with no webhook configured', async () => {
      configure();
      c2_query.mockResolvedValueOnce([]);
      expect(await reconcileEnvSubscription({ resolve: publicResolver })).toBe('none');
      expect(calls()).toHaveLength(1);
      expect(calls()[0].sql).toMatch(/WHERE source = 'env'[\s\S]*FOR UPDATE/);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('creates the env row with no stored secret', async () => {
      configure({ url: 'https://command.example/codex/events/abc', secret: SECRET, workspace: '3' });
      c2_query.mockResolvedValueOnce([]).mockResolvedValueOnce({ insertId: 9 });
      expect(await reconcileEnvSubscription({ resolve: publicResolver })).toBe('created');
      const insert = calls()[1];
      expect(insert.sql).toMatch(/INSERT INTO webhook_subscriptions \(url, secret, source, enabled, workspace_id\)\s+VALUES \(\?, NULL, 'env', TRUE, \?\)/);
      expect(insert.params).toEqual(['https://command.example/codex/events/abc', 3]);
      expectSecretNeverBound();
      expect(withTransaction).toHaveBeenCalledTimes(1);
    });

    it('re-enables an unchanged env row and keeps its queue', async () => {
      configure({ url: 'https://command.example/hook', secret: SECRET });
      c2_query
        .mockResolvedValueOnce([{ id: 9, url: 'https://command.example/hook', workspace_id: null }])
        .mockResolvedValueOnce({ affectedRows: 1 });
      expect(await reconcileEnvSubscription({ resolve: publicResolver })).toBe('updated');
      expect(calls()).toHaveLength(2);
      expect(calls()[1].sql).toMatch(/UPDATE webhook_subscriptions\s+SET url = \?, workspace_id = \?, enabled = TRUE, disabled_reason = NULL\s+WHERE id = \?/);
      expect(calls()[1].params).toEqual(['https://command.example/hook', null, 9]);
      expectSecretNeverBound();
    });

    it.each([
      ['a new URL', { url: 'https://other.example/hook', secret: SECRET }],
      ['a new workspace', { url: 'https://command.example/hook', secret: SECRET, workspace: '4' }],
    ])('drops what was queued for the old receiver on %s', async (_name, env) => {
      configure(env);
      c2_query
        .mockResolvedValueOnce([{ id: 9, url: 'https://command.example/hook', workspace_id: null }])
        .mockResolvedValueOnce({ affectedRows: 5 })
        .mockResolvedValueOnce({ affectedRows: 1 });
      expect(await reconcileEnvSubscription({ resolve: publicResolver })).toBe('retargeted');
      expect(calls()[1].sql).toMatch(/DELETE FROM webhook_deliveries WHERE subscription_id = \? AND status = 'pending'/);
      expect(calls()[1].params).toEqual([9]);
      expect(calls()[2].sql).toMatch(/consecutive_failures = 0, paused_until = NULL/);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/5 undelivered/));
    });

    it.each([
      ['WEBHOOK_URL unset', { secret: SECRET }, ENV_UNSET_REASON],
      ['WEBHOOK_SECRET unset', { url: 'https://command.example/hook' }, ENV_UNSET_REASON],
      ['both unset', {}, ENV_UNSET_REASON],
      ['a short secret', { url: 'https://command.example/hook', secret: 'short' }, 'WEBHOOK_SECRET is shorter than 32 characters'],
      ['a bad workspace', { url: 'https://command.example/hook', secret: SECRET, workspace: 'three' }, 'WEBHOOK_WORKSPACE_ID is not a positive whole number'],
      ['a negative workspace', { url: 'https://command.example/hook', secret: SECRET, workspace: '-3' }, 'WEBHOOK_WORKSPACE_ID is not a positive whole number'],
    ])('disables an existing env row with %s', async (_name, env, reason) => {
      configure(env);
      c2_query
        .mockResolvedValueOnce([{ id: 9, url: 'https://command.example/hook', workspace_id: null }])
        .mockResolvedValueOnce({ affectedRows: 1 });
      expect(await reconcileEnvSubscription({ resolve: publicResolver })).toBe('disabled');
      expect(calls()[1].sql).toMatch(/UPDATE webhook_subscriptions SET enabled = FALSE, disabled_reason = \? WHERE id = \?/);
      expect(calls()[1].params).toEqual([reason, 9]);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(reason));
      expectSecretNeverBound();
    });

    it('says why a half-configured webhook is off even when there is no row yet', async () => {
      configure({ url: 'https://command.example/hook' });
      c2_query.mockResolvedValueOnce([]);
      expect(await reconcileEnvSubscription({ resolve: publicResolver })).toBe('none');
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(ENV_UNSET_REASON));
    });

    it('disables the row, with the guard\'s sentence, for a URL the guard refuses', async () => {
      configure({ url: 'https://command.example/hook', secret: SECRET });
      c2_query
        .mockResolvedValueOnce([{ id: 9, url: 'https://command.example/hook', workspace_id: null }])
        .mockResolvedValueOnce({ affectedRows: 1 });
      const resolve = vi.fn(async () => [{ address: '169.254.169.254', family: 4 }]);
      expect(await reconcileEnvSubscription({ resolve })).toBe('disabled');
      expect(calls()[1].params[0]).toMatch(/^The webhook URL resolves to 169\.254\.169\.254/);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('keeps the row enabled when the name only fails to resolve, since the send re-checks it', async () => {
      configure({ url: 'https://command.example/hook', secret: SECRET });
      c2_query.mockResolvedValueOnce([]).mockResolvedValueOnce({ insertId: 9 });
      const resolve = vi.fn(async () => { throw Object.assign(new Error('EAI_AGAIN'), { code: 'EAI_AGAIN' }); });
      expect(await reconcileEnvSubscription({ resolve })).toBe('created');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/could not be resolved/));
    });

    it('never logs the secret', async () => {
      configure({ url: 'https://command.example/hook', secret: 'tooshort-but-secret' });
      c2_query.mockResolvedValueOnce([{ id: 9, url: 'https://command.example/hook', workspace_id: null }]).mockResolvedValueOnce({});
      await reconcileEnvSubscription({ resolve: publicResolver });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('tooshort-but-secret');
    });
  });
});

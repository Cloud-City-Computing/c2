/**
 * Tests for where logActivity emits an outbound event, and that neither side can fail the other
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { emitEvent } from '../../services/webhooks.js';
import { createNotification } from '../../services/notifications.js';
import { logActivity } from '../../routes/helpers/activity.js';
import { resetMocks, TEST_USER } from '../helpers.js';

vi.mock('../../services/webhooks.js', () => ({ emitEvent: vi.fn(async () => null) }));
vi.mock('../../services/notifications.js', () => ({ createNotification: vi.fn(async () => null) }));

const flush = () => new Promise((r) => setImmediate(r));

/** Every c2_query SQL issued, in order. */
const sqls = () => c2_query.mock.calls.map(([sql]) => sql);

describe('logActivity and the emit hook', () => {
  let errorSpy;

  beforeEach(() => {
    resetMocks();
    emitEvent.mockResolvedValue(null);
    createNotification.mockResolvedValue(null);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('emits after the activity row and before auto-watch, with the resolved scope', async () => {
    const order = [];
    c2_query.mockImplementation(async (sql) => {
      order.push(/INSERT INTO activity_log/.test(sql) ? 'activity' : /INSERT IGNORE INTO watches/.test(sql) ? 'watch' : 'other');
      if (/SELECT id FROM activity_log/.test(sql)) return [];
      if (/FROM logs l/.test(sql)) return [{ workspace_id: 5, squad_id: 8 }];
      return [];
    });
    emitEvent.mockImplementation(async () => { order.push('emit'); return null; });

    const ctx = { user: TEST_USER, action: 'log.update', resourceType: 'log', resourceId: 42, metadata: { title: 'T' } };
    logActivity(ctx);
    await flush();

    expect(emitEvent).toHaveBeenCalledWith(ctx, { workspaceId: 5, squadId: 8 });
    expect(order.filter((step) => step !== 'other')).toEqual(['activity', 'emit', 'watch']);
    c2_query.mockReset();
  });

  it('passes a null squad when the caller gave a workspace but no squad', async () => {
    c2_query.mockResolvedValueOnce({ insertId: 1 });
    logActivity({ user: TEST_USER, action: 'archive.rename', resourceType: 'archive', resourceId: 9, workspaceId: 7 });
    await flush();
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'archive.rename' }), { workspaceId: 7, squadId: null });
  });

  it('never emits a coalesced log.update', async () => {
    c2_query.mockResolvedValueOnce([{ id: 99 }]); // a recent log.update row exists
    logActivity({ user: TEST_USER, action: 'log.update', resourceType: 'log', resourceId: 42, workspaceId: 7 });
    await flush();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('never emits an event whose activity row was not written', async () => {
    c2_query.mockResolvedValueOnce([]); // the scope lookup finds nothing
    logActivity({ user: TEST_USER, action: 'log.rename', resourceType: 'log', resourceId: 42 });
    await flush();
    expect(emitEvent).not.toHaveBeenCalled();

    c2_query.mockRejectedValueOnce(new Error('insert failed'));
    logActivity({ user: TEST_USER, action: 'log.rename', resourceType: 'log', resourceId: 42, workspaceId: 7 });
    await flush();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('still auto-watches and notifies watchers when the emit throws', async () => {
    emitEvent.mockRejectedValueOnce(new Error('emit blew up'));
    c2_query
      .mockResolvedValueOnce([])                               // coalesce check
      .mockResolvedValueOnce({ insertId: 1 })                  // activity_log insert
      .mockResolvedValueOnce({ affectedRows: 1 })              // auto-watch insert
      .mockResolvedValueOnce([{ id: 42, title: 'Doc' }])       // fan-out: the log
      .mockResolvedValueOnce([{ user_id: 2 }])                 // direct watchers
      .mockResolvedValueOnce([{ archive_id: null }]);          // the log's archive

    logActivity({ user: TEST_USER, action: 'log.update', resourceType: 'log', resourceId: 42, workspaceId: 7 });
    await flush();
    await flush();

    expect(sqls().some((sql) => /INSERT IGNORE INTO watches/.test(sql))).toBe(true);
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 2, type: 'watched_log_update' }));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/webhook emit failed/), expect.any(Error));
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { logActivity } from '../../routes/helpers/activity.js';
import { resetMocks, TEST_USER } from '../helpers.js';

const flush = () => new Promise((r) => setImmediate(r));

describe('routes/helpers/activity', () => {
  beforeEach(() => resetMocks());

  it('inserts a log.create row when workspaceId is provided', async () => {
    c2_query.mockResolvedValueOnce({ insertId: 1 }); // INSERT into activity_log

    logActivity({
      user: TEST_USER,
      action: 'log.create',
      resourceType: 'log',
      resourceId: 42,
      workspaceId: 7,
      squadId: 3,
      metadata: { title: 'Hello' },
    });
    await flush();

    expect(c2_query).toHaveBeenCalled();
    const insertCall = c2_query.mock.calls.find((c) => /INSERT INTO activity_log/i.test(c[0]));
    expect(insertCall).toBeTruthy();
    expect(insertCall[1][0]).toBe(7);   // workspace_id
    expect(insertCall[1][1]).toBe(3);   // squad_id
    expect(insertCall[1][3]).toBe('log.create');
  });

  it('coalesces log.update events from the same user within 5 minutes', async () => {
    c2_query.mockResolvedValueOnce([{ id: 99 }]); // recent row exists

    logActivity({
      user: TEST_USER,
      action: 'log.update',
      resourceType: 'log',
      resourceId: 42,
      workspaceId: 7,
    });
    await flush();

    // Only the coalesce SELECT should have been made; no INSERT.
    expect(c2_query).toHaveBeenCalledTimes(1);
    expect(c2_query.mock.calls[0][0]).toMatch(/log\.update/);
  });

  it('does NOT coalesce other actions', async () => {
    // For log.publish: INSERT into activity_log; then fan-out fetches
    // the log row (returns []), so no further work happens.
    c2_query.mockResolvedValueOnce({ insertId: 1 });

    logActivity({
      user: TEST_USER,
      action: 'log.publish',
      resourceType: 'log',
      resourceId: 42,
      workspaceId: 7,
    });
    await flush();

    const insertCall = c2_query.mock.calls.find((c) => /INSERT INTO activity_log/i.test(c[0]));
    expect(insertCall).toBeTruthy();
  });

  it('resolves workspace and squad from the log when not provided', async () => {
    c2_query
      .mockResolvedValueOnce([{ workspace_id: 5, squad_id: 8 }]) // resolveScope SELECT
      .mockResolvedValueOnce({ insertId: 1 });                    // INSERT

    logActivity({
      user: TEST_USER,
      action: 'log.publish',
      resourceType: 'log',
      resourceId: 42,
    });
    await flush();

    const insertCall = c2_query.mock.calls.find((c) => /INSERT INTO activity_log/i.test(c[0]));
    expect(insertCall).toBeTruthy();
    expect(insertCall[1][0]).toBe(5);
    expect(insertCall[1][1]).toBe(8);
  });

  it('swallows errors silently (does not throw to caller)', async () => {
    c2_query.mockRejectedValueOnce(new Error('boom'));

    expect(() =>
      logActivity({
        user: TEST_USER,
        action: 'log.create',
        resourceType: 'log',
        resourceId: 1,
        workspaceId: 1,
      })
    ).not.toThrow();
    await flush();
  });

  it('skips when required fields are missing', async () => {
    logActivity({});
    logActivity({ user: TEST_USER, action: 'x' });
    await flush();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('fans out a notification to a watcher (excluding the actor)', async () => {
    // log.publish flow: INSERT activity, then fanOutToWatchers:
    //   - applyAutoWatch: rule doesn't match publish, returns early.
    //   - SELECT log info  → { id, title }
    //   - SELECT direct watchers
    //   - SELECT log archive_id (cascade)
    //   - SELECT archive watchers (empty)
    //   - createNotification(): coalesce SELECT, INSERT row, recipient SELECT
    c2_query
      .mockResolvedValueOnce({ insertId: 1 })                              // 1: INSERT activity
      .mockResolvedValueOnce([{ id: 42, title: 'Doc' }])                  // 2: SELECT log info (collectWatchers→fanOut)
      .mockResolvedValueOnce([{ user_id: 99 }])                           // 3: direct log watchers
      .mockResolvedValueOnce([{ archive_id: 5 }])                         // 4: log.archive_id lookup
      .mockResolvedValueOnce([])                                          // 5: archive watchers (none)
      .mockResolvedValueOnce([])                                          // 6: createNotification coalesce
      .mockResolvedValueOnce({ insertId: 200 })                           // 7: INSERT notifications
      .mockResolvedValueOnce([{ id: 99, name: 'Bob', email: 'b@x.com', notification_prefs: null }]); // 8: email recipient

    logActivity({
      user: { id: 1, name: 'Alice' },
      action: 'log.publish',
      resourceType: 'log',
      resourceId: 42,
      workspaceId: 7,
      metadata: { title: 'Doc', version: 5 },
    });
    await flush();
    await flush();

    const notifInsert = c2_query.mock.calls.find((c) => /INSERT INTO notifications/i.test(c[0]));
    expect(notifInsert).toBeTruthy();
    expect(notifInsert[1]).toContain(99); // recipient = watcher
    expect(notifInsert[1]).toContain('watched_publish');
  });

  it('does NOT fan out a notification to the actor themselves', async () => {
    c2_query
      .mockResolvedValueOnce({ insertId: 1 })                              // INSERT activity
      .mockResolvedValueOnce([{ id: 42, title: 'Doc' }])                  // log info
      .mockResolvedValueOnce([{ user_id: 1 }])                            // watcher = actor
      .mockResolvedValueOnce([{ archive_id: 5 }])                         // archive id
      .mockResolvedValueOnce([]);                                          // archive watchers

    logActivity({
      user: { id: 1, name: 'Alice' },
      action: 'log.publish',
      resourceType: 'log',
      resourceId: 42,
      workspaceId: 7,
    });
    await flush();
    await flush();

    const notifInsert = c2_query.mock.calls.find((c) => /INSERT INTO notifications/i.test(c[0]));
    expect(notifInsert).toBeFalsy();
  });

  it('auto-watches the actor on log.create', async () => {
    c2_query
      .mockResolvedValueOnce({ insertId: 1 })  // INSERT activity
      .mockResolvedValueOnce({ affectedRows: 1 }); // INSERT IGNORE into watches

    logActivity({
      user: TEST_USER,
      action: 'log.create',
      resourceType: 'log',
      resourceId: 42,
      workspaceId: 7,
    });
    await flush();

    const watchCall = c2_query.mock.calls.find((c) => /INSERT IGNORE INTO watches/i.test(c[0]));
    expect(watchCall).toBeTruthy();
    expect(watchCall[1]).toContain(TEST_USER.id);
    expect(watchCall[1]).toContain(42);
    expect(watchCall[1]).toContain('auto_create');
  });
});

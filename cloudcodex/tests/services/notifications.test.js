import { describe, it, expect, beforeEach, vi } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { sendEmail } from '../../services/email.js';
import { resetMocks } from '../helpers.js';

vi.mock('../../services/user-channel.js', () => ({
  broadcastToUser: vi.fn(),
  isUserConnected: vi.fn(() => false),
  getConnectedUserCount: vi.fn(() => 0),
  setupUserChannelServer: vi.fn(),
}));

import { broadcastToUser } from '../../services/user-channel.js';
import {
  createNotification,
  markRead,
  markAllRead,
  getUnreadCount,
  listForUser,
  getPrefs,
  setPrefs,
  DEFAULT_EMAIL_PREFS,
} from '../../services/notifications.js';

describe('services/notifications', () => {
  beforeEach(() => {
    resetMocks();
    broadcastToUser.mockReset();
  });

  describe('createNotification', () => {
    it('returns null when actor === recipient (self-suppress)', async () => {
      const result = await createNotification({
        recipientId: 1,
        actorId: 1,
        type: 'mention',
        title: 'Test',
      });
      expect(result).toBeNull();
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('returns null and skips insert when no recipientId/type/title', async () => {
      expect(await createNotification({ recipientId: 0, type: 'mention', title: 'X' })).toBeNull();
      expect(await createNotification({ recipientId: 1, type: '', title: 'X' })).toBeNull();
      expect(await createNotification({ recipientId: 1, type: 'mention', title: '' })).toBeNull();
    });

    it('coalesces within the 60s window: returns null when a recent row exists', async () => {
      c2_query.mockResolvedValueOnce([{ id: 99 }]); // existing row found

      const result = await createNotification({
        recipientId: 1,
        actorId: 2,
        type: 'mention',
        title: 'Hello',
        resourceType: 'log',
        resourceId: 10,
      });

      expect(result).toBeNull();
      // only the coalesce SELECT was made; no INSERT
      expect(c2_query).toHaveBeenCalledTimes(1);
    });

    it('inserts and pushes WS when no recent duplicate', async () => {
      c2_query
        .mockResolvedValueOnce([])                            // coalesce SELECT
        .mockResolvedValueOnce({ insertId: 42 })              // INSERT
        .mockResolvedValueOnce([{ id: 1, name: 'Bob', email: 'bob@example.com', notification_prefs: null }]); // recipient lookup for email

      const result = await createNotification({
        recipientId: 1,
        actorId: 2,
        type: 'mention',
        title: 'Alice mentioned you',
        body: 'snippet',
        linkUrl: '/editor/10',
        resourceType: 'log',
        resourceId: 10,
        emailData: { actorName: 'Alice', docTitle: 'Doc', snippet: 'snip', linkUrl: '/editor/10' },
      });

      expect(result).not.toBeNull();
      expect(result.id).toBe(42);
      expect(result.type).toBe('mention');
      expect(broadcastToUser).toHaveBeenCalledWith(1, expect.objectContaining({
        type: 'notification',
      }));
    });

    it('skips email when prefs disable that type', async () => {
      c2_query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ insertId: 1 })
        .mockResolvedValueOnce([{
          id: 1, name: 'Bob', email: 'bob@example.com',
          notification_prefs: JSON.stringify({ email_mention: false }),
        }]);

      await createNotification({
        recipientId: 1,
        actorId: 2,
        type: 'mention',
        title: 't',
        resourceType: 'log',
        resourceId: 10,
        emailData: { actorName: 'A', docTitle: 'D', snippet: 's', linkUrl: '/x' },
      });

      // Yield to the fire-and-forget email task so the assertion runs after it completes.
      await new Promise((r) => setImmediate(r));
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('sends email when prefs allow', async () => {
      c2_query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ insertId: 1 })
        .mockResolvedValueOnce([{
          id: 1, name: 'Bob', email: 'bob@example.com', notification_prefs: null,
        }]);

      await createNotification({
        recipientId: 1,
        actorId: 2,
        type: 'mention',
        title: 't',
        resourceType: 'log',
        resourceId: 10,
        emailData: { actorName: 'Alice', docTitle: 'Doc', snippet: 'snip', linkUrl: '/editor/10' },
      });

      await new Promise((r) => setImmediate(r));
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const call = sendEmail.mock.calls[0][0];
      expect(call.to).toBe('bob@example.com');
      expect(call.subject).toContain('Alice');
    });
  });

  describe('markRead / markAllRead', () => {
    it('markRead scopes update to user_id', async () => {
      c2_query.mockResolvedValueOnce({ affectedRows: 1 });
      await markRead(7, 1);
      const sql = c2_query.mock.calls[0][0];
      const params = c2_query.mock.calls[0][1];
      expect(sql).toMatch(/user_id\s*=\s*\?/i);
      expect(params).toContain(7);
      expect(params).toContain(1);
    });

    it('markAllRead scopes update to current user only', async () => {
      c2_query.mockResolvedValueOnce({ affectedRows: 5 });
      await markAllRead(1);
      const sql = c2_query.mock.calls[0][0];
      expect(sql).toMatch(/user_id\s*=\s*\?/i);
    });
  });

  describe('getUnreadCount', () => {
    it('returns the COUNT(*) result', async () => {
      c2_query.mockResolvedValueOnce([{ unread: 3 }]);
      const count = await getUnreadCount(1);
      expect(count).toBe(3);
    });

    it('returns 0 when no rows', async () => {
      c2_query.mockResolvedValueOnce([]);
      const count = await getUnreadCount(1);
      expect(count).toBe(0);
    });
  });

  describe('listForUser', () => {
    it('returns rows with actor join', async () => {
      const rows = [{ id: 1, type: 'mention', title: 'x', actor_name: 'Alice' }];
      c2_query.mockResolvedValueOnce(rows);
      const result = await listForUser(1, { limit: 10 });
      expect(result).toEqual(rows);
    });

    it('applies unreadOnly filter', async () => {
      c2_query.mockResolvedValueOnce([]);
      await listForUser(1, { unreadOnly: true });
      const sql = c2_query.mock.calls[0][0];
      expect(sql).toMatch(/read_at IS NULL/i);
    });
  });

  describe('getPrefs / setPrefs', () => {
    it('getPrefs merges defaults with stored JSON', async () => {
      c2_query.mockResolvedValueOnce([{
        notification_prefs: JSON.stringify({ email_mention: false }),
      }]);
      const prefs = await getPrefs(1);
      expect(prefs.email_mention).toBe(false);
      expect(prefs.email_comment_on_my_doc).toBe(DEFAULT_EMAIL_PREFS.email_comment_on_my_doc);
    });

    it('setPrefs whitelists keys and coerces booleans', async () => {
      c2_query.mockResolvedValueOnce({ affectedRows: 1 });
      const prefs = await setPrefs(1, {
        email_mention: false,
        unknown_key: 'should-be-ignored',
        email_watched_publish: 'truthy',
      });
      const stored = JSON.parse(c2_query.mock.calls[0][1][0]);
      expect(stored).toEqual({ email_mention: false, email_watched_publish: true });
      expect(prefs.email_mention).toBe(false);
      expect(prefs.email_watched_publish).toBe(true);
    });
  });
});

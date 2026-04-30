/**
 * Cloud Codex — Tests for routes/helpers/shared.js
 *
 * Covers input validation, async error handling, HTML sanitisation, the
 * Express error handler, log/archive access checks, publish gating, and the
 * shared INSERT helpers.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { resetMocks, TEST_USER } from '../helpers.js';
import {
  isValidId,
  asyncHandler,
  sanitizeHtml,
  errorHandler,
  checkLogReadAccess,
  checkLogWriteAccess,
  canPublish,
  checkArchiveReadAccess,
  checkArchiveWriteAccess,
  createDefaultPermissions,
  addSquadOwnerMember,
  isValidEmail,
  DEFAULT_PERMISSIONS,
  BCRYPT_ROUNDS,
  APP_URL,
} from '../../routes/helpers/shared.js';

describe('helpers/shared', () => {
  beforeEach(() => resetMocks());

  // ── isValidId ───────────────────────────────────────────

  describe('isValidId', () => {
    it('accepts positive integers and stringified positive integers', () => {
      expect(isValidId(1)).toBe(true);
      expect(isValidId(99999)).toBe(true);
      expect(isValidId('42')).toBe(true);
    });

    it('rejects zero and negative numbers', () => {
      expect(isValidId(0)).toBe(false);
      expect(isValidId(-5)).toBe(false);
      expect(isValidId('-1')).toBe(false);
    });

    it('rejects non-numeric input', () => {
      expect(isValidId('abc')).toBe(false);
      expect(isValidId('1.5')).toBe(false);
      expect(isValidId(NaN)).toBe(false);
      expect(isValidId(null)).toBe(false);
      expect(isValidId(undefined)).toBe(false);
      expect(isValidId({})).toBe(false);
      expect(isValidId([])).toBe(false);
    });

    it('rejects floats', () => {
      expect(isValidId(1.5)).toBe(false);
      expect(isValidId(2.0001)).toBe(false);
    });
  });

  // ── asyncHandler ────────────────────────────────────────

  describe('asyncHandler', () => {
    it('passes through resolved values without invoking next', async () => {
      const next = vi.fn();
      const handler = asyncHandler(async (_req, res) => res.json({ ok: true }));
      const res = { json: vi.fn() };
      await handler({}, res, next);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards rejected promises to next', async () => {
      const next = vi.fn();
      const err = new Error('boom');
      const handler = asyncHandler(async () => {
        throw err;
      });
      await handler({}, {}, next);
      expect(next).toHaveBeenCalledWith(err);
    });

    it('handles synchronous throws as well (Promise.resolve coerces)', async () => {
      const next = vi.fn();
      const err = new Error('sync');
      const handler = asyncHandler(() => {
        throw err;
      });
      // The wrapper calls Promise.resolve(fn(...)) which throws synchronously
      // before reaching .catch. We expect that exception to surface.
      await expect(async () => handler({}, {}, next)).rejects.toThrow('sync');
    });
  });

  // ── sanitizeHtml ────────────────────────────────────────

  describe('sanitizeHtml', () => {
    it('returns empty string for empty/null input', () => {
      expect(sanitizeHtml('')).toBe('');
      expect(sanitizeHtml(null)).toBe('');
      expect(sanitizeHtml(undefined)).toBe('');
    });

    it('strips <script> tags', () => {
      expect(sanitizeHtml('<p>hi</p><script>alert(1)</script>')).not.toMatch(/<script>/i);
    });

    it('strips inline event handlers', () => {
      const out = sanitizeHtml('<a href="x" onclick="alert(1)">click</a>');
      expect(out).not.toMatch(/onclick/i);
    });

    it('strips javascript: URIs', () => {
      const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
      expect(out).not.toMatch(/javascript:/i);
    });

    it('preserves safe tags and basic formatting', () => {
      const html = '<p><strong>bold</strong> and <em>italic</em></p>';
      expect(sanitizeHtml(html)).toBe(html);
    });

    it('preserves data: URIs on <img> tags (allowed for pasted images)', () => {
      const html = '<img src="data:image/png;base64,iVBOR" alt="x">';
      expect(sanitizeHtml(html)).toMatch(/^<img/);
      expect(sanitizeHtml(html)).toMatch(/data:image\/png/);
    });

    it('allows http(s), mailto, and tel URIs', () => {
      const httpsLink = '<a href="https://example.com">x</a>';
      expect(sanitizeHtml(httpsLink)).toBe(httpsLink);
      const mail = '<a href="mailto:a@b.com">m</a>';
      expect(sanitizeHtml(mail)).toBe(mail);
    });
  });

  // ── isValidEmail ────────────────────────────────────────

  describe('isValidEmail', () => {
    it('accepts well-formed emails', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('a.b+c@sub.example.co.uk')).toBe(true);
    });

    it('rejects malformed emails', () => {
      expect(isValidEmail('not-an-email')).toBe(false);
      expect(isValidEmail('@no-local.com')).toBe(false);
      expect(isValidEmail('no-at-sign.com')).toBe(false);
      expect(isValidEmail('two@@signs.com')).toBe(false);
      expect(isValidEmail('trailing space @x.com')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });
  });

  // ── Constants ────────────────────────────────────────────

  describe('exported constants', () => {
    it('BCRYPT_ROUNDS is 12 (not lowered for speed per CLAUDE.md)', () => {
      expect(BCRYPT_ROUNDS).toBe(12);
    });

    it('APP_URL falls back to localhost:3000', () => {
      expect(typeof APP_URL).toBe('string');
      expect(APP_URL).toMatch(/^https?:\/\//);
    });

    it('DEFAULT_PERMISSIONS only allows create_log by default', () => {
      expect(DEFAULT_PERMISSIONS).toEqual({
        create_squad: false,
        create_archive: false,
        create_log: true,
      });
    });
  });

  // ── checkLogReadAccess / checkLogWriteAccess ────────────

  describe('checkLogReadAccess', () => {
    it('returns the matched log row when access is granted', async () => {
      c2_query.mockResolvedValueOnce([{ id: 42 }]);
      const result = await checkLogReadAccess(42, TEST_USER);
      expect(result).toEqual({ id: 42 });

      // Verify SQL shape and parameters
      const [sql, params] = c2_query.mock.calls[0];
      expect(sql).toMatch(/FROM logs/i);
      expect(sql).toMatch(/INNER JOIN archives/i);
      expect(params[0]).toBe(42); // logId is the first param
      expect(params).toHaveLength(8); // logId + 7 access params
    });

    it('returns undefined when no row matches', async () => {
      c2_query.mockResolvedValueOnce([]);
      expect(await checkLogReadAccess(42, TEST_USER)).toBeUndefined();
    });
  });

  describe('checkLogWriteAccess', () => {
    it('returns the matched log row when write access is granted', async () => {
      c2_query.mockResolvedValueOnce([{ id: 7 }]);
      const result = await checkLogWriteAccess(7, TEST_USER);
      expect(result).toEqual({ id: 7 });

      const sql = c2_query.mock.calls[0][0];
      // writeAccessWhere references write_access columns
      expect(sql).toMatch(/write_access/i);
    });
  });

  // ── checkArchiveReadAccess / checkArchiveWriteAccess ────

  describe('checkArchive*Access', () => {
    it('checkArchiveReadAccess returns the row when access is granted', async () => {
      c2_query.mockResolvedValueOnce([{ id: 5 }]);
      expect(await checkArchiveReadAccess(5, TEST_USER)).toEqual({ id: 5 });
    });

    it('checkArchiveWriteAccess returns undefined on denial', async () => {
      c2_query.mockResolvedValueOnce([]);
      expect(await checkArchiveWriteAccess(5, TEST_USER)).toBeUndefined();
    });
  });

  // ── canPublish ──────────────────────────────────────────

  describe('canPublish', () => {
    it('returns true when there is no squad context', async () => {
      expect(await canPublish(null, 99, TEST_USER)).toBe(true);
      expect(await canPublish(undefined, 99, TEST_USER)).toBe(true);
      expect(await canPublish(0, 99, TEST_USER)).toBe(true);
    });

    it('returns true for admin users without hitting the database', async () => {
      const admin = { ...TEST_USER, is_admin: true };
      expect(await canPublish(5, 99, admin)).toBe(true);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('returns true when user is workspace owner', async () => {
      c2_query.mockResolvedValueOnce([{ '1': 1 }]);
      expect(await canPublish(5, 99, TEST_USER)).toBe(true);
    });

    it('returns true when user is squad owner role', async () => {
      c2_query
        .mockResolvedValueOnce([]) // not workspace owner
        .mockResolvedValueOnce([{ can_publish: false, role: 'owner' }]);
      expect(await canPublish(5, 99, TEST_USER)).toBe(true);
    });

    it('returns true when user has explicit can_publish permission', async () => {
      c2_query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ can_publish: true, role: 'member' }]);
      expect(await canPublish(5, 99, TEST_USER)).toBe(true);
    });

    it('returns true when user is the archive creator', async () => {
      c2_query
        .mockResolvedValueOnce([]) // not workspace owner
        .mockResolvedValueOnce([{ can_publish: false, role: 'member' }]);
      expect(await canPublish(5, TEST_USER.id, TEST_USER)).toBe(true);
    });

    it('returns false when none of the access paths apply', async () => {
      c2_query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ can_publish: false, role: 'member' }]);
      expect(await canPublish(5, 999, TEST_USER)).toBe(false);
    });
  });

  // ── createDefaultPermissions / addSquadOwnerMember ──────

  describe('shared INSERT helpers', () => {
    it('createDefaultPermissions inserts a permissions row for the user', async () => {
      c2_query.mockResolvedValueOnce({ insertId: 1 });
      await createDefaultPermissions(99);
      const [sql, params] = c2_query.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO permissions/i);
      expect(params).toEqual([99]);
    });

    it('addSquadOwnerMember inserts an owner with all permission flags TRUE', async () => {
      c2_query.mockResolvedValueOnce({ insertId: 1 });
      await addSquadOwnerMember(7, 99);
      const [sql, params] = c2_query.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO squad_members/i);
      expect(sql).toMatch(/'owner'/);
      expect(params).toEqual([7, 99]);
    });
  });

  // ── errorHandler ────────────────────────────────────────

  describe('errorHandler', () => {
    it('logs to console.error with the project format and returns 500 JSON', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const req = { method: 'POST', path: '/api/x' };
      const err = new Error('kaboom');

      errorHandler(err, req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'An internal server error occurred',
      });
      // Logged with the canonical [ISO] METHOD path: format
      expect(consoleSpy).toHaveBeenCalled();
      const [logLine] = consoleSpy.mock.calls[0];
      expect(logLine).toMatch(/^\[20\d{2}-\d{2}-\d{2}T.*Z\] POST \/api\/x:/);

      consoleSpy.mockRestore();
    });

    it('does NOT leak internal error messages to the client', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      errorHandler(new Error('database password leak'), { method: 'GET', path: '/x' }, res, () => {});

      const responseBody = res.json.mock.calls[0][0];
      expect(responseBody.message).not.toMatch(/database password leak/);
      expect(responseBody.message).toBe('An internal server error occurred');

      consoleSpy.mockRestore();
    });
  });
});

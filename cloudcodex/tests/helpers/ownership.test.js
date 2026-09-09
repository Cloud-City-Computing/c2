/**
 * Cloud Codex — Tests for routes/helpers/ownership.js
 *
 * Verifies the SQL fragments and parameter shape produced by the access
 * helpers, and the isArchiveOwner cascade query. The SQL is asserted at
 * the structural level (alias substitution, parameter count, column
 * names) — full integration is exercised by the route tests.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { resetMocks, TEST_USER } from '../helpers.js';
import {
  readAccessWhere,
  readAccessParams,
  writeAccessWhere,
  writeAccessParams,
  isArchiveOwner,
  isWorkspaceMember,
  isSquadWorkspaceMember,
} from '../../routes/helpers/ownership.js';

describe('helpers/ownership', () => {
  beforeEach(() => resetMocks());

  // ── readAccessWhere / writeAccessWhere ──────────────────

  describe('readAccessWhere', () => {
    it('uses the provided alias for archive columns', () => {
      const sql = readAccessWhere('alpha');
      expect(sql).toContain('alpha.read_access');
      expect(sql).toContain('alpha.created_by');
      expect(sql).toContain('alpha.read_access_squads');
      expect(sql).toContain('alpha.read_access_workspace');
      expect(sql).toContain('alpha.squad_id');
    });

    it('defaults the alias to `p` when none provided', () => {
      const sql = readAccessWhere();
      expect(sql).toContain('p.read_access');
      expect(sql).toContain('p.created_by');
    });

    it('emits exactly seven `?` placeholders matching readAccessParams', () => {
      const sql = readAccessWhere('p');
      const placeholderCount = (sql.match(/\?/g) || []).length;
      expect(placeholderCount).toBe(7);
      expect(readAccessParams(TEST_USER)).toHaveLength(7);
    });

    it('cascades through workspace owner, squad owner, squad member, and squad-listed access', () => {
      const sql = readAccessWhere('p');
      // Workspace owner cascade, matched on the users FK rather than an email string
      expect(sql).toMatch(/JOIN workspaces _oo ON _ot\.workspace_id = _oo\.id/i);
      expect(sql).toMatch(/_oo\.owner_id = \?/i);
      // Squad owner / member with read perm
      expect(sql).toMatch(/_om\.role = 'owner' OR _om\.can_read = TRUE/i);
      // Squad-id-listed access
      expect(sql).toMatch(/JSON_CONTAINS\(p\.read_access_squads/i);
      // Workspace-wide flag
      expect(sql).toMatch(/p\.read_access_workspace = TRUE/i);
    });
  });

  describe('writeAccessWhere', () => {
    it('mirrors readAccessWhere but checks write_access columns', () => {
      const sql = writeAccessWhere('p');
      expect(sql).toContain('p.write_access');
      expect(sql).toContain('p.write_access_squads');
      expect(sql).toContain('p.write_access_workspace');
      expect(sql).toMatch(/_om\.role = 'owner' OR _om\.can_write = TRUE/i);
    });

    it('emits exactly seven placeholders matching writeAccessParams', () => {
      const sql = writeAccessWhere('p');
      expect((sql.match(/\?/g) || []).length).toBe(7);
      expect(writeAccessParams(TEST_USER)).toHaveLength(7);
    });
  });

  // ── readAccessParams / writeAccessParams ────────────────

  describe('readAccessParams', () => {
    it('orders params to match the SQL placeholders', () => {
      const params = readAccessParams(TEST_USER);
      // Order from the SQL:
      //  [is_admin, JSON.stringify(id), id, id, id, id, id]
      expect(params[0]).toBe(false); // TEST_USER.is_admin is unset → false
      expect(params[1]).toBe(JSON.stringify(TEST_USER.id));
      expect(params[2]).toBe(TEST_USER.id);
      expect(params[3]).toBe(TEST_USER.id); // workspace owner, by user id
      expect(params[4]).toBe(TEST_USER.id);
      expect(params[5]).toBe(TEST_USER.id);
      expect(params[6]).toBe(TEST_USER.id);
    });

    it('never binds an email into an ownership predicate', () => {
      // workspaces.owner was a TEXT column holding an email with no FK, so a
      // user changing their email silently lost workspace ownership. Ownership
      // is matched on users.id now and no email may creep back in.
      expect(readAccessParams(TEST_USER)).not.toContain(TEST_USER.email);
      expect(writeAccessParams(TEST_USER)).not.toContain(TEST_USER.email);
    });

    it('coerces is_admin to a boolean', () => {
      // truthy non-bool input
      expect(readAccessParams({ ...TEST_USER, is_admin: 1 })[0]).toBe(true);
      expect(readAccessParams({ ...TEST_USER, is_admin: 0 })[0]).toBe(false);
      expect(readAccessParams({ ...TEST_USER, is_admin: null })[0]).toBe(false);
      expect(readAccessParams({ ...TEST_USER, is_admin: 'yes' })[0]).toBe(true);
    });
  });

  describe('writeAccessParams', () => {
    it('matches readAccessParams shape and ordering', () => {
      const r = readAccessParams(TEST_USER);
      const w = writeAccessParams(TEST_USER);
      expect(w).toEqual(r);
    });
  });

  // ── isArchiveOwner ──────────────────────────────────────

  describe('isArchiveOwner', () => {
    it('returns true for admin without hitting the database', async () => {
      const admin = { ...TEST_USER, is_admin: true };
      expect(await isArchiveOwner(admin, 5)).toBe(true);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('returns true when DB confirms creator/owner cascade matches', async () => {
      c2_query.mockResolvedValueOnce([{ '1': 1 }]);
      expect(await isArchiveOwner(TEST_USER, 5)).toBe(true);

      const [sql, params] = c2_query.mock.calls[0];
      expect(sql).toMatch(/FROM archives p/i);
      // Cascade: created_by, workspace owner, squad owner-role
      expect(sql).toMatch(/p\.created_by = \?/i);
      expect(sql).toMatch(/o\.owner_id = \?/i);
      expect(sql).toMatch(/tm\.role = 'owner'/i);
      expect(params).toEqual([5, TEST_USER.id, TEST_USER.id, TEST_USER.id]);
    });

    it('returns false when DB returns no row', async () => {
      c2_query.mockResolvedValueOnce([]);
      expect(await isArchiveOwner(TEST_USER, 5)).toBe(false);
    });

    it('coerces non-numeric archiveId to a number', async () => {
      c2_query.mockResolvedValueOnce([]);
      await isArchiveOwner(TEST_USER, '7');
      const [, params] = c2_query.mock.calls[0];
      expect(params[0]).toBe(7);
      expect(typeof params[0]).toBe('number');
    });
  });
  // ── isWorkspaceMember ─────────────────────────

  describe('isWorkspaceMember', () => {
    it('returns true for admin without hitting the database', async () => {
      const admin = { ...TEST_USER, is_admin: true };
      expect(await isWorkspaceMember(admin, 3)).toBe(true);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('returns true when the caller owns the workspace', async () => {
      c2_query.mockResolvedValueOnce([{ '1': 1 }]);
      expect(await isWorkspaceMember(TEST_USER, 3)).toBe(true);

      const [sql, params] = c2_query.mock.calls[0];
      expect(sql).toMatch(/FROM workspaces o/i);
      expect(sql).toMatch(/o\.owner_id = \?/i);
      expect(params).toEqual([3, TEST_USER.id, TEST_USER.id]);
    });

    it('matches membership through any squad inside the workspace', async () => {
      // There is no workspace_members table: squad membership is the only
      // route into a workspace other than owning it.
      c2_query.mockResolvedValueOnce([{ '1': 1 }]);
      expect(await isWorkspaceMember(TEST_USER, 3)).toBe(true);

      const [sql] = c2_query.mock.calls[0];
      expect(sql).toMatch(/FROM squad_members sm/i);
      expect(sql).toMatch(/JOIN squads t ON t\.id = sm\.squad_id/i);
      expect(sql).toMatch(/t\.workspace_id = o\.id/i);
      expect(sql).toMatch(/sm\.user_id = \?/i);
    });

    it('returns false for a caller with no relationship to the workspace', async () => {
      c2_query.mockResolvedValueOnce([]);
      expect(await isWorkspaceMember(TEST_USER, 3)).toBe(false);
    });

    it('returns false for an unknown workspace', async () => {
      c2_query.mockResolvedValueOnce([]);
      expect(await isWorkspaceMember(TEST_USER, 999999)).toBe(false);
      expect(c2_query).toHaveBeenCalledTimes(1);
    });

    it('binds the workspace id as a parameter rather than interpolating it', async () => {
      c2_query.mockResolvedValueOnce([]);
      await isWorkspaceMember(TEST_USER, '3');
      const [sql, params] = c2_query.mock.calls[0];
      expect(sql).not.toContain('3');
      expect(params[0]).toBe(3);
      expect(typeof params[0]).toBe('number');
    });
  });

  // ── isSquadWorkspaceMember ────────────────────

  describe('isSquadWorkspaceMember', () => {
    it('returns true for admin without hitting the database', async () => {
      const admin = { ...TEST_USER, is_admin: true };
      expect(await isSquadWorkspaceMember(admin, 8)).toBe(true);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('resolves the squad workspace, then delegates to isWorkspaceMember', async () => {
      c2_query
        .mockResolvedValueOnce([{ workspace_id: 3 }])
        .mockResolvedValueOnce([{ '1': 1 }]);
      expect(await isSquadWorkspaceMember(TEST_USER, 8)).toBe(true);

      expect(c2_query).toHaveBeenCalledTimes(2);
      const [squadSql, squadParams] = c2_query.mock.calls[0];
      expect(squadSql).toMatch(/FROM squads t/i);
      expect(squadSql).toMatch(/t\.id = \?/i);
      expect(squadParams).toEqual([8]);
      const [, workspaceParams] = c2_query.mock.calls[1];
      expect(workspaceParams).toEqual([3, TEST_USER.id, TEST_USER.id]);
    });

    it('returns false when the caller is outside the squad workspace', async () => {
      c2_query
        .mockResolvedValueOnce([{ workspace_id: 3 }])
        .mockResolvedValueOnce([]);
      expect(await isSquadWorkspaceMember(TEST_USER, 8)).toBe(false);
      expect(c2_query).toHaveBeenCalledTimes(2);
    });

    it('returns false for an unknown squad, without a second query', async () => {
      c2_query.mockResolvedValueOnce([]);
      expect(await isSquadWorkspaceMember(TEST_USER, 999999)).toBe(false);
      expect(c2_query).toHaveBeenCalledTimes(1);
    });

    it('returns false for a squad whose workspace_id is NULL', async () => {
      // squads.workspace_id is nullable. A squad that belongs to no workspace
      // has no tenant boundary to test against, so a non-admin is never inside
      // it and no membership query is worth issuing.
      c2_query.mockResolvedValueOnce([{ workspace_id: null }]);
      expect(await isSquadWorkspaceMember(TEST_USER, 8)).toBe(false);
      expect(c2_query).toHaveBeenCalledTimes(1);
    });

    it('still returns true for an admin when the squad has no workspace', async () => {
      const admin = { ...TEST_USER, is_admin: true };
      expect(await isSquadWorkspaceMember(admin, 8)).toBe(true);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('binds the squad id as a parameter rather than interpolating it', async () => {
      c2_query.mockResolvedValueOnce([]);
      await isSquadWorkspaceMember(TEST_USER, '8');
      const [sql, params] = c2_query.mock.calls[0];
      expect(sql).not.toContain('8');
      expect(params[0]).toBe(8);
      expect(typeof params[0]).toBe('number');
    });
  });
});

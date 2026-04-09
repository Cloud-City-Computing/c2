import { describe, it, expect, beforeEach } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { loadPermissions, requirePermission } from '../../middleware/permissions.js';
import { resetMocks, TEST_USER } from '../helpers.js';

function createMocks(overrides = {}) {
  const req = {
    user: TEST_USER,
    body: {},
    params: {},
    ...overrides,
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('loadPermissions Middleware', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('loads permissions from database', async () => {
    c2_query.mockResolvedValueOnce([{ create_squad: true, create_archive: true, create_log: true }]);

    const { req, res, next } = createMocks();
    await loadPermissions(req, res, next);

    expect(req.permissions).toEqual({ create_squad: true, create_archive: true, create_log: true });
    expect(next).toHaveBeenCalled();
  });

  it('uses defaults when no permissions row', async () => {
    c2_query.mockResolvedValueOnce([]);

    const { req, res, next } = createMocks();
    await loadPermissions(req, res, next);

    expect(req.permissions).toEqual({ create_squad: false, create_archive: false, create_log: true });
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when no user', async () => {
    const { req, res, next } = createMocks({ user: undefined });
    await loadPermissions(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requirePermission Middleware', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('passes when global permission is granted', async () => {
    c2_query.mockResolvedValueOnce([{ create_squad: true, create_archive: true, create_log: true }]);

    const middleware = requirePermission('create_archive');
    const { req, res, next } = createMocks();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('denies when global permission is false and no squad context', async () => {
    c2_query.mockResolvedValueOnce([{ create_squad: false, create_archive: false, create_log: false }]);

    const middleware = requirePermission('create_archive');
    const { req, res, next } = createMocks();
    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/create_archive/);
  });

  it('passes via squad-level permission fallback', async () => {
    // Global permissions deny
    c2_query.mockResolvedValueOnce([{ create_squad: false, create_archive: false, create_log: false }]);
    // Not workspace owner
    c2_query.mockResolvedValueOnce([]);
    // Squad member has permission
    c2_query.mockResolvedValueOnce([{ allowed: true }]);

    const middleware = requirePermission('create_archive');
    const { req, res, next } = createMocks({ body: { squad_id: 1 } });
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('passes via workspace owner bypass', async () => {
    // Global permissions deny
    c2_query.mockResolvedValueOnce([{ create_squad: false, create_archive: false, create_log: false }]);
    // Workspace owner
    c2_query.mockResolvedValueOnce([{ '1': 1 }]);

    const middleware = requirePermission('create_archive');
    const { req, res, next } = createMocks({ body: { squad_id: 1 } });
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when no user', async () => {
    const middleware = requirePermission('create_archive');
    const { req, res, next } = createMocks({ user: undefined });
    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

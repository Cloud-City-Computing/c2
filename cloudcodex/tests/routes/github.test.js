import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

// Mock the decryptToken function from oauth.js
vi.mock('../../routes/oauth.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    decryptToken: vi.fn((token) => token ? 'mock-github-token' : null),
  };
});

// Mock global fetch for GitHub API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockGitHubConnected() {
  // requireGitHub middleware: DB query for oauth_accounts
  c2_query.mockResolvedValueOnce([{ encrypted_token: 'encrypted-value' }]);
}

function mockGitHubNotConnected() {
  c2_query.mockResolvedValueOnce([]); // no oauth account
}

function mockGitHubApiResponse(data, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });
}

describe('GitHub Routes', () => {
  beforeEach(() => {
    resetMocks();
    mockFetch.mockReset();
  });

  // --- Middleware: requireGitHub ---

  describe('requireGitHub middleware', () => {
    it('rejects when GitHub is not connected', async () => {
      mockAuthenticated();
      mockGitHubNotConnected();

      const res = await request(app)
        .get('/api/github/repos')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/not connected/i);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();
      const res = await request(app).get('/api/github/repos');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /api/github/repos ---

  describe('GET /api/github/repos', () => {
    it('returns repos list', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse([
        {
          id: 1, name: 'my-repo', full_name: 'user/my-repo',
          description: 'A test repo', private: false, default_branch: 'main',
          language: 'JavaScript', updated_at: '2026-01-01',
          html_url: 'https://github.com/user/my-repo',
          owner: { login: 'user', avatar_url: 'https://avatar.url' },
        },
      ]);

      const res = await request(app)
        .get('/api/github/repos')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.repos).toHaveLength(1);
      expect(res.body.repos[0].name).toBe('my-repo');
    });

    it('searches repos when q is provided', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        items: [
          {
            id: 2, name: 'search-match', full_name: 'user/search-match',
            description: null, private: true, default_branch: 'main',
            language: null, updated_at: '2026-02-01',
            html_url: 'https://github.com/user/search-match',
            owner: { login: 'user', avatar_url: 'https://avatar.url' },
          },
        ],
      });

      const res = await request(app)
        .get('/api/github/repos?q=search')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.repos).toHaveLength(1);
      expect(res.body.repos[0].name).toBe('search-match');
    });
  });

  // --- GET /api/github/repos/:owner/:repo ---

  describe('GET /api/github/repos/:owner/:repo', () => {
    it('returns repo info', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        id: 1, name: 'my-repo', full_name: 'user/my-repo',
        description: 'Test', private: false, default_branch: 'main',
        language: 'JavaScript', html_url: 'https://github.com/user/my-repo',
        permissions: { admin: true, push: true, pull: true },
        owner: { login: 'user', avatar_url: 'https://avatar.url' },
      });

      const res = await request(app)
        .get('/api/github/repos/user/my-repo')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.repo.name).toBe('my-repo');
      expect(res.body.repo.default_branch).toBe('main');
    });
  });

  // --- GET /api/github/repos/:owner/:repo/branches ---

  describe('GET /api/github/repos/:owner/:repo/branches', () => {
    it('returns branches', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse([
        { name: 'main', commit: { sha: 'abc123' } },
        { name: 'feature', commit: { sha: 'def456' } },
      ]);

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/branches')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.branches).toHaveLength(2);
      expect(res.body.branches[0].name).toBe('main');
    });
  });

  // --- POST /api/github/repos/:owner/:repo/branches ---

  describe('POST /api/github/repos/:owner/:repo/branches', () => {
    it('creates a branch', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      // Get ref SHA
      mockGitHubApiResponse({ object: { sha: 'abc123' } });
      // Create ref
      mockGitHubApiResponse({ ref: 'refs/heads/new-branch' }, 201);

      const res = await request(app)
        .post('/api/github/repos/user/my-repo/branches')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'new-branch', from_ref: 'main' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects missing branch name', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/repos/user/my-repo/branches')
        .set('Authorization', 'Bearer valid-token')
        .send({ from_ref: 'main' });

      expect(res.status).toBe(400);
    });

    it('rejects missing from_ref', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/repos/user/my-repo/branches')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'new-branch' });

      expect(res.status).toBe(400);
    });
  });

  // --- GET /api/github/repos/:owner/:repo/tree ---

  describe('GET /api/github/repos/:owner/:repo/tree', () => {
    it('returns filtered file tree', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        sha: 'treeSha',
        truncated: false,
        tree: [
          { path: 'docs', type: 'tree', sha: 'a1' },
          { path: 'docs/README.md', type: 'blob', sha: 'b1', size: 100 },
          { path: 'docs/image.png', type: 'blob', sha: 'b2', size: 5000 },
          { path: 'src', type: 'tree', sha: 'a2' },
          { path: 'src/index.js', type: 'blob', sha: 'b3', size: 200 },
        ],
      });

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/tree?ref=main')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // png should be filtered out, md and js should remain
      const paths = res.body.tree.map(t => t.path);
      expect(paths).toContain('docs/README.md');
      expect(paths).toContain('src/index.js');
      expect(paths).not.toContain('docs/image.png');
    });
  });

  // --- GET /api/github/repos/:owner/:repo/contents/* ---

  describe('GET /api/github/repos/:owner/:repo/contents/*', () => {
    it('returns file contents decoded from base64', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        name: 'README.md',
        path: 'docs/README.md',
        sha: 'filesha',
        size: 11,
        content: Buffer.from('Hello World').toString('base64'),
        html_url: 'https://github.com/user/repo/blob/main/docs/README.md',
      });

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/contents/docs/README.md')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.file.content).toBe('Hello World');
      expect(res.body.file.name).toBe('README.md');
    });
  });

  // --- PUT /api/github/repos/:owner/:repo/contents/* ---

  describe('PUT /api/github/repos/:owner/:repo/contents/*', () => {
    it('commits file changes', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        commit: { sha: 'commitsha', message: 'update docs', html_url: 'https://github.com/...' },
        content: { sha: 'newfilesha', path: 'docs/README.md' },
      });

      const res = await request(app)
        .put('/api/github/repos/user/my-repo/contents/docs/README.md')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: '# Updated', message: 'update docs', branch: 'main', sha: 'oldsha' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.commit.sha).toBe('commitsha');
    });

    it('rejects missing content', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .put('/api/github/repos/user/my-repo/contents/docs/README.md')
        .set('Authorization', 'Bearer valid-token')
        .send({ message: 'update' });

      expect(res.status).toBe(400);
    });

    it('rejects missing commit message', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .put('/api/github/repos/user/my-repo/contents/docs/README.md')
        .set('Authorization', 'Bearer valid-token')
        .send({ content: '# Updated' });

      expect(res.status).toBe(400);
    });
  });

  // --- GET /api/github/repos/:owner/:repo/pulls ---

  describe('GET /api/github/repos/:owner/:repo/pulls', () => {
    it('returns pull requests', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse([
        {
          number: 1, title: 'Fix docs', state: 'open',
          html_url: 'https://github.com/user/repo/pull/1',
          head: { ref: 'fix-docs', sha: 'abc' },
          base: { ref: 'main' },
          user: { login: 'user', avatar_url: 'https://avatar.url' },
          created_at: '2026-01-01', updated_at: '2026-01-02',
        },
      ]);

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/pulls')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.pulls).toHaveLength(1);
      expect(res.body.pulls[0].title).toBe('Fix docs');
    });
  });

  // --- POST /api/github/repos/:owner/:repo/pulls ---

  describe('POST /api/github/repos/:owner/:repo/pulls', () => {
    it('creates a pull request', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        number: 2, title: 'New PR', html_url: 'https://github.com/user/repo/pull/2',
      }, 201);

      const res = await request(app)
        .post('/api/github/repos/user/my-repo/pulls')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'New PR', head: 'feature', base: 'main' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pull.number).toBe(2);
    });

    it('rejects missing title', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/repos/user/my-repo/pulls')
        .set('Authorization', 'Bearer valid-token')
        .send({ head: 'feature', base: 'main' });

      expect(res.status).toBe(400);
    });

    it('rejects missing head/base', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/repos/user/my-repo/pulls')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'PR' });

      expect(res.status).toBe(400);
    });
  });

  // --- GET /api/github/repos/:owner/:repo/search ---

  describe('GET /api/github/repos/:owner/:repo/search', () => {
    it('returns matching files', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        items: [
          { name: 'README.md', path: 'docs/README.md', html_url: 'https://github.com/...' },
        ],
      });

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/search?q=README')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.files).toHaveLength(1);
    });

    it('returns empty for short query', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/search?q=a')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.files).toHaveLength(0);
    });
  });
});

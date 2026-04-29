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

  // --- DELETE /api/github/repos/:owner/:repo/contents/* ---

  describe('DELETE /api/github/repos/:owner/:repo/contents/*', () => {
    it('deletes a file', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        commit: { sha: 'abc123', message: 'Delete README.md', html_url: 'https://github.com/user/repo/commit/abc123' },
      });

      const res = await request(app)
        .delete('/api/github/repos/user/my-repo/contents/docs/README.md')
        .set('Authorization', 'Bearer valid-token')
        .send({ sha: 'old-sha-123', message: 'Remove readme', branch: 'main' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.commit.sha).toBe('abc123');
    });

    it('uses default commit message when none provided', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        commit: { sha: 'abc123', message: 'Delete file.txt', html_url: 'https://github.com/...' },
      });

      const res = await request(app)
        .delete('/api/github/repos/user/my-repo/contents/file.txt')
        .set('Authorization', 'Bearer valid-token')
        .send({ sha: 'old-sha' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects missing SHA', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .delete('/api/github/repos/user/my-repo/contents/file.txt')
        .set('Authorization', 'Bearer valid-token')
        .send({ message: 'delete it' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/sha/i);
    });
  });

  // --- POST /api/github/repos/:owner/:repo/rename ---

  describe('POST /api/github/repos/:owner/:repo/rename', () => {
    it('renames a file via 6-step Git flow', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      // Step 1: GET ref
      mockGitHubApiResponse({ object: { sha: 'commit-sha-1' } });
      // Step 2: GET commit
      mockGitHubApiResponse({ tree: { sha: 'tree-sha-1' } });
      // Step 3: GET old file contents
      mockGitHubApiResponse({ sha: 'blob-sha-1' });
      // Step 4: POST create tree
      mockGitHubApiResponse({ sha: 'new-tree-sha' }, 201);
      // Step 5: POST create commit
      mockGitHubApiResponse({ sha: 'new-commit-sha' }, 201);
      // Step 6: PATCH update ref
      mockGitHubApiResponse({ object: { sha: 'new-commit-sha' } });

      const res = await request(app)
        .post('/api/github/repos/user/my-repo/rename')
        .set('Authorization', 'Bearer valid-token')
        .send({ oldPath: 'docs/old.md', newPath: 'docs/new.md', branch: 'main' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.newPath).toBe('docs/new.md');
      expect(res.body.commit.sha).toBe('new-commit-sha');
      expect(mockFetch).toHaveBeenCalledTimes(6);
    });

    it('rejects missing oldPath or newPath', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/repos/user/my-repo/rename')
        .set('Authorization', 'Bearer valid-token')
        .send({ oldPath: 'a.md' });

      expect(res.status).toBe(400);
    });

    it('rejects when oldPath equals newPath', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/repos/user/my-repo/rename')
        .set('Authorization', 'Bearer valid-token')
        .send({ oldPath: 'a.md', newPath: 'a.md' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/differ/i);
    });
  });

  // --- GET /api/github/repos/:owner/:repo/pulls/:number ---

  describe('GET /api/github/repos/:owner/:repo/pulls/:number', () => {
    it('returns single pull request details', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        number: 42, title: 'Fix bug', body: 'Fixes #10', state: 'open',
        merged: false, html_url: 'https://github.com/user/repo/pull/42',
        head: { ref: 'fix-bug', sha: 'head-sha', label: 'user:fix-bug' },
        base: { ref: 'main', sha: 'base-sha', label: 'user:main' },
        user: { login: 'user', avatar_url: 'https://avatar.url' },
        created_at: '2026-01-01', updated_at: '2026-01-02', merged_at: null,
        commits: 3, additions: 10, deletions: 2, changed_files: 1,
      });

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/pulls/42')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pull.number).toBe(42);
      expect(res.body.pull.title).toBe('Fix bug');
      expect(res.body.pull.head.ref).toBe('fix-bug');
      expect(res.body.pull.base.ref).toBe('main');
      expect(res.body.pull.commits).toBe(3);
    });
  });

  // --- GET /api/github/repos/:owner/:repo/pulls/:number/commits ---

  describe('GET /api/github/repos/:owner/:repo/pulls/:number/commits', () => {
    it('returns PR commits', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse([
        {
          sha: 'c1', html_url: 'https://github.com/...',
          commit: { message: 'First commit', author: { name: 'User', date: '2026-01-01' }, committer: { name: 'User' } },
          author: { login: 'user', avatar_url: 'https://avatar.url' },
          committer: { login: 'user' },
        },
      ]);

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/pulls/42/commits')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.commits).toHaveLength(1);
      expect(res.body.commits[0].sha).toBe('c1');
      expect(res.body.commits[0].author.login).toBe('user');
    });

    it('supports pagination', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse([]);

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/pulls/42/commits?per_page=5&page=2')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.commits).toHaveLength(0);
    });
  });

  // --- GET /api/github/repos/:owner/:repo/pulls/:number/files ---

  describe('GET /api/github/repos/:owner/:repo/pulls/:number/files', () => {
    it('returns PR changed files', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse([
        {
          filename: 'src/app.js', status: 'modified',
          additions: 5, deletions: 2, changes: 7,
          patch: '@@ -1,3 +1,4 @@...', previous_filename: null,
        },
      ]);

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/pulls/42/files')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.files).toHaveLength(1);
      expect(res.body.files[0].filename).toBe('src/app.js');
      expect(res.body.files[0].status).toBe('modified');
      expect(res.body.files[0].patch).toBeTruthy();
    });

    it('handles renamed files', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse([
        {
          filename: 'new-name.js', status: 'renamed',
          additions: 0, deletions: 0, changes: 0,
          patch: null, previous_filename: 'old-name.js',
        },
      ]);

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/pulls/42/files')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.files[0].previous_filename).toBe('old-name.js');
    });
  });

  // --- GET /api/github/repos/:owner/:repo/commits ---

  describe('GET /api/github/repos/:owner/:repo/commits', () => {
    it('returns commit list', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse([
        {
          sha: 'abc', html_url: 'https://github.com/...',
          commit: { message: 'Initial', author: { name: 'User', date: '2026-01-01' }, committer: { name: 'User' } },
          author: { login: 'user', avatar_url: 'https://avatar.url' },
          committer: { login: 'user' },
          stats: { total: 10, additions: 7, deletions: 3 },
        },
      ]);

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/commits')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.commits).toHaveLength(1);
      expect(res.body.commits[0].sha).toBe('abc');
      expect(res.body.commits[0].stats.total).toBe(10);
    });

    it('passes filter query params', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse([]);

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/commits?path=src/app.js&sha=main&author=user&since=2026-01-01&until=2026-02-01')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.commits).toHaveLength(0);
      // Verify the fetch call included the filter params
      const fetchUrl = mockFetch.mock.calls[0][0];
      expect(fetchUrl).toContain('path=src');
      expect(fetchUrl).toContain('author=user');
      expect(fetchUrl).toContain('since=2026-01-01');
    });
  });

  // --- GET /api/github/repos/:owner/:repo/commits/:sha ---

  describe('GET /api/github/repos/:owner/:repo/commits/:sha', () => {
    it('returns single commit details with files', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        sha: 'full-sha-123', html_url: 'https://github.com/...',
        commit: { message: 'Fix typo', author: { name: 'User', date: '2026-01-01' } },
        author: { login: 'user', avatar_url: 'https://avatar.url' },
        stats: { total: 2, additions: 1, deletions: 1 },
        files: [
          { filename: 'README.md', status: 'modified', additions: 1, deletions: 1, changes: 2, patch: '@@ ...' },
        ],
      });

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/commits/full-sha-123')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.commit.sha).toBe('full-sha-123');
      expect(res.body.commit.message).toBe('Fix typo');
      expect(res.body.commit.stats.total).toBe(2);
      expect(res.body.commit.files).toHaveLength(1);
      expect(res.body.commit.files[0].filename).toBe('README.md');
    });

    it('handles commit with no files array', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        sha: 'empty-sha', html_url: 'https://github.com/...',
        commit: { message: 'Empty', author: { name: 'User', date: '2026-01-01' } },
        author: null,
        stats: { total: 0, additions: 0, deletions: 0 },
        files: undefined,
      });

      const res = await request(app)
        .get('/api/github/repos/user/my-repo/commits/empty-sha')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.commit.files).toHaveLength(0);
      expect(res.body.commit.author.login).toBeNull();
    });
  });

  // --- POST /api/github/import-to-codex ---

  describe('POST /api/github/import-to-codex', () => {
    it('imports a markdown file and stores markdown_content', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      // DB: verify write access to archive
      c2_query.mockResolvedValueOnce([{ id: 1, name: 'My Archive' }]);

      // GitHub: fetch file contents (base64-encoded markdown)
      const mdContent = '# Hello World\n\nSome **bold** text.';
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from(mdContent).toString('base64'),
        sha: 'file-sha-abc',
      });

      // DB: INSERT into logs
      c2_query.mockResolvedValueOnce({ insertId: 42 });
      // DB: INSERT into github_links (fire-and-forget)
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/github/import-to-codex')
        .set('Authorization', 'Bearer valid-token')
        .send({ owner: 'user', repo: 'my-repo', path: 'docs/guide.md', ref: 'main', archive_id: 1 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.logId).toBe(42);
      expect(res.body.archive_name).toBe('My Archive');

      // Verify the INSERT query included markdown_content
      const insertCall = c2_query.mock.calls.find(c => c[0].includes('INSERT INTO logs'));
      expect(insertCall).toBeTruthy();
      expect(insertCall[1]).toContain(mdContent); // raw markdown stored
    });

    it('imports a non-markdown file with null markdown_content', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      c2_query.mockResolvedValueOnce([{ id: 1, name: 'My Archive' }]);

      const jsContent = 'console.log("hello");';
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from(jsContent).toString('base64'),
        sha: 'file-sha-js',
      });

      c2_query.mockResolvedValueOnce({ insertId: 43 });
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/github/import-to-codex')
        .set('Authorization', 'Bearer valid-token')
        .send({ owner: 'user', repo: 'my-repo', path: 'src/index.js', archive_id: 1 });

      expect(res.status).toBe(201);
      expect(res.body.logId).toBe(43);

      // Verify markdown_content is null for non-markdown files
      const insertCall = c2_query.mock.calls.find(c => c[0].includes('INSERT INTO logs'));
      expect(insertCall[1]).toContain(null);
    });

    it('uses custom title when provided', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      c2_query.mockResolvedValueOnce([{ id: 1, name: 'Archive' }]);
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from('# Doc').toString('base64'),
        sha: 'sha1',
      });
      c2_query.mockResolvedValueOnce({ insertId: 44 });
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/github/import-to-codex')
        .set('Authorization', 'Bearer valid-token')
        .send({ owner: 'user', repo: 'my-repo', path: 'README.md', archive_id: 1, title: 'Custom Title' });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('Custom Title');
    });

    it('rejects missing required fields', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/import-to-codex')
        .set('Authorization', 'Bearer valid-token')
        .send({ owner: 'user', repo: 'my-repo' }); // missing path and archive_id

      expect(res.status).toBe(400);
    });

    it('rejects invalid archive_id', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/import-to-codex')
        .set('Authorization', 'Bearer valid-token')
        .send({ owner: 'user', repo: 'my-repo', path: 'a.md', archive_id: 'bad' });

      expect(res.status).toBe(400);
    });

    it('rejects when archive not found or no write access', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      c2_query.mockResolvedValueOnce([]); // no archive found

      const res = await request(app)
        .post('/api/github/import-to-codex')
        .set('Authorization', 'Bearer valid-token')
        .send({ owner: 'user', repo: 'my-repo', path: 'a.md', archive_id: 999 });

      expect(res.status).toBe(403);
    });

    it('rejects when path points to a directory', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      c2_query.mockResolvedValueOnce([{ id: 1, name: 'Archive' }]);
      mockGitHubApiResponse({ type: 'dir' });

      const res = await request(app)
        .post('/api/github/import-to-codex')
        .set('Authorization', 'Bearer valid-token')
        .send({ owner: 'user', repo: 'my-repo', path: 'src', archive_id: 1 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/file/i);
    });
  });

  // --- GET /api/github/link/:logId ---

  describe('GET /api/github/link/:logId', () => {
    it('returns link for a document', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      c2_query.mockResolvedValueOnce([{
        repo_owner: 'user', repo_name: 'my-repo',
        file_path: 'docs/guide.md', branch: 'main', file_sha: 'sha-abc',
      }]);

      const res = await request(app)
        .get('/api/github/link/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.link.repo_owner).toBe('user');
      expect(res.body.link.file_path).toBe('docs/guide.md');
    });

    it('returns null link when none exists', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      c2_query.mockResolvedValueOnce([]); // no link found

      const res = await request(app)
        .get('/api/github/link/999')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.link).toBeNull();
    });

    it('rejects invalid logId', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .get('/api/github/link/abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // --- PUT /api/github/link/:logId ---

  describe('PUT /api/github/link/:logId', () => {
    it('creates or updates a link', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      c2_query.mockResolvedValueOnce([]); // INSERT/UPDATE result

      const res = await request(app)
        .put('/api/github/link/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ repo_owner: 'user', repo_name: 'my-repo', file_path: 'docs/guide.md', branch: 'main', file_sha: 'sha-xyz' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects missing required fields', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .put('/api/github/link/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ repo_owner: 'user' }); // missing repo_name, file_path, branch

      expect(res.status).toBe(400);
    });

    it('rejects invalid logId', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .put('/api/github/link/abc')
        .set('Authorization', 'Bearer valid-token')
        .send({ repo_owner: 'u', repo_name: 'r', file_path: 'f', branch: 'b' });

      expect(res.status).toBe(400);
    });
  });

  // --- DELETE /api/github/link/:logId ---

  describe('DELETE /api/github/link/:logId', () => {
    it('deletes a link', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      c2_query.mockResolvedValueOnce([]); // DELETE result

      const res = await request(app)
        .delete('/api/github/link/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects invalid logId', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .delete('/api/github/link/abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // --- GET /api/github/link/:logId/status (P0 sync) ---

  describe('GET /api/github/link/:logId/status', () => {
    function mockLinkRow(overrides = {}) {
      // First DB call after middleware: loadLinkAndLog joined query.
      c2_query.mockResolvedValueOnce([{
        id: 1,
        log_id: 7,
        repo_owner: 'user', repo_name: 'repo', file_path: 'docs/x.md', branch: 'main',
        file_sha: 'remote-old', base_sha: 'remote-old',
        last_pulled_at: '2026-04-20T10:00:00Z',
        last_pushed_at: null,
        sync_status: 'clean',
        html_content: '<p>hi</p>',
        markdown_content: 'hi',
        log_updated_at: '2026-04-20T10:00:00Z',
        title: 'X',
        ...overrides,
      }]);
    }

    it('returns clean when remote sha matches base_sha and no local edits', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow();
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from('hi').toString('base64'),
        sha: 'remote-old',
      });
      // Trailing UPDATE github_links: sync_status persistence (fire-and-forget)
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/github/link/7/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.sync_status).toBe('clean');
      expect(res.body.remote_sha).toBe('remote-old');
      expect(res.body.local_changed).toBe(false);
    });

    it('reports remote_ahead when remote sha differs and no local edits', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow();
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from('new remote').toString('base64'),
        sha: 'remote-new',
      });
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/github/link/7/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.sync_status).toBe('remote_ahead');
    });

    it('reports local_ahead when log was updated after last pull and remote unchanged', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow({
        last_pulled_at: '2026-04-20T10:00:00Z',
        log_updated_at: '2026-04-21T10:00:00Z', // newer than last_pulled_at
      });
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from('hi').toString('base64'),
        sha: 'remote-old', // matches base_sha
      });
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/github/link/7/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.body.sync_status).toBe('local_ahead');
      expect(res.body.local_changed).toBe(true);
    });

    it('reports diverged when both sides changed', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow({
        last_pulled_at: '2026-04-20T10:00:00Z',
        log_updated_at: '2026-04-21T10:00:00Z',
      });
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from('different').toString('base64'),
        sha: 'remote-new',
      });
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/github/link/7/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.body.sync_status).toBe('diverged');
    });

    it('returns 404 when no link exists or no read access', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      c2_query.mockResolvedValueOnce([]); // empty join

      const res = await request(app)
        .get('/api/github/link/999/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects invalid logId', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .get('/api/github/link/abc/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // --- POST /api/github/link/:logId/pull (P0 sync) ---

  describe('POST /api/github/link/:logId/pull', () => {
    function mockLinkRow(overrides = {}) {
      c2_query.mockResolvedValueOnce([{
        id: 1, log_id: 7,
        repo_owner: 'user', repo_name: 'repo', file_path: 'docs/x.md', branch: 'main',
        file_sha: 'sha-old', base_sha: 'sha-old',
        last_pulled_at: null, last_pushed_at: null, sync_status: 'clean',
        html_content: '<p>local</p>', markdown_content: 'local',
        log_updated_at: '2026-04-20T10:00:00Z', title: 'X',
        ...overrides,
      }]);
    }

    it('overwrite_local writes new content and advances base_sha', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow();
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from('# new\n\nremote text').toString('base64'),
        sha: 'sha-new',
      });
      c2_query.mockResolvedValueOnce([]); // UPDATE logs
      c2_query.mockResolvedValueOnce([]); // UPDATE github_links

      const res = await request(app)
        .post('/api/github/link/7/pull')
        .set('Authorization', 'Bearer valid-token')
        .send({ strategy: 'overwrite_local' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.new_base_sha).toBe('sha-new');
    });

    it('merge with non-conflicting changes succeeds', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      // local = base + extra line locally; remote = base + extra line remotely (different lines)
      mockLinkRow({
        markdown_content: 'line1\nlocal-add\nshared\n',
      });
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from('line1\nshared\nremote-add\n').toString('base64'),
        sha: 'sha-new',
      });
      // fetchBlobBySha (base content):
      mockGitHubApiResponse({
        encoding: 'base64',
        content: Buffer.from('line1\nshared\n').toString('base64'),
      });
      c2_query.mockResolvedValueOnce([]); // UPDATE logs
      c2_query.mockResolvedValueOnce([]); // UPDATE github_links

      const res = await request(app)
        .post('/api/github/link/7/pull')
        .set('Authorization', 'Bearer valid-token')
        .send({ strategy: 'merge' });

      expect(res.status).toBe(200);
      expect(res.body.merged_markdown).toContain('local-add');
      expect(res.body.merged_markdown).toContain('remote-add');
    });

    it('merge with conflicting hunks returns 409 with conflict payload', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow({ markdown_content: 'line1\nlocal change\nline3' });
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from('line1\nremote change\nline3').toString('base64'),
        sha: 'sha-new',
      });
      // fetchBlobBySha (base):
      mockGitHubApiResponse({
        encoding: 'base64',
        content: Buffer.from('line1\noriginal\nline3').toString('base64'),
      });

      const res = await request(app)
        .post('/api/github/link/7/pull')
        .set('Authorization', 'Bearer valid-token')
        .send({ strategy: 'merge' });

      expect(res.status).toBe(409);
      expect(res.body.conflicts.length).toBeGreaterThan(0);
      expect(res.body.merged_with_markers).toContain('<<<<<<< ours');
    });

    it('preview returns merged markdown without writing', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow({ markdown_content: 'line1\nshared\n' });
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from('line1\nshared\nremote-add\n').toString('base64'),
        sha: 'sha-new',
      });
      mockGitHubApiResponse({
        encoding: 'base64',
        content: Buffer.from('line1\nshared\n').toString('base64'),
      });

      const res = await request(app)
        .post('/api/github/link/7/pull')
        .set('Authorization', 'Bearer valid-token')
        .send({ strategy: 'preview' });

      expect(res.status).toBe(200);
      expect(res.body.strategy).toBe('preview');
      expect(res.body.merged_markdown).toContain('remote-add');
    });

    it('rejects invalid strategy', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/link/7/pull')
        .set('Authorization', 'Bearer valid-token')
        .send({ strategy: 'nope' });

      expect(res.status).toBe(400);
    });

    it('returns 404 when remote file no longer exists', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow();
      // Simulate 404 from GitHub
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not Found' }),
      });

      const res = await request(app)
        .post('/api/github/link/7/pull')
        .set('Authorization', 'Bearer valid-token')
        .send({ strategy: 'overwrite_local' });

      expect(res.status).toBe(404);
    });
  });

  // --- POST /api/github/link/:logId/push (P0 sync) ---

  describe('POST /api/github/link/:logId/push', () => {
    function mockLinkRow(overrides = {}) {
      c2_query.mockResolvedValueOnce([{
        id: 1, log_id: 7,
        repo_owner: 'user', repo_name: 'repo', file_path: 'docs/x.md', branch: 'main',
        file_sha: 'sha-old', base_sha: 'sha-old',
        last_pulled_at: null, last_pushed_at: null, sync_status: 'clean',
        html_content: '<p>updated</p>', markdown_content: 'updated content',
        log_updated_at: '2026-04-20T10:00:00Z', title: 'X',
        ...overrides,
      }]);
    }

    it('direct push succeeds and advances file_sha + base_sha', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow();
      // PUT contents response (this also triggers the post-PUT-contents
      // upsert in the existing handler — but we only call it via the sync
      // endpoint here, so only the sync path runs).
      mockGitHubApiResponse({
        commit: { sha: 'commit-sha', html_url: 'https://...', message: 'm' },
        content: { sha: 'sha-new', path: 'docs/x.md' },
      });
      c2_query.mockResolvedValueOnce([]); // UPDATE github_links

      const res = await request(app)
        .post('/api/github/link/7/push')
        .set('Authorization', 'Bearer valid-token')
        .send({ commit_message: 'Update docs', branch_strategy: 'direct' });

      expect(res.status).toBe(200);
      expect(res.body.blob_sha).toBe('sha-new');
      expect(res.body.commit_sha).toBe('commit-sha');
      expect(res.body.pr_number).toBeNull();
    });

    it('pr push creates branch, pushes, and opens PR', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow();
      // GET ref (source branch SHA)
      mockGitHubApiResponse({ object: { sha: 'branch-sha' } });
      // POST refs (create branch)
      mockGitHubApiResponse({});
      // GET contents on new branch (fetchRemoteFile to grab the file's blob SHA on the PR branch)
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from('updated content').toString('base64'),
        sha: 'sha-on-pr-branch',
      });
      // PUT contents (the actual push)
      mockGitHubApiResponse({
        commit: { sha: 'commit-sha', html_url: 'https://...', message: 'm' },
        content: { sha: 'sha-after-push', path: 'docs/x.md' },
      });
      // POST pulls (open PR)
      mockGitHubApiResponse({ number: 42, html_url: 'https://github.com/.../pull/42' });
      c2_query.mockResolvedValueOnce([]); // UPDATE github_links

      const res = await request(app)
        .post('/api/github/link/7/push')
        .set('Authorization', 'Bearer valid-token')
        .send({
          commit_message: 'Update docs',
          branch_strategy: 'pr',
          pr_title: 'Documentation update',
        });

      expect(res.status).toBe(200);
      expect(res.body.pr_number).toBe(42);
    });

    it('returns 409 and flips sync_status when remote moved during push', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow();
      // PUT contents fails with 409 (remote moved)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ message: 'is at xxx but expected yyy' }),
      });
      c2_query.mockResolvedValueOnce([]); // UPDATE github_links sync_status = 'diverged'

      const res = await request(app)
        .post('/api/github/link/7/push')
        .set('Authorization', 'Bearer valid-token')
        .send({ commit_message: 'msg', branch_strategy: 'direct' });

      expect(res.status).toBe(409);
      expect(res.body.sync_status).toBe('diverged');
    });

    it('rejects empty document', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow({ html_content: '', markdown_content: null });

      const res = await request(app)
        .post('/api/github/link/7/push')
        .set('Authorization', 'Bearer valid-token')
        .send({ commit_message: 'msg', branch_strategy: 'direct' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/empty/i);
    });

    it('rejects pr branch_strategy without pr_title', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/link/7/push')
        .set('Authorization', 'Bearer valid-token')
        .send({ commit_message: 'msg', branch_strategy: 'pr' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/pr_title/i);
    });
  });

  // --- POST /api/github/link/:logId/resolve (P0 sync) ---

  describe('POST /api/github/link/:logId/resolve', () => {
    function mockLinkRow(overrides = {}) {
      c2_query.mockResolvedValueOnce([{
        id: 1, log_id: 7,
        repo_owner: 'user', repo_name: 'repo', file_path: 'docs/x.md', branch: 'main',
        file_sha: 'sha-old', base_sha: 'sha-base',
        last_pulled_at: null, last_pushed_at: null, sync_status: 'diverged',
        html_content: '<p>conflict</p>', markdown_content: 'conflict',
        log_updated_at: '2026-04-20T10:00:00Z', title: 'X',
        ...overrides,
      }]);
    }

    it('persists resolved markdown and sets sync_status=local_ahead', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow();
      c2_query.mockResolvedValueOnce([]); // UPDATE logs
      c2_query.mockResolvedValueOnce([]); // UPDATE github_links

      const res = await request(app)
        .post('/api/github/link/7/resolve')
        .set('Authorization', 'Bearer valid-token')
        .send({ resolved_markdown: '# resolved\nfinal text', base_sha: 'sha-base' });

      expect(res.status).toBe(200);
      expect(res.body.sync_status).toBe('local_ahead');
    });

    it('returns 409 when client base_sha mismatches stored base_sha', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockLinkRow();

      const res = await request(app)
        .post('/api/github/link/7/resolve')
        .set('Authorization', 'Bearer valid-token')
        .send({ resolved_markdown: 'x', base_sha: 'something-else' });

      expect(res.status).toBe(409);
    });

    it('rejects missing resolved_markdown', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/link/7/resolve')
        .set('Authorization', 'Bearer valid-token')
        .send({ base_sha: 'sha-base' });

      expect(res.status).toBe(400);
    });
  });

  // --- GET /api/github/embed/code (P1) ---

  describe('GET /api/github/embed/code', () => {
    it('returns the full file content with detected language', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      const fileBody = 'line1\nline2\nline3\nline4\nline5';
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from(fileBody).toString('base64'),
        sha: 'embed-sha',
        html_url: 'https://github.com/u/r/blob/main/src/x.js',
      });

      const res = await request(app)
        .get('/api/github/embed/code?owner=u&repo=r&path=src/x.js&ref=main')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.content).toBe(fileBody);
      expect(res.body.language).toBe('javascript');
      expect(res.body.total_lines).toBe(5);
    });

    it('slices to the requested line range', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      const fileBody = 'a\nb\nc\nd\ne';
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from(fileBody).toString('base64'),
        sha: 'embed-sha',
        html_url: '',
      });

      const res = await request(app)
        .get('/api/github/embed/code?owner=u&repo=r&path=f.txt&start=2&end=4')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('b\nc\nd');
      expect(res.body.line_start).toBe(2);
      expect(res.body.line_end).toBe(4);
    });

    it('rejects when path is missing', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .get('/api/github/embed/code?owner=u&repo=r')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('returns 400 when path points to a directory', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({ type: 'dir' });

      const res = await request(app)
        .get('/api/github/embed/code?owner=u&repo=r&path=src')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // --- POST /api/github/archives/:archiveId/repos/:repoId/import (P1) ---

  describe('POST /api/github/archives/:archiveId/repos/:repoId/import', () => {
    it('imports markdown files under docs_path and creates github_links rows', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      // Archive write access
      c2_query.mockResolvedValueOnce([{ id: 5, name: 'Docs' }]);
      // archive_repos lookup
      c2_query.mockResolvedValueOnce([{
        id: 11, repo_owner: 'u', repo_name: 'r', default_branch: 'main', docs_path: 'docs',
      }]);
      // GitHub: tree
      mockGitHubApiResponse({
        tree: [
          { path: 'docs/intro.md', type: 'blob', sha: 'sha1' },
          { path: 'docs/guide.md', type: 'blob', sha: 'sha2' },
          { path: 'src/index.js', type: 'blob', sha: 'shaJs' },
        ],
      });

      // First file: not yet linked
      c2_query.mockResolvedValueOnce([]); // existing-link check
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from('# Intro').toString('base64'),
        sha: 'blob-sha-1',
      });
      c2_query.mockResolvedValueOnce({ insertId: 100 }); // INSERT logs
      c2_query.mockResolvedValueOnce([]); // INSERT github_links

      // Second file: not yet linked
      c2_query.mockResolvedValueOnce([]);
      mockGitHubApiResponse({
        type: 'file',
        content: Buffer.from('# Guide').toString('base64'),
        sha: 'blob-sha-2',
      });
      c2_query.mockResolvedValueOnce({ insertId: 101 });
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/github/archives/5/repos/11/import')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.imported).toHaveLength(2);
      expect(res.body.imported[0].path).toBe('docs/intro.md');
      expect(res.body.imported[1].path).toBe('docs/guide.md');
      expect(res.body.skipped).toHaveLength(0);
    });

    it('skips files already linked in the archive', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      c2_query.mockResolvedValueOnce([{ id: 5, name: 'Docs' }]);
      c2_query.mockResolvedValueOnce([{
        id: 11, repo_owner: 'u', repo_name: 'r', default_branch: 'main', docs_path: 'docs',
      }]);
      mockGitHubApiResponse({
        tree: [{ path: 'docs/already.md', type: 'blob', sha: 'sha1' }],
      });
      // existing-link check returns a row
      c2_query.mockResolvedValueOnce([{ log_id: 99 }]);

      const res = await request(app)
        .post('/api/github/archives/5/repos/11/import')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.imported).toHaveLength(0);
      expect(res.body.skipped).toHaveLength(1);
      expect(res.body.skipped[0].reason).toBe('already_linked');
      expect(res.body.skipped[0].log_id).toBe(99);
    });

    it('rejects when archive write access denied', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      c2_query.mockResolvedValueOnce([]); // archive lookup empty

      const res = await request(app)
        .post('/api/github/archives/5/repos/11/import')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid archive or repo id', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/archives/abc/repos/11/import')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // --- P2: PR-as-document ---

  describe('GET /api/github/repos/:owner/:repo/pulls/:number/session', () => {
    it('creates a virtual log + session row on first call', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      // Order of c2_query calls inside the route handler:
      //   1) SELECT existing pr_session (empty)
      //   2) SELECT existing system archive (empty)
      //   3) INSERT system archive
      //   4) INSERT logs
      //   5) INSERT github_pr_sessions
      //   6) UPDATE logs ACL
      c2_query.mockResolvedValueOnce([]); // pr_session lookup
      c2_query.mockResolvedValueOnce([]); // archive lookup
      c2_query.mockResolvedValueOnce({ insertId: 99 }); // INSERT archive
      c2_query.mockResolvedValueOnce({ insertId: 200 }); // INSERT logs
      c2_query.mockResolvedValueOnce({ insertId: 1 }); // INSERT pr_sessions
      c2_query.mockResolvedValueOnce([]); // UPDATE logs ACL

      const res = await request(app)
        .get('/api/github/repos/u/r/pulls/42/session')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.log_id).toBe(200);
      expect(res.body.session_id).toBe(1);
    });

    it('reuses the existing session on subsequent calls', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      // session lookup returns existing row -> short-circuit
      c2_query.mockResolvedValueOnce([{ id: 5, log_id: 555 }]);
      // UPDATE logs read/write_access (still runs to keep ACL fresh)
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/github/repos/u/r/pulls/42/session')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.log_id).toBe(555);
      expect(res.body.session_id).toBe(5);
    });
  });

  describe('POST /api/github/repos/:owner/:repo/pulls/:number/comments', () => {
    it('posts to GitHub then mirrors locally with external_id', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      // GitHub: POST review comment
      mockGitHubApiResponse({
        id: 9876,
        body: 'Looks good',
        path: 'src/x.js',
        line: 12,
        html_url: 'https://github.com/u/r/pull/42#discussion_r9876',
      });
      // Session lookup: existing session
      c2_query.mockResolvedValueOnce([{ id: 5, log_id: 555 }]);
      // UPDATE logs ACL
      c2_query.mockResolvedValueOnce([]);
      // INSERT comments
      c2_query.mockResolvedValueOnce({ insertId: 333 });

      const res = await request(app)
        .post('/api/github/repos/u/r/pulls/42/comments')
        .set('Authorization', 'Bearer valid-token')
        .send({ body: 'Looks good', commit_id: 'abc', path: 'src/x.js', line: 12 });

      expect(res.status).toBe(201);
      expect(res.body.comment_id).toBe(333);
      expect(res.body.external_id).toBe('9876');
      expect(res.body.log_id).toBe(555);

      const insertCall = c2_query.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes("INSERT INTO comments")
      );
      expect(insertCall).toBeTruthy();
      expect(insertCall[1]).toContain('9876');
    });

    it('rejects when body is missing', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/repos/u/r/pulls/42/comments')
        .set('Authorization', 'Bearer valid-token')
        .send({ commit_id: 'abc', path: 'x', line: 1 });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/github/issues/search', () => {
    it('returns issues from GitHub search API', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        items: [
          {
            number: 7, title: 'Bug', state: 'open',
            repository_url: 'https://api.github.com/repos/u/r',
            html_url: 'https://github.com/u/r/issues/7',
            user: { login: 'alice', avatar_url: 'a' },
            labels: [{ name: 'bug' }],
          },
        ],
      });

      const res = await request(app)
        .get('/api/github/issues/search?q=bug')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.issues).toHaveLength(1);
      expect(res.body.issues[0].number).toBe(7);
      expect(res.body.issues[0].labels).toContain('bug');
    });

    it('returns empty list for short queries', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .get('/api/github/issues/search?q=a')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.issues).toEqual([]);
    });
  });

  describe('GET /api/github/repos/:owner/:repo/issues/:number', () => {
    it('returns issue detail with assignees', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        number: 11, title: 'Feature', body: 'do it', state: 'open',
        html_url: 'https://github.com/u/r/issues/11',
        user: { login: 'me', avatar_url: 'a' },
        assignees: [{ login: 'bob', avatar_url: 'b' }],
        labels: [{ name: 'enhancement' }],
        created_at: '2026-04-01', updated_at: '2026-04-10', closed_at: null,
      });

      const res = await request(app)
        .get('/api/github/repos/u/r/issues/11')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.issue.number).toBe(11);
      expect(res.body.issue.assignees[0].login).toBe('bob');
    });
  });

  describe('POST /api/github/repos/:owner/:repo/pulls (draft + reviewers)', () => {
    it('forwards draft flag and requests reviewers', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      // POST pulls
      mockGitHubApiResponse({
        number: 5,
        title: 'Draft PR',
        html_url: 'https://github.com/u/r/pull/5',
        draft: true,
      });
      // POST requested_reviewers
      mockGitHubApiResponse({});

      const res = await request(app)
        .post('/api/github/repos/u/r/pulls')
        .set('Authorization', 'Bearer valid-token')
        .send({
          title: 'Draft PR',
          head: 'feature',
          base: 'main',
          draft: true,
          reviewers: ['alice', 'bob'],
        });

      expect(res.status).toBe(200);
      expect(res.body.pull.number).toBe(5);
      expect(res.body.pull.draft).toBe(true);

      const callBodies = mockFetch.mock.calls.map((c) => c[1]?.body || '');
      expect(callBodies.some((b) => b.includes('"draft":true'))).toBe(true);
      expect(callBodies.some((b) => b.includes('alice') && b.includes('bob'))).toBe(true);
    });
  });

  describe('GET /api/logs/by-github-ref', () => {
    it('returns logs that reference the given PR via github_embed_refs', async () => {
      mockAuthenticated();
      // Note: this route is NOT under /github so does not use requireGitHub
      c2_query.mockResolvedValueOnce([
        { log_id: 30, title: 'Spec', archive_id: 4 },
        { log_id: 31, title: 'Runbook', archive_id: 4 },
      ]);

      const res = await request(app)
        .get('/api/logs/by-github-ref?repo=u/r&kind=pr&ref=42')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(2);
      expect(res.body.logs[0].title).toBe('Spec');
    });

    it('rejects malformed repo or kind', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/logs/by-github-ref?repo=invalid&kind=bogus&ref=1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // --- P3: Actions / CI ---

  describe('GET /api/github/repos/:owner/:repo/actions/runs', () => {
    it('returns workflow runs for a branch', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        workflow_runs: [
          {
            id: 1, name: 'CI', status: 'completed', conclusion: 'success',
            head_branch: 'main', head_sha: 'sha1',
            html_url: 'https://github.com/u/r/actions/runs/1',
            created_at: '2026-04-25', updated_at: '2026-04-25',
          },
        ],
      });

      const res = await request(app)
        .get('/api/github/repos/u/r/actions/runs?branch=main')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.runs).toHaveLength(1);
      expect(res.body.latest.conclusion).toBe('success');
      expect(res.body.cached).toBe(false);
    });

    it('serves a second identical request from cache without re-fetching', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        workflow_runs: [
          { id: 1, name: 'CI', status: 'completed', conclusion: 'success', head_branch: 'feat', head_sha: 's' },
        ],
      });

      const first = await request(app)
        .get('/api/github/repos/u/r/actions/runs?branch=feat')
        .set('Authorization', 'Bearer valid-token');
      expect(first.body.cached).toBe(false);

      // Second call: requireGitHub still queries DB, but the GitHub fetch
      // is short-circuited by the cache. Set up only the auth-side mocks.
      mockAuthenticated();
      mockGitHubConnected();

      const second = await request(app)
        .get('/api/github/repos/u/r/actions/runs?branch=feat')
        .set('Authorization', 'Bearer valid-token');
      expect(second.status).toBe(200);
      expect(second.body.cached).toBe(true);
    });
  });

  // --- P3: Releases ---

  describe('Releases endpoints', () => {
    it('GET /releases returns the list', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse([
        {
          id: 99, tag_name: 'v1', name: 'First', body: 'notes',
          draft: false, prerelease: false,
          html_url: 'https://github.com/u/r/releases/tag/v1',
          published_at: '2026-04-01',
          author: { login: 'me', avatar_url: 'a' },
        },
      ]);

      const res = await request(app)
        .get('/api/github/repos/u/r/releases')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.releases).toHaveLength(1);
      expect(res.body.releases[0].tag_name).toBe('v1');
    });

    it('POST /releases creates a release', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockGitHubApiResponse({
        id: 1234, tag_name: 'v2', html_url: 'https://github.com/u/r/releases/tag/v2',
      });

      const res = await request(app)
        .post('/api/github/repos/u/r/releases')
        .set('Authorization', 'Bearer valid-token')
        .send({ tag_name: 'v2', name: 'Second', body: 'changelog' });

      expect(res.status).toBe(201);
      expect(res.body.release.id).toBe(1234);
    });

    it('rejects POST /releases without tag_name', async () => {
      mockAuthenticated();
      mockGitHubConnected();

      const res = await request(app)
        .post('/api/github/repos/u/r/releases')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'No tag' });

      expect(res.status).toBe(400);
    });
  });

  // --- P3: Squad↔Team sync ---

  describe('POST /api/squads/:squadId/github-team/sync', () => {
    it('rejects callers without manage permission', async () => {
      mockAuthenticated();
      // userCanManageSquad query returns nothing (not allowed)
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/squads/1/github-team/sync')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects when squad has no github team binding', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      // userCanManageSquad: allowed
      c2_query.mockResolvedValueOnce([{ '1': 1 }]);
      // SELECT squad: no binding
      c2_query.mockResolvedValueOnce([{ github_org: null, github_team_slug: null }]);

      const res = await request(app)
        .post('/api/squads/1/github-team/sync')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not bound/i);
    });
  });

  // --- 401/403 → token_status=revoked ---

  describe('token revocation tracking', () => {
    it('flips token_status to revoked on 401 from GitHub', async () => {
      mockAuthenticated();
      mockGitHubConnected();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Bad credentials' }),
      });
      // The fire-and-forget UPDATE oauth_accounts:
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/github/repos')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(401);
      // The revocation update is fire-and-forget; verify the SQL matches
      const revocationCall = c2_query.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes("token_status = 'revoked'")
      );
      expect(revocationCall).toBeTruthy();
    });
  });
});

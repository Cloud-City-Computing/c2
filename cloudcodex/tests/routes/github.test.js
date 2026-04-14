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
});

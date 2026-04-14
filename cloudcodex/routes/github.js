/**
 * GitHub Integration API routes for Cloud Codex
 *
 * Proxies GitHub API calls on behalf of authenticated users using their
 * stored encrypted access tokens. Supports repo browsing, file viewing/editing,
 * branch management, and pull request creation.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { marked, Renderer } from 'marked';
import { c2_query } from '../mysql_connect.js';

// --- Helpers ---
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from './helpers/shared.js';
import { isValidId } from './helpers/shared.js';
import { writeAccessWhere, writeAccessParams } from './helpers/ownership.js';
import { sanitizeHtml } from './helpers/shared.js';
import { decryptToken } from './oauth.js';

const router = express.Router();

const GITHUB_API = 'https://api.github.com';

// --- Import renderer ---

/**
 * Minimal marked Renderer that converts HTML align attributes to
 * style="text-align: ..." so TipTap's TextAlign extension can read them.
 */
function createImportRenderer() {
  const renderer = new Renderer();
  renderer.html = function ({ text }) {
    return text.replace(
      /(<(?:p|h[1-6]|div))\s+align="(left|center|right)"/gi,
      '$1 style="text-align: $2"'
    );
  };
  return renderer;
}

// --- Helpers ---

/**
 * Retrieve the decrypted GitHub access token for the authenticated user.
 * Returns null if no GitHub account is linked.
 */
async function getGitHubToken(userId) {
  const [account] = await c2_query(
    `SELECT encrypted_token FROM oauth_accounts WHERE user_id = ? AND provider = 'github' LIMIT 1`,
    [userId]
  );
  if (!account?.encrypted_token) return null;
  return decryptToken(account.encrypted_token);
}

/**
 * Make an authenticated request to the GitHub API.
 */
async function githubFetch(token, path, options = {}) {
  const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.message || `GitHub API error: ${res.status}`);
    err.status = res.status;
    err.ghBody = body;
    throw err;
  }

  return res.json();
}

/**
 * Middleware: verify user has GitHub connected and attach token to request.
 */
async function requireGitHub(req, res, next) {
  const token = await getGitHubToken(req.user.id);
  if (!token) {
    return res.status(403).json({
      success: false,
      message: 'GitHub account not connected. Link your GitHub account in Account Settings.',
    });
  }
  req.ghToken = token;
  next();
}

// All GitHub API routes require auth + GitHub connection
router.use('/github', requireAuth, asyncHandler(requireGitHub));

// --- Repos ---

/**
 * GET /api/github/repos
 * List the authenticated user's repos (including org repos they have access to).
 * Query: ?page=1&per_page=30&sort=updated&q=searchterm
 */
router.get('/github/repos', asyncHandler(async (req, res) => {
  const { page = 1, per_page = 30, sort = 'updated', q } = req.query;

  let repos;
  if (q) {
    // Use GitHub search API for filtering
    const data = await githubFetch(req.ghToken,
      `/search/repositories?q=${encodeURIComponent(q)}+user:@me&sort=${sort}&per_page=${per_page}&page=${page}`
    );
    repos = data.items.map(r => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      description: r.description,
      private: r.private,
      default_branch: r.default_branch,
      language: r.language,
      updated_at: r.updated_at,
      html_url: r.html_url,
      owner: { login: r.owner.login, avatar_url: r.owner.avatar_url },
    }));
  } else {
    const data = await githubFetch(req.ghToken,
      `/user/repos?sort=${sort}&direction=desc&per_page=${per_page}&page=${page}&affiliation=owner,collaborator,organization_member`
    );
    repos = data.map(r => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      description: r.description,
      private: r.private,
      default_branch: r.default_branch,
      language: r.language,
      updated_at: r.updated_at,
      html_url: r.html_url,
      owner: { login: r.owner.login, avatar_url: r.owner.avatar_url },
    }));
  }

  res.json({ success: true, repos });
}));

// --- Branches ---

/**
 * GET /api/github/repos/:owner/:repo/branches
 * List branches for a repo.
 */
router.get('/github/repos/:owner/:repo/branches', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const data = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`
  );

  const branches = data.map(b => ({ name: b.name, sha: b.commit.sha }));
  res.json({ success: true, branches });
}));

/**
 * POST /api/github/repos/:owner/:repo/branches
 * Create a new branch from a given ref.
 * Body: { name, from_ref }
 */
router.post('/github/repos/:owner/:repo/branches', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const { name, from_ref } = req.body;

  if (!name || !from_ref) {
    return res.status(400).json({ success: false, message: 'Branch name and source ref are required' });
  }

  // Get the SHA of the source ref
  const refData = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(from_ref)}`
  );

  // Create the new branch
  await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${name}`, sha: refData.object.sha }),
    }
  );

  res.json({ success: true, message: `Branch '${name}' created` });
}));

// --- File Tree ---

/**
 * GET /api/github/repos/:owner/:repo/tree
 * Get the full file tree for a ref.
 * Query: ?ref=main
 */
router.get('/github/repos/:owner/:repo/tree', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const ref = req.query.ref || 'HEAD';

  const data = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`
  );

  // Supported text file extensions (viewable/editable in Cloud Codex)
  const VIEWABLE_EXT = /\.(md|mdx|markdown|rst|txt|json|yaml|yml|toml|xml|csv|tsv|html|htm|css|scss|sass|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|c|cpp|h|hpp|cs|php|sh|bash|zsh|fish|ps1|bat|cmd|sql|graphql|gql|prisma|proto|env|ini|cfg|conf|gitignore|gitattributes|dockerignore|editorconfig|eslintrc|prettierrc|babelrc|nvmrc|Makefile|Dockerfile|Procfile|LICENSE|Gemfile|Rakefile|Vagrantfile)$/i;
  const VIEWABLE_NAME = /^(Makefile|Dockerfile|Procfile|LICENSE|Gemfile|Rakefile|Vagrantfile|Brewfile|Justfile|CMakeLists\.txt|\.gitignore|\.gitattributes|\.dockerignore|\.editorconfig|\.env\.example|\.eslintrc|\.prettierrc|\.babelrc|\.nvmrc)$/i;

  // Return only relevant fields, filtering out unsupported binary files
  const tree = data.tree
    .filter(item => {
      if (item.type === 'tree') return true;
      if (item.type !== 'blob') return false;
      const name = item.path.split('/').pop();
      return VIEWABLE_EXT.test(name) || VIEWABLE_NAME.test(name);
    })
    .map(item => ({
      path: item.path,
      type: item.type,
      sha: item.sha,
      size: item.size,
      isMarkdown: item.type === 'blob' && /\.(md|mdx|markdown|rst|txt)$/i.test(item.path),
    }));

  // Remove empty folders (folders whose children were all filtered out)
  const filePaths = new Set(tree.filter(i => i.type === 'blob').map(i => i.path));
  const usedDirs = new Set();
  for (const fp of filePaths) {
    const parts = fp.split('/');
    for (let i = 1; i < parts.length; i++) {
      usedDirs.add(parts.slice(0, i).join('/'));
    }
  }
  const filteredTree = tree.filter(i => i.type === 'blob' || usedDirs.has(i.path));

  res.json({ success: true, tree: filteredTree, sha: data.sha, truncated: data.truncated });
}));

// --- File Contents ---

/**
 * GET /api/github/repos/:owner/:repo/contents/*
 * Get the contents of a file.
 * Query: ?ref=main
 */
router.get('/github/repos/:owner/:repo/contents/{*filePath}', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const raw = req.params.filePath;
  const filePath = (Array.isArray(raw) ? raw.join('/') : String(raw || '')).replace(/^\//, '');
  const ref = req.query.ref || 'HEAD';

  if (!filePath) {
    return res.status(400).json({ success: false, message: 'File path is required' });
  }

  const data = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}?ref=${encodeURIComponent(ref)}`
  );

  // Decode base64 content
  let content = '';
  if (data.content) {
    content = Buffer.from(data.content, 'base64').toString('utf8');
  }

  res.json({
    success: true,
    file: {
      name: data.name,
      path: data.path,
      sha: data.sha,
      size: data.size,
      content,
      encoding: 'utf-8',
      html_url: data.html_url,
    },
  });
}));

/**
 * PUT /api/github/repos/:owner/:repo/contents/*
 * Create or update a file (commit).
 * Body: { content, message, branch, sha? }
 *   sha is required when updating an existing file (prevents conflicts).
 */
router.put('/github/repos/:owner/:repo/contents/{*filePath}', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const raw = req.params.filePath;
  const filePath = (Array.isArray(raw) ? raw.join('/') : String(raw || '')).replace(/^\//, '');
  const { content, message, branch, sha } = req.body;

  if (!filePath) {
    return res.status(400).json({ success: false, message: 'File path is required' });
  }
  if (content === undefined) {
    return res.status(400).json({ success: false, message: 'File content is required' });
  }
  if (!message) {
    return res.status(400).json({ success: false, message: 'Commit message is required' });
  }

  const payload = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: branch || undefined,
  };

  // sha is required for updates; omit for new files
  if (sha) payload.sha = sha;

  const data = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  res.json({
    success: true,
    message: 'File committed successfully',
    commit: {
      sha: data.commit.sha,
      message: data.commit.message,
      html_url: data.commit.html_url,
    },
    content: {
      sha: data.content.sha,
      path: data.content.path,
    },
  });
}));

// --- Delete File ---

/**
 * DELETE /api/github/repos/:owner/:repo/contents/*
 * Delete a file (commit the deletion).
 * Body: { message, branch, sha }
 */
router.delete('/github/repos/:owner/:repo/contents/{*filePath}', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const raw = req.params.filePath;
  const filePath = (Array.isArray(raw) ? raw.join('/') : String(raw || '')).replace(/^\//, '');
  const { message, branch, sha } = req.body;

  if (!filePath) {
    return res.status(400).json({ success: false, message: 'File path is required' });
  }
  if (!sha) {
    return res.status(400).json({ success: false, message: 'File SHA is required to prevent accidental deletions' });
  }

  const commitMsg = message || `Delete ${filePath}`;

  const data = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: commitMsg, sha, branch: branch || undefined }),
    }
  );

  res.json({
    success: true,
    message: 'File deleted successfully',
    commit: {
      sha: data.commit.sha,
      message: data.commit.message,
      html_url: data.commit.html_url,
    },
  });
}));

// --- Rename / Move File ---

/**
 * POST /api/github/repos/:owner/:repo/rename
 * Rename or move a file by creating it at the new path and deleting the old one.
 * Body: { oldPath, newPath, message, branch }
 * Uses the Git Trees API for an atomic single-commit rename.
 */
router.post('/github/repos/:owner/:repo/rename', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const { oldPath, newPath, message, branch } = req.body;

  if (!oldPath || !newPath) {
    return res.status(400).json({ success: false, message: 'Both oldPath and newPath are required' });
  }
  if (oldPath === newPath) {
    return res.status(400).json({ success: false, message: 'Old and new paths must differ' });
  }

  const ownerEnc = encodeURIComponent(owner);
  const repoEnc = encodeURIComponent(repo);
  const targetBranch = branch || 'HEAD';

  // 1. Get the branch ref to find the current commit SHA
  const refData = await githubFetch(req.ghToken,
    `/repos/${ownerEnc}/${repoEnc}/git/ref/heads/${encodeURIComponent(targetBranch)}`
  );
  const latestCommitSha = refData.object.sha;

  // 2. Get the current commit to find its tree SHA
  const commitData = await githubFetch(req.ghToken,
    `/repos/${ownerEnc}/${repoEnc}/git/commits/${latestCommitSha}`
  );
  const baseTreeSha = commitData.tree.sha;

  // 3. Get the old file's blob SHA
  const oldFileData = await githubFetch(req.ghToken,
    `/repos/${ownerEnc}/${repoEnc}/contents/${oldPath}?ref=${encodeURIComponent(targetBranch)}`
  );
  const blobSha = oldFileData.sha;

  // 4. Create a new tree that adds the file at the new path and removes it from the old path
  const newTree = await githubFetch(req.ghToken,
    `/repos/${ownerEnc}/${repoEnc}/git/trees`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: [
          // Remove old path (mode '160000' trick: set sha to null isn't supported, so we use a deletion entry)
          { path: oldPath, mode: '100644', type: 'blob', sha: null },
          // Add at new path with same blob content
          { path: newPath, mode: '100644', type: 'blob', sha: blobSha },
        ],
      }),
    }
  );

  // 5. Create a new commit pointing to this tree
  const commitMsg = message || `Rename ${oldPath} → ${newPath}`;
  const newCommit = await githubFetch(req.ghToken,
    `/repos/${ownerEnc}/${repoEnc}/git/commits`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: commitMsg,
        tree: newTree.sha,
        parents: [latestCommitSha],
      }),
    }
  );

  // 6. Update the branch ref to the new commit
  await githubFetch(req.ghToken,
    `/repos/${ownerEnc}/${repoEnc}/git/refs/heads/${encodeURIComponent(targetBranch)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: newCommit.sha }),
    }
  );

  res.json({
    success: true,
    message: `File renamed from ${oldPath} to ${newPath}`,
    commit: {
      sha: newCommit.sha,
      message: commitMsg,
      html_url: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`,
    },
    newPath,
  });
}));

// --- Pull Requests ---

/**
 * GET /api/github/repos/:owner/:repo/pulls
 * List open pull requests.
 * Query: ?state=open&per_page=10
 */
router.get('/github/repos/:owner/:repo/pulls', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const { state = 'open', per_page = 10 } = req.query;

  const data = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${state}&per_page=${per_page}`
  );

  const pulls = data.map(pr => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    html_url: pr.html_url,
    head: { ref: pr.head.ref, sha: pr.head.sha },
    base: { ref: pr.base.ref },
    user: { login: pr.user.login, avatar_url: pr.user.avatar_url },
    created_at: pr.created_at,
    updated_at: pr.updated_at,
  }));

  res.json({ success: true, pulls });
}));

/**
 * POST /api/github/repos/:owner/:repo/pulls
 * Create a pull request.
 * Body: { title, body?, head, base }
 */
router.post('/github/repos/:owner/:repo/pulls', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const { title, body: prBody, head, base } = req.body;

  if (!title || !head || !base) {
    return res.status(400).json({ success: false, message: 'Title, head branch, and base branch are required' });
  }

  const data = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body: prBody || '', head, base }),
    }
  );

  res.json({
    success: true,
    pull: {
      number: data.number,
      title: data.title,
      html_url: data.html_url,
    },
  });
}));

/**
 * GET /api/github/repos/:owner/:repo/pulls/:number
 * Get details of a single pull request.
 */
router.get('/github/repos/:owner/:repo/pulls/:number', asyncHandler(async (req, res) => {
  const { owner, repo, number } = req.params;

  const data = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(number)}`
  );

  res.json({
    success: true,
    pull: {
      number: data.number,
      title: data.title,
      body: data.body,
      state: data.state,
      merged: data.merged,
      html_url: data.html_url,
      head: { ref: data.head.ref, sha: data.head.sha, label: data.head.label },
      base: { ref: data.base.ref, sha: data.base.sha, label: data.base.label },
      user: { login: data.user.login, avatar_url: data.user.avatar_url },
      created_at: data.created_at,
      updated_at: data.updated_at,
      merged_at: data.merged_at,
      commits: data.commits,
      additions: data.additions,
      deletions: data.deletions,
      changed_files: data.changed_files,
    },
  });
}));

/**
 * GET /api/github/repos/:owner/:repo/pulls/:number/commits
 * List commits in a pull request.
 * Query: ?per_page=30&page=1
 */
router.get('/github/repos/:owner/:repo/pulls/:number/commits', asyncHandler(async (req, res) => {
  const { owner, repo, number } = req.params;
  const { per_page = 30, page = 1 } = req.query;

  const data = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(number)}/commits?per_page=${Math.min(Number(per_page), 100)}&page=${page}`
  );

  const commits = data.map(c => ({
    sha: c.sha,
    message: c.commit.message,
    date: c.commit.author.date,
    author: {
      name: c.commit.author.name,
      login: c.author?.login || null,
      avatar_url: c.author?.avatar_url || null,
    },
    committer: {
      name: c.commit.committer.name,
      login: c.committer?.login || null,
    },
    html_url: c.html_url,
  }));

  res.json({ success: true, commits });
}));

/**
 * GET /api/github/repos/:owner/:repo/pulls/:number/files
 * List files changed in a pull request.
 * Query: ?per_page=30&page=1
 */
router.get('/github/repos/:owner/:repo/pulls/:number/files', asyncHandler(async (req, res) => {
  const { owner, repo, number } = req.params;
  const { per_page = 30, page = 1 } = req.query;

  const data = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(number)}/files?per_page=${Math.min(Number(per_page), 100)}&page=${page}`
  );

  const files = data.map(f => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    patch: f.patch || null,
    previous_filename: f.previous_filename || null,
  }));

  res.json({ success: true, files });
}));

// --- Repo Info ---

/**
 * GET /api/github/repos/:owner/:repo
 * Get basic info about a repo (name, default branch, permissions, etc.)
 */
router.get('/github/repos/:owner/:repo', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;

  const data = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  );

  res.json({
    success: true,
    repo: {
      id: data.id,
      name: data.name,
      full_name: data.full_name,
      description: data.description,
      private: data.private,
      default_branch: data.default_branch,
      language: data.language,
      html_url: data.html_url,
      permissions: data.permissions,
      owner: { login: data.owner.login, avatar_url: data.owner.avatar_url },
    },
  });
}));

// --- Commit History ---

/**
 * GET /api/github/repos/:owner/:repo/commits
 * List commits for a repo, optionally filtered by file path, branch, or author.
 * Query: ?path=docs/readme.md&sha=main&author=username&per_page=30&page=1&since=&until=
 */
router.get('/github/repos/:owner/:repo/commits', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const { path, sha, author, per_page = 30, page = 1, since, until } = req.query;

  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (sha) params.set('sha', sha);
  if (author) params.set('author', author);
  if (since) params.set('since', since);
  if (until) params.set('until', until);
  params.set('per_page', String(Math.min(Number(per_page), 100)));
  params.set('page', String(page));

  const data = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${params}`
  );

  const commits = data.map(c => ({
    sha: c.sha,
    message: c.commit.message,
    date: c.commit.author.date,
    author: {
      name: c.commit.author.name,
      login: c.author?.login || null,
      avatar_url: c.author?.avatar_url || null,
    },
    committer: {
      name: c.commit.committer.name,
      login: c.committer?.login || null,
    },
    html_url: c.html_url,
    stats: c.stats || null,
  }));

  res.json({ success: true, commits });
}));

/**
 * GET /api/github/repos/:owner/:repo/commits/:sha
 * Get a single commit's details including file diff stats.
 */
router.get('/github/repos/:owner/:repo/commits/:sha', asyncHandler(async (req, res) => {
  const { owner, repo, sha } = req.params;

  const data = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`
  );

  res.json({
    success: true,
    commit: {
      sha: data.sha,
      message: data.commit.message,
      date: data.commit.author.date,
      author: {
        name: data.commit.author.name,
        login: data.author?.login || null,
        avatar_url: data.author?.avatar_url || null,
      },
      html_url: data.html_url,
      stats: data.stats,
      files: (data.files || []).map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch || null,
      })),
    },
  });
}));

// --- Search files in a repo ---

/**
 * GET /api/github/repos/:owner/:repo/search
 * Search for files by name within a repo.
 * Query: ?q=searchterm&ref=main
 */
router.get('/github/repos/:owner/:repo/search', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const { q } = req.query;

  if (!q || q.length < 2) {
    return res.json({ success: true, files: [] });
  }

  const data = await githubFetch(req.ghToken,
    `/search/code?q=${encodeURIComponent(q)}+repo:${encodeURIComponent(owner)}/${encodeURIComponent(repo)}+extension:md&per_page=20`
  );

  const files = data.items.map(item => ({
    name: item.name,
    path: item.path,
    html_url: item.html_url,
  }));

  res.json({ success: true, files });
}));

// --- Import GitHub file to Cloud Codex ---

/**
 * POST /api/github/import-to-codex
 * Fetch a file from GitHub and create a new Codex document with its content.
 * Body: { owner, repo, path, ref, archive_id, title? }
 */
router.post('/github/import-to-codex', asyncHandler(async (req, res) => {
  const { owner, repo, path, ref, archive_id, title } = req.body;

  if (!owner || !repo || !path) {
    return res.status(400).json({ success: false, message: 'owner, repo, and path are required' });
  }
  if (!archive_id || !isValidId(archive_id)) {
    return res.status(400).json({ success: false, message: 'Valid archive_id is required' });
  }

  // Verify write access to archive
  const [archive] = await c2_query(
    `SELECT p.id, p.name FROM archives p
     WHERE p.id = ?
       AND ${writeAccessWhere('p')}
     LIMIT 1`,
    [Number(archive_id), ...writeAccessParams(req.user)]
  );

  if (!archive) {
    return res.status(403).json({ success: false, message: 'Archive not found or write access denied' });
  }

  // Fetch file content from GitHub
  const params = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const ghFile = await githubFetch(req.ghToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}${params}`
  );

  if (ghFile.type !== 'file') {
    return res.status(400).json({ success: false, message: 'Path does not point to a file' });
  }

  const rawContent = Buffer.from(ghFile.content, 'base64').toString('utf-8');
  const fileName = path.split('/').pop();
  const isMarkdown = /\.(md|mdx|markdown)$/i.test(fileName);

  // Convert content to HTML for Codex document storage
  let htmlContent;
  if (isMarkdown) {
    htmlContent = sanitizeHtml(await marked.parse(rawContent, { renderer: createImportRenderer() }));
  } else {
    // Wrap plain text in a code block
    const escaped = rawContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    htmlContent = `<pre><code>${escaped}</code></pre>`;
  }

  const docTitle = (title || fileName.replace(/\.[^.]+$/, '')).trim();

  // Create the log — store raw markdown alongside HTML for lossless round-tripping
  const result = await c2_query(
    `INSERT INTO logs (archive_id, title, html_content, markdown_content, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [Number(archive_id), docTitle, htmlContent, isMarkdown ? rawContent : null, req.user.id, req.user.id]
  );

  res.status(201).json({
    success: true,
    logId: result.insertId,
    title: docTitle,
    archive_id: Number(archive_id),
    archive_name: archive.name,
  });

  // Save the github link (fire-and-forget, don't block the response)
  c2_query(
    `INSERT INTO github_links (log_id, repo_owner, repo_name, file_path, branch, file_sha, linked_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE repo_owner=VALUES(repo_owner), repo_name=VALUES(repo_name),
       file_path=VALUES(file_path), branch=VALUES(branch), file_sha=VALUES(file_sha)`,
    [result.insertId, owner, repo, path, ref || 'main', ghFile.sha, req.user.id]
  ).catch(() => {});
}));

// --- GitHub Link for Documents ---

/**
 * GET /api/github/link/:logId
 * Get the GitHub link for a Codex document (if any).
 */
router.get('/github/link/:logId', asyncHandler(async (req, res) => {
  const logId = Number(req.params.logId);
  if (!isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid logId' });
  }

  const [link] = await c2_query(
    `SELECT gl.repo_owner, gl.repo_name, gl.file_path, gl.branch, gl.file_sha
     FROM github_links gl
     JOIN logs l ON l.id = gl.log_id
     WHERE gl.log_id = ?
     LIMIT 1`,
    [logId]
  );

  res.json({ success: true, link: link || null });
}));

/**
 * PUT /api/github/link/:logId
 * Create or update the GitHub link for a Codex document.
 * Body: { repo_owner, repo_name, file_path, branch, file_sha }
 */
router.put('/github/link/:logId', asyncHandler(async (req, res) => {
  const logId = Number(req.params.logId);
  if (!isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid logId' });
  }

  const { repo_owner, repo_name, file_path, branch, file_sha } = req.body;
  if (!repo_owner || !repo_name || !file_path || !branch) {
    return res.status(400).json({ success: false, message: 'repo_owner, repo_name, file_path, and branch are required' });
  }

  await c2_query(
    `INSERT INTO github_links (log_id, repo_owner, repo_name, file_path, branch, file_sha, linked_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE repo_owner=VALUES(repo_owner), repo_name=VALUES(repo_name),
       file_path=VALUES(file_path), branch=VALUES(branch), file_sha=VALUES(file_sha)`,
    [logId, repo_owner, repo_name, file_path, branch, file_sha || null, req.user.id]
  );

  res.json({ success: true });
}));

/**
 * DELETE /api/github/link/:logId
 * Remove the GitHub link for a Codex document.
 */
router.delete('/github/link/:logId', asyncHandler(async (req, res) => {
  const logId = Number(req.params.logId);
  if (!isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid logId' });
  }

  await c2_query('DELETE FROM github_links WHERE log_id = ?', [logId]);

  res.json({ success: true });
}));

router.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({
    success: false,
    message: err.ghBody?.message || err.message || 'An internal server error occurred',
  });
});

export default router;

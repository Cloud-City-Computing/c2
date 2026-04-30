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
import TurndownService from 'turndown';
import { c2_query } from '../mysql_connect.js';

// --- Helpers ---
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from './helpers/shared.js';
import { isValidId } from './helpers/shared.js';
import { readAccessWhere, readAccessParams, writeAccessWhere, writeAccessParams } from './helpers/ownership.js';
import { sanitizeHtml } from './helpers/shared.js';
import { decryptToken } from './oauth.js';
import { diff3Merge } from '../src/lib/githubDiff.js';
import { broadcastToDoc } from '../services/collab.js';

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
 *
 * On 401/403 from GitHub, the user's token is marked as revoked so the UI
 * can prompt them to re-link without surfacing a generic 500. The marker
 * write is fire-and-forget — never block the HTTP response on it.
 */
async function githubFetch(token, path, options = {}, userId = null) {
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
    if ((res.status === 401 || res.status === 403) && userId) {
      const msg = String(body?.message || '').toLowerCase();
      // 403 is also returned for rate limits and missing scopes — only flip
      // status when the message indicates an auth-style failure.
      if (res.status === 401 || msg.includes('bad credentials') || msg.includes('credentials')) {
        c2_query(
          `UPDATE oauth_accounts SET token_status = 'revoked' WHERE user_id = ? AND provider = 'github'`,
          [userId]
        ).catch((err) => {
          console.error(`[${new Date().toISOString()}] github: failed to mark token revoked for user ${userId}:`, err);
        });
      }
    }
    const err = new Error(body.message || `GitHub API error: ${res.status}`);
    err.status = res.status;
    err.ghBody = body;
    throw err;
  }

  return res.json();
}

/**
 * Middleware: verify user has GitHub connected and attach a request-scoped
 * GitHub fetch helper. `req.gh(path, options)` automatically forwards the
 * user's id so 401/403 responses flip token_status to 'revoked'.
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
  req.gh = (path, options) => githubFetch(token, path, options, req.user.id);
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
    const data = await req.gh(
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
    const data = await req.gh(
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
  const data = await req.gh(
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
  const refData = await req.gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(from_ref)}`
  );

  // Create the new branch
  await req.gh(
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

  const data = await req.gh(
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

  const data = await req.gh(
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

  const data = await req.gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  // Keep linked Codex docs in sync: if any github_links row matches this
  // (owner, repo, path, branch), advance both file_sha and base_sha so the
  // link record stops drifting after a direct CommitPanel push.
  if (branch) {
    c2_query(
      `UPDATE github_links
         SET file_sha = ?, base_sha = ?, last_pushed_at = NOW(), sync_status = 'clean'
       WHERE repo_owner = ? AND repo_name = ? AND file_path = ? AND branch = ?`,
      [data.content.sha, data.content.sha, owner, repo, filePath, branch]
    ).catch((err) => {
      console.error(`[${new Date().toISOString()}] github: failed to advance link sha after push (${owner}/${repo}/${filePath}@${branch}):`, err);
    });
  }

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

  const data = await req.gh(
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
  const refData = await req.gh(
    `/repos/${ownerEnc}/${repoEnc}/git/ref/heads/${encodeURIComponent(targetBranch)}`
  );
  const latestCommitSha = refData.object.sha;

  // 2. Get the current commit to find its tree SHA
  const commitData = await req.gh(
    `/repos/${ownerEnc}/${repoEnc}/git/commits/${latestCommitSha}`
  );
  const baseTreeSha = commitData.tree.sha;

  // 3. Get the old file's blob SHA
  const oldFileData = await req.gh(
    `/repos/${ownerEnc}/${repoEnc}/contents/${oldPath}?ref=${encodeURIComponent(targetBranch)}`
  );
  const blobSha = oldFileData.sha;

  // 4. Create a new tree that adds the file at the new path and removes it from the old path
  const newTree = await req.gh(
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
  const newCommit = await req.gh(
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
  await req.gh(
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

  const data = await req.gh(
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
  const { title, body: prBody, head, base, draft, reviewers } = req.body;

  if (!title || !head || !base) {
    return res.status(400).json({ success: false, message: 'Title, head branch, and base branch are required' });
  }

  const data = await req.gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body: prBody || '', head, base, draft: Boolean(draft) }),
    }
  );

  // Optional: request reviewers on the new PR. Failures here are non-fatal —
  // the PR was created successfully, the user can re-request via the GitHub UI.
  if (Array.isArray(reviewers) && reviewers.length > 0) {
    try {
      await req.gh(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${data.number}/requested_reviewers`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewers: reviewers.filter((r) => typeof r === 'string') }),
        }
      );
    } catch (err) {
      // Surface in response but don't fail the PR creation
      data._reviewers_error = err.message;
    }
  }

  res.json({
    success: true,
    pull: {
      number: data.number,
      title: data.title,
      html_url: data.html_url,
      draft: Boolean(data.draft),
      reviewers_error: data._reviewers_error || null,
    },
  });
}));

/**
 * GET /api/github/repos/:owner/:repo/pulls/:number
 * Get details of a single pull request.
 */
router.get('/github/repos/:owner/:repo/pulls/:number', asyncHandler(async (req, res) => {
  const { owner, repo, number } = req.params;

  const data = await req.gh(
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

  const data = await req.gh(
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

  const data = await req.gh(
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

  const data = await req.gh(
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

  const data = await req.gh(
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

  const data = await req.gh(
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

  const data = await req.gh(
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
  const ghFile = await req.gh(
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

  // Save the github link (fire-and-forget, don't block the response).
  // base_sha = file_sha at import time so the merge base is the imported revision.
  c2_query(
    `INSERT INTO github_links (log_id, repo_owner, repo_name, file_path, branch, file_sha, base_sha, last_pulled_at, sync_status, linked_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'clean', ?)
     ON DUPLICATE KEY UPDATE repo_owner=VALUES(repo_owner), repo_name=VALUES(repo_name),
       file_path=VALUES(file_path), branch=VALUES(branch),
       file_sha=VALUES(file_sha), base_sha=VALUES(base_sha),
       last_pulled_at=VALUES(last_pulled_at), sync_status=VALUES(sync_status)`,
    [result.insertId, owner, repo, path, ref || 'main', ghFile.sha, ghFile.sha, req.user.id]
  ).catch((err) => {
    console.error(`[${new Date().toISOString()}] github: failed to record link for log ${result.insertId} (${owner}/${repo}/${path}):`, err);
  });
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
    `INSERT INTO github_links (log_id, repo_owner, repo_name, file_path, branch, file_sha, base_sha, last_pulled_at, sync_status, linked_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'clean', ?)
     ON DUPLICATE KEY UPDATE repo_owner=VALUES(repo_owner), repo_name=VALUES(repo_name),
       file_path=VALUES(file_path), branch=VALUES(branch),
       file_sha=VALUES(file_sha), base_sha=VALUES(base_sha),
       last_pulled_at=VALUES(last_pulled_at), sync_status=VALUES(sync_status)`,
    [logId, repo_owner, repo_name, file_path, branch, file_sha || null, file_sha || null, req.user.id]
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

// ─── Bidirectional sync ────────────────────────────────────────────

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

/**
 * Internal: load a github_links row for a log the user can read, or null.
 * Returns { link, log } where log carries html_content + markdown_content.
 */
async function loadLinkAndLog(logId, user, requireWrite = false) {
  const accessWhere = requireWrite ? writeAccessWhere('p') : readAccessWhere('p');
  const accessParams = requireWrite ? writeAccessParams(user) : readAccessParams(user);
  const rows = await c2_query(
    `SELECT gl.id, gl.log_id, gl.repo_owner, gl.repo_name, gl.file_path, gl.branch,
            gl.file_sha, gl.base_sha, gl.last_pulled_at, gl.last_pushed_at, gl.sync_status,
            l.html_content, l.markdown_content, l.updated_at AS log_updated_at, l.title
     FROM github_links gl
     INNER JOIN logs l ON l.id = gl.log_id
     INNER JOIN archives p ON p.id = l.archive_id
     WHERE gl.log_id = ? AND ${accessWhere}
     LIMIT 1`,
    [logId, ...accessParams]
  );
  return rows[0] || null;
}

/**
 * Compute the markdown that represents the current local state of a doc.
 * Prefers the explicit markdown_content column when present (lossless), else
 * round-trips the stored HTML through turndown.
 */
function localMarkdown(row) {
  if (typeof row.markdown_content === 'string' && row.markdown_content.length > 0) {
    return row.markdown_content;
  }
  if (typeof row.html_content === 'string' && row.html_content.length > 0) {
    return turndown.turndown(row.html_content);
  }
  return '';
}

/**
 * Fetch the contents of a file from GitHub. Returns { content, sha } or null
 * if the file does not exist on the given ref (404 swallowed).
 */
async function fetchRemoteFile(reqGh, owner, repo, filePath, ref) {
  try {
    const data = await reqGh(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}?ref=${encodeURIComponent(ref)}`
    );
    if (data.type !== 'file' || typeof data.content !== 'string') return null;
    return {
      content: Buffer.from(data.content, 'base64').toString('utf-8'),
      sha: data.sha,
    };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * Fetch a blob by SHA. Used to retrieve the merge-base content when the local
 * markdown has diverged from remote and we need 3-way merge input.
 */
async function fetchBlobBySha(reqGh, owner, repo, blobSha) {
  if (!blobSha) return '';
  try {
    const data = await reqGh(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(blobSha)}`
    );
    if (data?.encoding === 'base64' && typeof data.content === 'string') {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    return '';
  } catch (err) {
    if (err.status === 404) return '';
    throw err;
  }
}

function classifySync({ remoteSha, baseSha, localChanged }) {
  const remoteChanged = remoteSha && baseSha && remoteSha !== baseSha;
  if (!remoteChanged && !localChanged) return 'clean';
  if (remoteChanged && !localChanged) return 'remote_ahead';
  if (!remoteChanged && localChanged) return 'local_ahead';
  return 'diverged';
}

/**
 * GET /api/github/link/:logId/status
 * Reports the sync state of a linked document by comparing the remote SHA
 * to the stored merge base and inspecting the local update timestamp.
 */
router.get('/github/link/:logId/status', asyncHandler(async (req, res) => {
  const logId = Number(req.params.logId);
  if (!isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid logId' });
  }

  const row = await loadLinkAndLog(logId, req.user, false);
  if (!row) {
    return res.status(404).json({ success: false, message: 'No GitHub link for this document, or read access denied' });
  }

  const remote = await fetchRemoteFile(req.gh, row.repo_owner, row.repo_name, row.file_path, row.branch);
  const remoteSha = remote ? remote.sha : null;
  const remoteMissing = !remote;

  // Local-changed heuristic: log was updated after the most recent pull/push.
  // Conservative: counts ydoc auto-saves too, but a benign false-positive
  // here just means the user is offered a Pull they don't strictly need.
  const lastSyncTs = Math.max(
    row.last_pulled_at ? new Date(row.last_pulled_at).getTime() : 0,
    row.last_pushed_at ? new Date(row.last_pushed_at).getTime() : 0
  );
  const localTs = row.log_updated_at ? new Date(row.log_updated_at).getTime() : 0;
  const localChanged = lastSyncTs === 0 ? false : localTs > lastSyncTs;

  const baseSha = row.base_sha || row.file_sha || null;
  const status = remoteMissing ? 'remote_ahead' : classifySync({ remoteSha, baseSha, localChanged });

  // Persist the latest observation so other UIs (banners, sidebars) can read
  // it cheaply without re-hitting GitHub.
  c2_query(
    `UPDATE github_links SET file_sha = ?, sync_status = ? WHERE log_id = ?`,
    [remoteSha, status, logId]
  ).catch((err) => {
    console.error(`[${new Date().toISOString()}] github: failed to persist sync status for log ${logId}:`, err);
  });

  res.json({
    success: true,
    sync_status: status,
    remote_sha: remoteSha,
    base_sha: baseSha,
    local_changed: localChanged,
    last_pulled_at: row.last_pulled_at,
    last_pushed_at: row.last_pushed_at,
    remote_missing: remoteMissing,
    file_path: row.file_path,
    branch: row.branch,
  });
}));

/**
 * POST /api/github/link/:logId/pull
 * Body: { strategy: 'merge'|'overwrite_local'|'preview' }
 *
 *   - merge: 3-way merge using the stored base_sha as ancestor. 409 with
 *     conflict payload when both sides changed the same hunk.
 *   - overwrite_local: blow away local content with remote (no merge attempted).
 *   - preview: dry-run; return what merge would produce without writing.
 */
router.post('/github/link/:logId/pull', asyncHandler(async (req, res) => {
  const logId = Number(req.params.logId);
  if (!isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid logId' });
  }

  const strategy = String(req.body?.strategy || 'merge');
  if (!['merge', 'overwrite_local', 'preview'].includes(strategy)) {
    return res.status(400).json({ success: false, message: 'Invalid strategy' });
  }

  const row = await loadLinkAndLog(logId, req.user, true);
  if (!row) {
    return res.status(404).json({ success: false, message: 'No GitHub link for this document, or write access denied' });
  }

  const remote = await fetchRemoteFile(req.gh, row.repo_owner, row.repo_name, row.file_path, row.branch);
  if (!remote) {
    return res.status(404).json({ success: false, message: 'Remote file no longer exists at the linked path' });
  }

  const localMd = localMarkdown(row);

  if (strategy === 'overwrite_local') {
    const html = sanitizeHtml(await marked.parse(remote.content, { renderer: createImportRenderer() }));
    await c2_query(
      `UPDATE logs SET html_content = ?, markdown_content = ?, ydoc_state = NULL,
        updated_at = NOW(), updated_by = ? WHERE id = ?`,
      [html, remote.content, req.user.id, logId]
    );
    await c2_query(
      `UPDATE github_links SET file_sha = ?, base_sha = ?, last_pulled_at = NOW(),
        sync_status = 'clean' WHERE log_id = ?`,
      [remote.sha, remote.sha, logId]
    );
    broadcastToDoc(logId, { type: 'github-pulled', logId, by: req.user.id, newSha: remote.sha });
    return res.json({ success: true, strategy, new_base_sha: remote.sha });
  }

  // merge / preview both run diff3
  const baseMd = await fetchBlobBySha(req.gh, row.repo_owner, row.repo_name, row.base_sha);
  const merge = diff3Merge(localMd, baseMd, remote.content);

  if (merge.hasConflict) {
    return res.status(409).json({
      success: false,
      message: 'Local and remote both changed the same hunks',
      conflicts: merge.conflicts,
      merged_with_markers: merge.merged,
      base_sha: row.base_sha,
      remote_sha: remote.sha,
      ours: localMd,
      theirs: remote.content,
    });
  }

  if (strategy === 'preview') {
    return res.json({
      success: true,
      strategy: 'preview',
      merged_markdown: merge.merged,
      remote_sha: remote.sha,
    });
  }

  // strategy === 'merge' — write merged result locally
  const html = sanitizeHtml(await marked.parse(merge.merged, { renderer: createImportRenderer() }));
  await c2_query(
    `UPDATE logs SET html_content = ?, markdown_content = ?, ydoc_state = NULL,
      updated_at = NOW(), updated_by = ? WHERE id = ?`,
    [html, merge.merged, req.user.id, logId]
  );
  await c2_query(
    `UPDATE github_links SET file_sha = ?, base_sha = ?, last_pulled_at = NOW(),
      sync_status = 'clean' WHERE log_id = ?`,
    [remote.sha, remote.sha, logId]
  );
  broadcastToDoc(logId, { type: 'github-pulled', logId, by: req.user.id, newSha: remote.sha });
  res.json({ success: true, strategy: 'merge', new_base_sha: remote.sha, merged_markdown: merge.merged });
}));

/**
 * POST /api/github/link/:logId/push
 * Body: { commit_message, branch_strategy: 'direct'|'pr', pr_title?, pr_body? }
 *
 * Pushes the current local markdown to the linked file using base_sha as the
 * parent SHA. On 409 (remote moved), flips sync_status to 'diverged' and
 * returns the conflict to the client.
 */
router.post('/github/link/:logId/push', asyncHandler(async (req, res) => {
  const logId = Number(req.params.logId);
  if (!isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid logId' });
  }

  const { commit_message: commitMessage, branch_strategy: branchStrategy = 'direct', pr_title, pr_body } = req.body || {};
  if (!commitMessage || typeof commitMessage !== 'string') {
    return res.status(400).json({ success: false, message: 'commit_message is required' });
  }
  if (!['direct', 'pr'].includes(branchStrategy)) {
    return res.status(400).json({ success: false, message: 'branch_strategy must be "direct" or "pr"' });
  }
  if (branchStrategy === 'pr' && !pr_title) {
    return res.status(400).json({ success: false, message: 'pr_title is required when branch_strategy is "pr"' });
  }

  const row = await loadLinkAndLog(logId, req.user, true);
  if (!row) {
    return res.status(404).json({ success: false, message: 'No GitHub link for this document, or write access denied' });
  }

  const localMd = localMarkdown(row);
  if (!localMd) {
    return res.status(400).json({ success: false, message: 'Document is empty; nothing to push' });
  }

  let targetBranch = row.branch;
  let pushSha = row.base_sha || row.file_sha || null;

  // For PR strategy, create a fresh branch off the linked branch first.
  let prBranch = null;
  if (branchStrategy === 'pr') {
    const slug = (commitMessage || row.title || 'codex')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'codex';
    prBranch = `codex/${slug}-${Date.now().toString(36)}`;
    const refData = await req.gh(
      `/repos/${encodeURIComponent(row.repo_owner)}/${encodeURIComponent(row.repo_name)}/git/ref/heads/${encodeURIComponent(row.branch)}`
    );
    await req.gh(
      `/repos/${encodeURIComponent(row.repo_owner)}/${encodeURIComponent(row.repo_name)}/git/refs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${prBranch}`, sha: refData.object.sha }),
      }
    );
    targetBranch = prBranch;
    // Re-fetch the file SHA on the new branch (same content, same sha as the source)
    const remoteOnPrBranch = await fetchRemoteFile(req.gh, row.repo_owner, row.repo_name, row.file_path, prBranch);
    if (remoteOnPrBranch) pushSha = remoteOnPrBranch.sha;
  }

  // Push the file
  let pushResult;
  try {
    const payload = {
      message: commitMessage,
      content: Buffer.from(localMd, 'utf8').toString('base64'),
      branch: targetBranch,
    };
    if (pushSha) payload.sha = pushSha;
    pushResult = await req.gh(
      `/repos/${encodeURIComponent(row.repo_owner)}/${encodeURIComponent(row.repo_name)}/contents/${row.file_path}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
  } catch (err) {
    if (err.status === 409 || err.status === 422) {
      // Remote moved between status check and push — flip to diverged
      await c2_query(
        `UPDATE github_links SET sync_status = 'diverged' WHERE log_id = ?`,
        [logId]
      ).catch((dbErr) => {
        console.error(`[${new Date().toISOString()}] github: failed to mark log ${logId} diverged after 409/422 push:`, dbErr);
      });
      return res.status(409).json({
        success: false,
        message: 'Remote file moved while pushing; pull first to resolve',
        sync_status: 'diverged',
      });
    }
    throw err;
  }

  let prNumber = null;
  let prHtmlUrl = null;
  if (branchStrategy === 'pr') {
    const pr = await req.gh(
      `/repos/${encodeURIComponent(row.repo_owner)}/${encodeURIComponent(row.repo_name)}/pulls`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: pr_title, body: pr_body || '', head: prBranch, base: row.branch }),
      }
    );
    prNumber = pr.number;
    prHtmlUrl = pr.html_url;
  }

  const newSha = pushResult.content.sha;
  // For direct push: link's branch matches; advance both file_sha and base_sha.
  // For PR push: the source branch is unchanged on disk; only the PR branch carries the new sha.
  // We still advance base_sha to the new content sha so subsequent sync detects the user's edit as merged.
  if (branchStrategy === 'direct') {
    await c2_query(
      `UPDATE github_links SET file_sha = ?, base_sha = ?, last_pushed_at = NOW(),
        sync_status = 'clean' WHERE log_id = ?`,
      [newSha, newSha, logId]
    );
  } else {
    await c2_query(
      `UPDATE github_links SET base_sha = ?, last_pushed_at = NOW(), sync_status = 'clean' WHERE log_id = ?`,
      [newSha, logId]
    );
  }

  res.json({
    success: true,
    commit_sha: pushResult.commit.sha,
    blob_sha: newSha,
    pr_number: prNumber,
    pr_html_url: prHtmlUrl,
    branch_strategy: branchStrategy,
  });
}));

/**
 * POST /api/github/link/:logId/resolve
 * Body: { resolved_markdown, base_sha }
 *
 * Persists user-merged content locally after a manual conflict resolution.
 * The doc enters the 'local_ahead' state; the user must then click Push.
 */
router.post('/github/link/:logId/resolve', asyncHandler(async (req, res) => {
  const logId = Number(req.params.logId);
  if (!isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid logId' });
  }

  const { resolved_markdown, base_sha: clientBaseSha } = req.body || {};
  if (typeof resolved_markdown !== 'string') {
    return res.status(400).json({ success: false, message: 'resolved_markdown is required' });
  }

  const row = await loadLinkAndLog(logId, req.user, true);
  if (!row) {
    return res.status(404).json({ success: false, message: 'No GitHub link for this document, or write access denied' });
  }
  if (clientBaseSha && row.base_sha && clientBaseSha !== row.base_sha) {
    return res.status(409).json({
      success: false,
      message: 'Base advanced under you; refresh status and re-resolve',
    });
  }

  const html = sanitizeHtml(await marked.parse(resolved_markdown, { renderer: createImportRenderer() }));
  await c2_query(
    `UPDATE logs SET html_content = ?, markdown_content = ?, ydoc_state = NULL,
      updated_at = NOW(), updated_by = ? WHERE id = ?`,
    [html, resolved_markdown, req.user.id, logId]
  );
  // Local is now ahead: user resolved a conflict but hasn't pushed yet.
  await c2_query(
    `UPDATE github_links SET sync_status = 'local_ahead' WHERE log_id = ?`,
    [logId]
  );
  broadcastToDoc(logId, { type: 'github-pulled', logId, by: req.user.id, newSha: row.base_sha });

  res.json({ success: true, sync_status: 'local_ahead' });
}));

// ─── P1: Live code embed + Archive-as-repo ─────────────────────────

const EXT_TO_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
  cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql', json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  xml: 'xml', html: 'html', css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', mdx: 'markdown', rst: 'plaintext', txt: 'plaintext',
};

function languageForPath(path) {
  const ext = path.split('.').pop().toLowerCase();
  return EXT_TO_LANG[ext] || 'plaintext';
}

/**
 * Tiny LRU cache for embed responses. Keyed by user id so private-repo
 * content never leaks across users. Cap at 500 entries. No DB persistence.
 */
const EMBED_CACHE_MAX = 500;
const embedCache = new Map();
function embedCacheGet(key) {
  if (!embedCache.has(key)) return null;
  const v = embedCache.get(key);
  embedCache.delete(key);
  embedCache.set(key, v);
  return v;
}
function embedCacheSet(key, value) {
  if (embedCache.has(key)) embedCache.delete(key);
  else if (embedCache.size >= EMBED_CACHE_MAX) {
    embedCache.delete(embedCache.keys().next().value);
  }
  embedCache.set(key, value);
}

/**
 * GET /api/github/embed/code?owner=&repo=&path=&ref=&start=&end=
 * Returns the contents of a file (optionally sliced by line range) so the
 * Tiptap GitHubCodeEmbed node can render a live snippet.
 */
router.get('/github/embed/code', asyncHandler(async (req, res) => {
  const { owner, repo, path, ref = 'HEAD' } = req.query;
  const start = req.query.start ? Math.max(1, parseInt(req.query.start, 10)) : null;
  const end = req.query.end ? Math.max(1, parseInt(req.query.end, 10)) : null;

  if (!owner || !repo || !path) {
    return res.status(400).json({ success: false, message: 'owner, repo, and path are required' });
  }

  const cacheKey = `${req.user.id}:${owner}:${repo}:${ref}:${path}`;
  const cached = embedCacheGet(cacheKey);
  let payload;
  if (cached) {
    payload = cached;
  } else {
    const cleanPath = String(path).replace(/^\//, '');
    const data = await req.gh(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${cleanPath}?ref=${encodeURIComponent(ref)}`
    );
    if (data.type !== 'file') {
      return res.status(400).json({ success: false, message: 'Path does not point to a file' });
    }
    const fullContent = Buffer.from(data.content || '', 'base64').toString('utf-8');
    payload = {
      content: fullContent,
      sha: data.sha,
      html_url: data.html_url,
      language: languageForPath(cleanPath),
      total_lines: fullContent.split('\n').length,
    };
    embedCacheSet(cacheKey, payload);
  }

  // Slice to requested line range if present
  let content = payload.content;
  if (start !== null) {
    const lines = payload.content.split('\n');
    const lo = Math.max(0, start - 1);
    const hi = end !== null ? Math.min(payload.total_lines, end) : payload.total_lines;
    content = lines.slice(lo, hi).join('\n');
  }

  res.json({
    success: true,
    content,
    sha: payload.sha,
    html_url: payload.html_url,
    language: payload.language,
    total_lines: payload.total_lines,
    line_start: start,
    line_end: end,
  });
}));

/**
 * Walk a GitHub tree and return only Markdown blobs under a path prefix.
 * Used by bulk import / refresh.
 */
async function listMarkdownFilesUnder(reqGh, owner, repo, ref, prefix) {
  const tree = await reqGh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`
  );
  const trimmedPrefix = (prefix || '').replace(/^\/|\/$/g, '');
  return (tree.tree || [])
    .filter((it) => it.type === 'blob' && /\.(md|mdx|markdown)$/i.test(it.path))
    .filter((it) => !trimmedPrefix || it.path === trimmedPrefix || it.path.startsWith(`${trimmedPrefix}/`));
}

/**
 * Bulk-import handler shared by /import and /refresh. Already-linked files
 * are reported as skipped rather than re-imported, so /refresh is
 * functionally a no-op when the archive is fully in sync.
 */
async function bulkImportArchiveRepo(req, res) {
  const archiveId = Number(req.params.archiveId);
  const repoId = Number(req.params.repoId);
  if (!isValidId(archiveId) || !isValidId(repoId)) {
    return res.status(400).json({ success: false, message: 'Invalid id' });
  }

  const [archive] = await c2_query(
    `SELECT p.id, p.name FROM archives p
     WHERE p.id = ? AND ${writeAccessWhere('p')}
     LIMIT 1`,
    [archiveId, ...writeAccessParams(req.user)]
  );
  if (!archive) {
    return res.status(403).json({ success: false, message: 'Archive not found or write access denied' });
  }

  const [link] = await c2_query(
    `SELECT id, repo_owner, repo_name, default_branch, docs_path
     FROM archive_repos WHERE id = ? AND archive_id = ? LIMIT 1`,
    [repoId, archiveId]
  );
  if (!link) {
    return res.status(404).json({ success: false, message: 'Archive-repo link not found' });
  }

  const ref = link.default_branch || 'main';
  const files = await listMarkdownFilesUnder(req.gh, link.repo_owner, link.repo_name, ref, link.docs_path);

  const imported = [];
  const skipped = [];

  for (let i = 0; i < files.length; i += 50) {
    const chunk = files.slice(i, i + 50);
    for (const file of chunk) {
      const [existing] = await c2_query(
        `SELECT gl.log_id FROM github_links gl
         INNER JOIN logs l ON l.id = gl.log_id
         WHERE l.archive_id = ? AND gl.repo_owner = ? AND gl.repo_name = ?
           AND gl.file_path = ? AND gl.branch = ?
         LIMIT 1`,
        [archiveId, link.repo_owner, link.repo_name, file.path, ref]
      );
      if (existing) {
        skipped.push({ path: file.path, log_id: existing.log_id, reason: 'already_linked' });
        continue;
      }

      try {
        const fileData = await req.gh(
          `/repos/${encodeURIComponent(link.repo_owner)}/${encodeURIComponent(link.repo_name)}/contents/${file.path}?ref=${encodeURIComponent(ref)}`
        );
        if (fileData.type !== 'file') continue;

        const rawMd = Buffer.from(fileData.content || '', 'base64').toString('utf-8');
        const html = sanitizeHtml(await marked.parse(rawMd, { renderer: createImportRenderer() }));
        const title = file.path.split('/').pop().replace(/\.[^.]+$/, '') || file.path;

        const result = await c2_query(
          `INSERT INTO logs (archive_id, title, html_content, markdown_content, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [archiveId, title, html, rawMd, req.user.id, req.user.id]
        );
        await c2_query(
          `INSERT INTO github_links (log_id, repo_owner, repo_name, file_path, branch, file_sha, base_sha, last_pulled_at, sync_status, linked_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'clean', ?)`,
          [result.insertId, link.repo_owner, link.repo_name, file.path, ref, fileData.sha, fileData.sha, req.user.id]
        );
        imported.push({ path: file.path, log_id: result.insertId, title });
      } catch (err) {
        skipped.push({ path: file.path, reason: err.message || 'fetch_failed' });
      }
    }
    await new Promise((r) => setImmediate(r));
  }

  return res.json({ success: true, archive_id: archiveId, archive_name: archive.name, imported, skipped });
}

router.post('/github/archives/:archiveId/repos/:repoId/import', asyncHandler(bulkImportArchiveRepo));
router.post('/github/archives/:archiveId/repos/:repoId/refresh', asyncHandler(bulkImportArchiveRepo));

// ─── P2: PR-as-document + Doc<->Issue cross-linking ────────────────

const SYSTEM_ARCHIVE_NAME = '__c2_github_pr_sessions__';

/**
 * Find-or-create the global system archive that hosts virtual PR-session
 * logs. The archive carries `system=TRUE` and empty ACLs so it's invisible
 * to standard archive listings; per-user read access is injected on each
 * session open via JSON_ARRAY_APPEND on the log's read_access column.
 */
async function ensureSystemArchive() {
  const [existing] = await c2_query(
    'SELECT id FROM archives WHERE name = ? AND `system` = TRUE AND squad_id IS NULL LIMIT 1',
    [SYSTEM_ARCHIVE_NAME]
  );
  if (existing) return existing.id;
  const ins = await c2_query(
    'INSERT INTO archives (squad_id, name, `system`, created_by, ' +
    'read_access, write_access, read_access_squads, write_access_squads, ' +
    'read_access_workspace, write_access_workspace) ' +
    'VALUES (NULL, ?, TRUE, NULL, ' +
    'JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), ' +
    'FALSE, FALSE)',
    [SYSTEM_ARCHIVE_NAME]
  );
  return ins.insertId;
}

/**
 * Idempotently obtain the virtual log id for a PR session, creating the
 * archive + log + session row if needed. Always grants the calling user
 * read AND write access on the underlying log so the existing comment
 * routes and collab WS auth pass through unchanged.
 */
async function getOrCreatePrSession(user, owner, repo, prNumber) {
  const [existing] = await c2_query(
    `SELECT id, log_id FROM github_pr_sessions
     WHERE repo_owner = ? AND repo_name = ? AND pr_number = ?
     LIMIT 1`,
    [owner, repo, prNumber]
  );

  let logId;
  let sessionId;

  if (existing) {
    sessionId = existing.id;
    logId = existing.log_id;
  } else {
    const archiveId = await ensureSystemArchive();
    const logIns = await c2_query(
      `INSERT INTO logs (archive_id, title, html_content, created_by, updated_by, read_access, write_access)
       VALUES (?, ?, '', ?, ?, JSON_ARRAY(), JSON_ARRAY())`,
      [archiveId, `${owner}/${repo}#${prNumber}`, user.id, user.id]
    );
    logId = logIns.insertId;
    const sessIns = await c2_query(
      `INSERT INTO github_pr_sessions (log_id, repo_owner, repo_name, pr_number, opened_by)
       VALUES (?, ?, ?, ?, ?)`,
      [logId, owner, repo, prNumber, user.id]
    );
    sessionId = sessIns.insertId;
  }

  // Append user.id to read_access AND write_access if not already present.
  // Comments routes gate on the standard ACL, so this is what makes the
  // session viewable + commentable for the user.
  await c2_query(
    `UPDATE logs
       SET read_access = IF(JSON_CONTAINS(IFNULL(read_access, JSON_ARRAY()), CAST(? AS JSON)),
                            read_access,
                            JSON_ARRAY_APPEND(IFNULL(read_access, JSON_ARRAY()), '$', CAST(? AS JSON))),
           write_access = IF(JSON_CONTAINS(IFNULL(write_access, JSON_ARRAY()), CAST(? AS JSON)),
                             write_access,
                             JSON_ARRAY_APPEND(IFNULL(write_access, JSON_ARRAY()), '$', CAST(? AS JSON)))
     WHERE id = ?`,
    [String(user.id), String(user.id), String(user.id), String(user.id), logId]
  );

  return { sessionId, logId };
}

/**
 * GET /api/github/repos/:owner/:repo/pulls/:number/session
 * Returns the virtual log id for a PR. Idempotent: subsequent calls return
 * the same logId. The caller is granted read+write on the virtual log so
 * the standard /api/logs/:logId/comments routes work unchanged.
 */
router.get('/github/repos/:owner/:repo/pulls/:number/session', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const prNumber = Number(req.params.number);
  if (!isValidId(prNumber)) {
    return res.status(400).json({ success: false, message: 'Invalid PR number' });
  }
  const session = await getOrCreatePrSession(req.user, owner, repo, prNumber);
  res.json({ success: true, log_id: session.logId, session_id: session.sessionId });
}));

/**
 * GET /api/github/repos/:owner/:repo/pulls/:number/comments
 * List inline PR review comments straight from GitHub (no local mirror
 * read — Codex side-comments live in the comments table separately).
 */
router.get('/github/repos/:owner/:repo/pulls/:number/comments', asyncHandler(async (req, res) => {
  const { owner, repo, number } = req.params;
  const data = await req.gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(number)}/comments?per_page=100`
  );
  const comments = (data || []).map((c) => ({
    id: c.id,
    body: c.body,
    path: c.path,
    line: c.line ?? c.original_line ?? null,
    side: c.side || 'RIGHT',
    commit_id: c.commit_id,
    user: { login: c.user?.login, avatar_url: c.user?.avatar_url },
    created_at: c.created_at,
    updated_at: c.updated_at,
    html_url: c.html_url,
    in_reply_to_id: c.in_reply_to_id || null,
  }));
  res.json({ success: true, comments });
}));

/**
 * POST /api/github/repos/:owner/:repo/pulls/:number/comments
 * Post a PR file-line comment to GitHub on behalf of the user, then mirror
 * it into the comments table on the virtual PR-session log. Returns the
 * mirrored row's local id along with the GitHub external id.
 */
router.post('/github/repos/:owner/:repo/pulls/:number/comments', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const prNumber = Number(req.params.number);
  const { body, commit_id, path, line, side, in_reply_to } = req.body || {};
  if (!body) {
    return res.status(400).json({ success: false, message: 'body is required' });
  }
  if (!in_reply_to && (!commit_id || !path || !line)) {
    return res.status(400).json({ success: false, message: 'commit_id, path, and line are required for a new thread' });
  }

  const ghPayload = in_reply_to
    ? { body, in_reply_to: Number(in_reply_to) }
    : { body, commit_id, path, line: Number(line), side: side || 'RIGHT' };

  const ghRes = await req.gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(prNumber)}/comments`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ghPayload),
    }
  );

  // Mirror locally so the existing CommentSidebar shows it without a separate fetch path.
  const session = await getOrCreatePrSession(req.user, owner, repo, prNumber);
  const externalRef = `${owner}/${repo}#${prNumber}/${ghRes.path}:${ghRes.line ?? ghRes.original_line ?? line}`;
  const ins = await c2_query(
    `INSERT INTO comments (log_id, user_id, content, tag, status,
       external_kind, external_ref, external_id)
     VALUES (?, ?, ?, 'pr_review', 'open', 'pr_file_line', ?, ?)`,
    [session.logId, req.user.id, sanitizeHtml(body), externalRef, String(ghRes.id)]
  );

  res.status(201).json({
    success: true,
    comment_id: ins.insertId,
    external_id: String(ghRes.id),
    log_id: session.logId,
    html_url: ghRes.html_url,
  });
}));

/**
 * POST /api/github/repos/:owner/:repo/pulls/:number/reviews
 * Submit a PR review (approve / request_changes / comment) with optional
 * batched line comments. Pure proxy — does not mirror reviews into Codex.
 */
router.post('/github/repos/:owner/:repo/pulls/:number/reviews', asyncHandler(async (req, res) => {
  const { owner, repo, number } = req.params;
  const { event, body, comments } = req.body || {};
  const allowedEvents = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];
  if (event && !allowedEvents.includes(event)) {
    return res.status(400).json({ success: false, message: 'event must be APPROVE, REQUEST_CHANGES, or COMMENT' });
  }
  const data = await req.gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(number)}/reviews`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, body: body || '', comments: comments || [] }),
    }
  );
  res.status(201).json({ success: true, review: { id: data.id, state: data.state, html_url: data.html_url } });
}));

/**
 * GET /api/github/issues/search?q=...
 * Wraps the GitHub issue search API. Used by the issue picker.
 */
router.get('/github/issues/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 2) {
    return res.json({ success: true, issues: [] });
  }
  const data = await req.gh(
    `/search/issues?q=${encodeURIComponent(`${q} is:issue`)}&per_page=20`
  );
  const issues = (data.items || []).map((i) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    repository_url: i.repository_url,
    html_url: i.html_url,
    user: { login: i.user?.login, avatar_url: i.user?.avatar_url },
    labels: (i.labels || []).map((l) => l.name),
  }));
  res.json({ success: true, issues });
}));

/**
 * GET /api/github/repos/:owner/:repo/issues/:number
 * Fetch a single issue's title, state, body, assignees.
 */
router.get('/github/repos/:owner/:repo/issues/:number', asyncHandler(async (req, res) => {
  const { owner, repo, number } = req.params;
  const data = await req.gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(number)}`
  );
  res.json({
    success: true,
    issue: {
      number: data.number,
      title: data.title,
      body: data.body,
      state: data.state,
      html_url: data.html_url,
      user: { login: data.user?.login, avatar_url: data.user?.avatar_url },
      assignees: (data.assignees || []).map((a) => ({ login: a.login, avatar_url: a.avatar_url })),
      labels: (data.labels || []).map((l) => l.name),
      created_at: data.created_at,
      updated_at: data.updated_at,
      closed_at: data.closed_at,
    },
  });
}));

/**
 * POST /api/github/repos/:owner/:repo/issues
 * Create an issue. Body: { title, body?, labels[]?, assignees[]? }
 */
router.post('/github/repos/:owner/:repo/issues', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const { title, body, labels, assignees } = req.body || {};
  if (!title) {
    return res.status(400).json({ success: false, message: 'title is required' });
  }
  const payload = { title };
  if (body) payload.body = body;
  if (Array.isArray(labels)) payload.labels = labels;
  if (Array.isArray(assignees)) payload.assignees = assignees;

  const data = await req.gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  res.status(201).json({ success: true, issue: { number: data.number, html_url: data.html_url, title: data.title } });
}));

/**
 * GET /api/github/users/search?q=...
 * Autocomplete for the reviewer multi-select. Limited to 20 results.
 */
router.get('/github/users/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 1) {
    return res.json({ success: true, users: [] });
  }
  const data = await req.gh(
    `/search/users?q=${encodeURIComponent(q)}&per_page=20`
  );
  const users = (data.items || []).map((u) => ({
    login: u.login,
    avatar_url: u.avatar_url,
    html_url: u.html_url,
  }));
  res.json({ success: true, users });
}));

/**
 * GET /api/logs/by-github-ref?repo=owner/name&kind=pr&ref=123
 * Returns Codex logs that contain a github_embed_refs row matching the
 * supplied repo+kind+ref. Powers the "linked PRs/issues" sidebar.
 */
router.get('/logs/by-github-ref', requireAuth, asyncHandler(async (req, res) => {
  const repo = String(req.query.repo || '').trim();
  const kind = String(req.query.kind || '').trim();
  const ref = String(req.query.ref || '').trim();
  const validKinds = new Set(['code', 'issue', 'pr', 'file']);
  if (!repo.includes('/') || !validKinds.has(kind) || !ref) {
    return res.status(400).json({ success: false, message: 'repo (owner/name), kind, and ref are required' });
  }
  const [repoOwner, repoName] = repo.split('/');
  const rows = await c2_query(
    `SELECT DISTINCT l.id AS log_id, l.title, l.archive_id
     FROM github_embed_refs er
     INNER JOIN logs l ON l.id = er.log_id
     INNER JOIN archives p ON p.id = l.archive_id
     WHERE er.repo_owner = ? AND er.repo_name = ? AND er.embed_type = ? AND er.ref_value = ?
       AND ${readAccessWhere('p')}
     ORDER BY l.updated_at DESC
     LIMIT 50`,
    [repoOwner, repoName, kind, ref, ...readAccessParams(req.user)]
  );
  res.json({ success: true, logs: rows });
}));

// ─── P3: Actions/CI + Releases + Squad↔Team ────────────────────────

// Tiny TTL cache for hot-read CI/release status (60s).
const CI_CACHE_TTL_MS = 60 * 1000;
const CI_CACHE_MAX = 200;
const ciCache = new Map();
function ciCacheGet(key) {
  const entry = ciCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CI_CACHE_TTL_MS) {
    ciCache.delete(key);
    return null;
  }
  ciCache.delete(key);
  ciCache.set(key, entry);
  return entry.value;
}
function ciCacheSet(key, value) {
  if (ciCache.has(key)) ciCache.delete(key);
  else if (ciCache.size >= CI_CACHE_MAX) ciCache.delete(ciCache.keys().next().value);
  ciCache.set(key, { value, at: Date.now() });
}

/**
 * GET /api/github/repos/:owner/:repo/actions/runs?branch=
 * Returns the latest workflow runs for a branch — used by the CI badge
 * on the sync banner and PR list.
 */
router.get('/github/repos/:owner/:repo/actions/runs', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const branch = String(req.query.branch || '').trim();
  const cacheKey = `${req.user.id}:runs:${owner}/${repo}:${branch || '__all__'}`;
  const cached = ciCacheGet(cacheKey);
  if (cached) return res.json({ success: true, ...cached, cached: true });

  const params = new URLSearchParams({ per_page: '10' });
  if (branch) params.set('branch', branch);
  const data = await req.gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?${params}`
  );
  const runs = (data.workflow_runs || []).map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,            // queued, in_progress, completed
    conclusion: r.conclusion,    // success, failure, cancelled, skipped, neutral
    head_branch: r.head_branch,
    head_sha: r.head_sha,
    html_url: r.html_url,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  const payload = { runs, latest: runs[0] || null };
  ciCacheSet(cacheKey, payload);
  res.json({ success: true, ...payload, cached: false });
}));

/**
 * GET /api/github/repos/:owner/:repo/commits/:sha/check-runs
 * Per-commit checks (typed by the latest of each app). Used for finer-grained
 * status than workflow runs alone.
 */
router.get('/github/repos/:owner/:repo/commits/:sha/check-runs', asyncHandler(async (req, res) => {
  const { owner, repo, sha } = req.params;
  const cacheKey = `${req.user.id}:checks:${owner}/${repo}:${sha}`;
  const cached = ciCacheGet(cacheKey);
  if (cached) return res.json({ success: true, ...cached, cached: true });

  const data = await req.gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}/check-runs?per_page=50`
  );
  const checks = (data.check_runs || []).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    conclusion: c.conclusion,
    html_url: c.html_url,
    started_at: c.started_at,
    completed_at: c.completed_at,
  }));
  const payload = { checks, total: data.total_count || checks.length };
  ciCacheSet(cacheKey, payload);
  res.json({ success: true, ...payload, cached: false });
}));

/**
 * GET /api/github/repos/:owner/:repo/releases
 * List releases. Read-only proxy.
 */
router.get('/github/repos/:owner/:repo/releases', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const data = await req.gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=20`
  );
  const releases = (data || []).map((r) => ({
    id: r.id,
    tag_name: r.tag_name,
    name: r.name,
    body: r.body,
    draft: r.draft,
    prerelease: r.prerelease,
    html_url: r.html_url,
    published_at: r.published_at,
    author: { login: r.author?.login, avatar_url: r.author?.avatar_url },
  }));
  res.json({ success: true, releases });
}));

/**
 * POST /api/github/repos/:owner/:repo/releases
 * Create a release. Body: { tag_name, target_commitish?, name?, body?, draft?, prerelease? }
 */
router.post('/github/repos/:owner/:repo/releases', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const { tag_name, target_commitish, name, body, draft, prerelease } = req.body || {};
  if (!tag_name) {
    return res.status(400).json({ success: false, message: 'tag_name is required' });
  }
  const payload = { tag_name };
  if (target_commitish) payload.target_commitish = target_commitish;
  if (name) payload.name = name;
  if (body) payload.body = body;
  if (typeof draft === 'boolean') payload.draft = draft;
  if (typeof prerelease === 'boolean') payload.prerelease = prerelease;
  const data = await req.gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  res.status(201).json({
    success: true,
    release: { id: data.id, tag_name: data.tag_name, html_url: data.html_url },
  });
}));

/**
 * Helper: confirm the calling user can manage the squad. A workspace owner
 * or squad owner/admin (manage_members) is allowed.
 */
async function userCanManageSquad(user, squadId) {
  if (user.is_admin) return true;
  const [row] = await c2_query(
    `SELECT 1 FROM squads s
     LEFT JOIN workspaces w ON w.id = s.workspace_id
     LEFT JOIN squad_members sm ON sm.squad_id = s.id AND sm.user_id = ?
     WHERE s.id = ?
       AND (w.owner = ?
            OR sm.role = 'owner'
            OR (sm.role = 'admin' AND sm.can_manage_members = TRUE))
     LIMIT 1`,
    [user.id, Number(squadId), user.email]
  );
  return Boolean(row);
}

/**
 * GET /api/squads/:squadId/github-team/preview
 * Compares the bound GitHub Team's members against current squad members.
 * Shows what a sync would add, remove, or leave in place. Admin-only.
 */
router.get('/squads/:squadId/github-team/preview', requireAuth, asyncHandler(requireGitHub), asyncHandler(async (req, res) => {
  const squadId = Number(req.params.squadId);
  if (!isValidId(squadId)) {
    return res.status(400).json({ success: false, message: 'Invalid squad id' });
  }
  const allowed = await userCanManageSquad(req.user, squadId);
  if (!allowed) {
    return res.status(403).json({ success: false, message: 'Only workspace owners or squad admins can preview team sync' });
  }
  const [squad] = await c2_query(
    `SELECT github_org, github_team_slug FROM squads WHERE id = ? LIMIT 1`,
    [squadId]
  );
  if (!squad?.github_org || !squad?.github_team_slug) {
    return res.status(400).json({ success: false, message: 'Squad is not bound to a GitHub team' });
  }

  const ghMembers = await req.gh(
    `/orgs/${encodeURIComponent(squad.github_org)}/teams/${encodeURIComponent(squad.github_team_slug)}/members?per_page=100`
  );
  const ghLogins = new Set((ghMembers || []).map((m) => m.login.toLowerCase()));

  // Current squad members joined with GitHub identity (provider_username)
  const currentMembers = await c2_query(
    `SELECT sm.user_id, u.email, u.name AS user_name,
            oa.provider_username AS gh_login
     FROM squad_members sm
     INNER JOIN users u ON u.id = sm.user_id
     LEFT JOIN oauth_accounts oa ON oa.user_id = u.id AND oa.provider = 'github'
     WHERE sm.squad_id = ?`,
    [squadId]
  );

  const currentLogins = new Set();
  const toRemove = [];
  for (const m of currentMembers) {
    if (m.gh_login) {
      currentLogins.add(m.gh_login.toLowerCase());
      if (!ghLogins.has(m.gh_login.toLowerCase())) {
        toRemove.push({ user_id: m.user_id, gh_login: m.gh_login, email: m.email, name: m.user_name });
      }
    }
  }

  // GitHub members who aren't in the squad yet
  const toAdd = [];
  for (const ghLogin of ghLogins) {
    if (currentLogins.has(ghLogin)) continue;
    // Find a Codex user with this github username
    const [match] = await c2_query(
      `SELECT u.id, u.name, u.email FROM users u
       INNER JOIN oauth_accounts oa ON oa.user_id = u.id AND oa.provider = 'github'
       WHERE LOWER(oa.provider_username) = ?
       LIMIT 1`,
      [ghLogin]
    );
    if (match) {
      toAdd.push({ gh_login: ghLogin, user_id: match.id, name: match.name, email: match.email, can_link: true });
    } else {
      toAdd.push({ gh_login: ghLogin, user_id: null, name: null, email: null, can_link: false });
    }
  }

  res.json({
    success: true,
    org: squad.github_org,
    team_slug: squad.github_team_slug,
    to_add: toAdd,
    to_remove: toRemove,
  });
}));

/**
 * POST /api/squads/:squadId/github-team/sync
 * Apply the preview. Adds Codex users that exist for new GitHub members and
 * removes squad members whose GitHub identity is no longer on the team.
 * Members without a matching Codex user are skipped (returned in unmatched).
 */
router.post('/squads/:squadId/github-team/sync', requireAuth, asyncHandler(requireGitHub), asyncHandler(async (req, res) => {
  const squadId = Number(req.params.squadId);
  if (!isValidId(squadId)) {
    return res.status(400).json({ success: false, message: 'Invalid squad id' });
  }
  const allowed = await userCanManageSquad(req.user, squadId);
  if (!allowed) {
    return res.status(403).json({ success: false, message: 'Only workspace owners or squad admins can sync team membership' });
  }
  const [squad] = await c2_query(
    `SELECT github_org, github_team_slug FROM squads WHERE id = ? LIMIT 1`,
    [squadId]
  );
  if (!squad?.github_org || !squad?.github_team_slug) {
    return res.status(400).json({ success: false, message: 'Squad is not bound to a GitHub team' });
  }

  const ghMembers = await req.gh(
    `/orgs/${encodeURIComponent(squad.github_org)}/teams/${encodeURIComponent(squad.github_team_slug)}/members?per_page=100`
  );
  const ghLogins = new Set((ghMembers || []).map((m) => m.login.toLowerCase()));

  const currentMembers = await c2_query(
    `SELECT sm.user_id, oa.provider_username AS gh_login
     FROM squad_members sm
     LEFT JOIN oauth_accounts oa ON oa.user_id = sm.user_id AND oa.provider = 'github'
     WHERE sm.squad_id = ?`,
    [squadId]
  );

  const currentByLogin = new Map();
  for (const m of currentMembers) {
    if (m.gh_login) currentByLogin.set(m.gh_login.toLowerCase(), m.user_id);
  }

  const added = [];
  const removed = [];
  const unmatched = [];

  // Add new members
  for (const ghLogin of ghLogins) {
    if (currentByLogin.has(ghLogin)) continue;
    const [match] = await c2_query(
      `SELECT u.id FROM users u
       INNER JOIN oauth_accounts oa ON oa.user_id = u.id AND oa.provider = 'github'
       WHERE LOWER(oa.provider_username) = ?
       LIMIT 1`,
      [ghLogin]
    );
    if (!match) {
      unmatched.push(ghLogin);
      continue;
    }
    try {
      await c2_query(
        `INSERT INTO squad_members (squad_id, user_id, role, can_read, can_write)
         VALUES (?, ?, 'member', TRUE, FALSE)
         ON DUPLICATE KEY UPDATE can_read = TRUE`,
        [squadId, match.id]
      );
      added.push({ user_id: match.id, gh_login: ghLogin });
    } catch (err) {
      unmatched.push(`${ghLogin} (${err.message})`);
    }
  }

  // Remove members no longer on the team
  for (const [ghLogin, userId] of currentByLogin.entries()) {
    if (!ghLogins.has(ghLogin)) {
      // Don't remove squad owners — they might be the bootstrapping admin.
      const [row] = await c2_query(
        `SELECT role FROM squad_members WHERE squad_id = ? AND user_id = ? LIMIT 1`,
        [squadId, userId]
      );
      if (row?.role === 'owner') continue;
      await c2_query(
        `DELETE FROM squad_members WHERE squad_id = ? AND user_id = ?`,
        [squadId, userId]
      );
      removed.push({ user_id: userId, gh_login: ghLogin });
    }
  }

  await c2_query(
    `UPDATE squads SET team_sync_at = NOW() WHERE id = ?`,
    [squadId]
  );

  res.json({ success: true, added, removed, unmatched });
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

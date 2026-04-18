# API Reference — OAuth & GitHub Integration

---

## OAuth Providers

Cloud Codex supports two OAuth providers. Their availability depends on whether the relevant credentials are set in `.env`.

### `GET /api/oauth/providers`

Returns which OAuth providers are configured and available for login. This is a public endpoint — called by the login UI before rendering OAuth buttons.

**Response:** `{ success: true, providers: { google: true, github: false } }`

---

## Google SSO

Google OAuth is used for **login and automatic account creation**. If `GOOGLE_OAUTH_DOMAIN` is set (e.g. `yourcompany.com`), only users from that domain are accepted — enabling Google Workspace SSO for a specific organization.

### `GET /api/oauth/google/authorize`

Redirects the user to Google's OAuth consent screen. Generates a short-lived (10 min) CSRF state token stored in memory.

---

### `GET /api/oauth/google/callback`

OAuth callback from Google. Validates the `state` parameter, exchanges the auth code for tokens, and verifies the ID token.

**Account creation behavior:**

1. If a Google OAuth account is already linked → log in that user.
2. If no linked account but a user with the same email exists → link the Google account to the existing user.
3. If the domain matches `GOOGLE_OAUTH_DOMAIN` → auto-create a new account (no invitation required). Username is derived from the email local part.
4. Otherwise → return `403` (no invitation flow for Google SSO users outside the allowed domain).

On success, sets a `sessionToken` cookie and redirects to `/`.

---

### `GET /api/oauth/google/status` *(requires auth)*

Returns whether the current user has a Google account linked.

---

### `DELETE /api/oauth/google/disconnect` *(requires auth)*

Unlink the Google account. Only allowed if the user has a password set (to prevent account lockout).

---

## GitHub OAuth

GitHub OAuth is used for **linking a GitHub account** to enable the GitHub integration features (repo browsing, file editing, PR creation). It is not used for login.

GitHub access tokens are stored **encrypted** in the `oauth_accounts` table using AES-256-GCM. The encryption key is derived from `GITHUB_CLIENT_SECRET` via `scrypt`. Tokens are never returned to the client.

### `GET /api/oauth/github/authorize` *(requires auth)*

Redirects to GitHub's OAuth consent screen to link a GitHub account. Requests the `repo` scope.

---

### `GET /api/oauth/github/callback`

OAuth callback from GitHub. Exchanges the code for an access token, encrypts it, and stores it in `oauth_accounts`.

If the user already has a GitHub account linked, the token is updated (refreshed). On success, redirects to `/github`.

---

### `GET /api/oauth/github/status` *(requires auth)*

Returns whether the current user has a GitHub account linked, plus their GitHub username if connected.

---

### `DELETE /api/oauth/github/disconnect` *(requires auth)*

Unlink and delete the stored GitHub token.

---

## GitHub API Integration

These routes proxy GitHub API calls on behalf of the authenticated user using their stored encrypted access token. All routes require auth **and** a linked GitHub account (`requireGitHub` middleware).

---

### Repositories

#### `GET /api/github/repos`

List the user's GitHub repositories (owned + collaborator + org member).

**Query params:** `?page=1&per_page=30&sort=updated&q=searchterm`

When `q` is provided, uses the GitHub Search API.

**Response:** `{ success: true, repos: [{ id, name, full_name, description, private, default_branch, language, updated_at, html_url, owner: { login, avatar_url } }] }`

---

#### `GET /api/github/repos/:owner/:repo/branches`

List branches for a repository.

---

#### `GET /api/github/repos/:owner/:repo/tree`

List the file tree of a repository at a specific ref.

**Query params:** `?ref=main`

---

#### `GET /api/github/repos/:owner/:repo/file`

Fetch the raw content of a file.

**Query params:** `?path=docs/guide.md&ref=main`

Returns the decoded content and SHA. If the file is a Markdown file, the content is also parsed to HTML via `marked` for preview/import.

---

### File Editing & Pull Requests

#### `POST /api/github/repos/:owner/:repo/commit`

Commit a change to a file directly to a branch.

**Body:** `{ path, content, message, branch, sha }` — `sha` is required for existing files (prevents overwrite conflicts via GitHub's API).

---

#### `POST /api/github/repos/:owner/:repo/pulls`

Create a pull request.

**Body:** `{ title, body, head, base }`

---

#### `GET /api/github/repos/:owner/:repo/pulls`

List open pull requests.

---

### GitHub ↔ Document Links

These endpoints link a specific GitHub file to a Cloud Codex log for two-way sync workflows.

#### `POST /api/github/link`

Link a GitHub file to a document.

**Body:** `{ logId, repoOwner, repoName, filePath, branch }`

Requires write access to the document's archive.

---

#### `DELETE /api/github/link/:logId`

Remove the GitHub link from a document.

---

#### `POST /api/github/push/:logId`

Push the current document's Markdown to the linked GitHub file. Creates a commit on the configured branch.

Requires write access and a linked GitHub file.

---

#### `POST /api/github/pull/:logId`

Pull the linked GitHub file's current content into the document. Converts Markdown to HTML and saves.

Requires write access.

---

### Archive Repo Links

#### `POST /api/archives/:id/repos`

Link a GitHub repository to an archive (for contextual display). Requires archive ownership.

**Body:** `{ repoFullName }` (e.g. `"myorg/my-repo"`)

---

#### `DELETE /api/archives/:id/repos/:repoId`

Remove a linked repository from an archive.

---

#### `GET /api/archives/:id/repos`

List GitHub repos linked to an archive.

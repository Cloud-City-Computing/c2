```
─── ◆ ─────────────────────────────────────────────────────────────────────
   API · OAuth & GitHub Integration
─── ◆ ─────────────────────────────────────────────────────────────────────
```

# API Reference — OAuth & GitHub Integration

All routes mount under `/api`. Anything that touches the GitHub API requires
both `requireAuth` and an active GitHub OAuth link — these routes return
`401`/`403` if either is missing.

---

## OAuth Providers

### `GET /api/oauth/providers`

Returns which OAuth providers are configured. Public — called by the login
UI before rendering OAuth buttons.

**Response:** `{ success: true, providers: { google: true, github: false } }`

---

## Google SSO

Google OAuth is used for **login and automatic account creation**. If
`GOOGLE_OAUTH_DOMAIN` is set (e.g. `yourcompany.com`), only users from that
domain are accepted — enabling Google Workspace SSO for a specific
organization.

### `GET /api/oauth/google`

Redirects the user to Google's OAuth consent screen. Generates a short-lived
(10 min) CSRF state token stored in memory.

### `GET /api/oauth/google/callback`

OAuth callback. Validates the `state` parameter, exchanges the auth code
for tokens, verifies the ID token.

**Account creation behavior:**
1. If a Google OAuth account is already linked → log in that user.
2. If no linked account but a user with the same email exists → link to
   that user.
3. If the domain matches `GOOGLE_OAUTH_DOMAIN` → auto-create a new account
   (no invitation required). Username derived from the email local part.
4. Otherwise → `403` (no invitation flow for outside-domain users).

On success, sets a `sessionToken` cookie and redirects to `/`.

### `GET /api/oauth/status` *(requires auth)*

Returns whether the current user has Google linked.

### `POST /api/oauth/google/unlink` *(requires auth)*

Unlink Google. Only allowed if the user has a password set (lockout
prevention).

---

## GitHub OAuth

GitHub OAuth is used for **linking a GitHub account** to enable the GitHub
integration features. It is not used for login.

GitHub access tokens are stored **encrypted** in the `oauth_accounts` table
using AES-256-GCM. The encryption key is derived from `GITHUB_CLIENT_SECRET`
via `scrypt`. Tokens are never returned to the client.

### `GET /api/oauth/github` *(requires auth)*

Redirects to GitHub's OAuth consent screen to link a GitHub account.
Requests the `repo` scope.

### `GET /api/oauth/github/callback`

Exchanges the code for an access token, encrypts it, stores it. If the user
already has a GitHub link, the token is refreshed. Redirects to `/github`.

### `GET /api/github/status` *(requires auth)*

Returns whether the current user has GitHub linked + their GitHub username.

### `POST /api/oauth/github/unlink` *(requires auth)*

Unlinks and deletes the stored token.

---

## Repository browsing

All routes below require auth + active GitHub link.

### `GET /api/github/repos`

List the user's repositories (owned + collaborator + org member).

**Query params:** `?page=1&per_page=30&sort=updated&q=<search>`

When `q` is provided, uses the GitHub Search API.

### `GET /api/github/repos/:owner/:repo`

Repository metadata (default branch, description, stars, etc.).

### `GET /api/github/repos/:owner/:repo/branches`

List branches.

### `POST /api/github/repos/:owner/:repo/branches`

Create a branch from a ref.

**Body:** `{ name, fromRef }`

### `GET /api/github/repos/:owner/:repo/tree`

Recursive file tree at a ref.

**Query params:** `?ref=main`

---

## File contents

### `GET /api/github/repos/:owner/:repo/contents/:filePath`

Fetch a file's content. Returns the decoded content and SHA. Markdown files
are also parsed to HTML for preview/import.

### `PUT /api/github/repos/:owner/:repo/contents/:filePath`

Create or update a file.

**Body:** `{ content, message, branch, sha? }` — `sha` is required for
updates (GitHub's optimistic-concurrency check).

### `DELETE /api/github/repos/:owner/:repo/contents/:filePath`

Delete a file via the Contents API.

**Body:** `{ message, branch, sha }`

### `POST /api/github/repos/:owner/:repo/rename`

Rename a file (move within the same repo).

**Body:** `{ fromPath, toPath, branch, message }`

---

## Pull requests

### `GET /api/github/repos/:owner/:repo/pulls`

List pull requests.

**Query params:** `?state=open|closed|all`

### `POST /api/github/repos/:owner/:repo/pulls`

Create a pull request.

**Body:** `{ title, body, head, base }`

### `GET /api/github/repos/:owner/:repo/pulls/:number`

Single PR details.

### `GET /api/github/repos/:owner/:repo/pulls/:number/commits`

Commits in a PR.

### `GET /api/github/repos/:owner/:repo/pulls/:number/files`

Changed files in a PR.

### `GET /api/github/repos/:owner/:repo/pulls/:number/session`

Cloud Codex's PR-session record from `github_pr_sessions` (used by the
merge dialog UI to attach state across visits).

### `GET /api/github/repos/:owner/:repo/pulls/:number/comments`

PR review-thread comments.

### `POST /api/github/repos/:owner/:repo/pulls/:number/comments`

Post a PR review-thread comment.

**Body:** `{ body, path?, line?, side? }`

### `POST /api/github/repos/:owner/:repo/pulls/:number/reviews`

Submit a PR review.

**Body:** `{ event: 'APPROVE'|'REQUEST_CHANGES'|'COMMENT', body? }`

---

## Commits, search, CI

### `GET /api/github/repos/:owner/:repo/commits`

Recent commits on a branch.

**Query params:** `?ref=main&path=docs/`

### `GET /api/github/repos/:owner/:repo/commits/:sha`

Single commit details.

### `GET /api/github/repos/:owner/:repo/commits/:sha/check-runs`

CI / check-run status for a commit (powers the `CIStatusBadge`).

### `GET /api/github/repos/:owner/:repo/search`

Code search inside a repo. Wraps the GitHub Search API.

**Query params:** `?q=<expr>&page=1`

### `GET /api/github/repos/:owner/:repo/actions/runs`

Recent Actions runs for the repo.

### `GET /api/github/repos/:owner/:repo/releases`

List releases.

### `POST /api/github/repos/:owner/:repo/releases`

Create a release.

**Body:** `{ tag_name, name, body, draft?, prerelease? }`

---

## Issues & user search

### `GET /api/github/issues/search`

Cross-repo issue search.

**Query params:** `?q=<expr>`

### `GET /api/github/repos/:owner/:repo/issues/:number`

Single issue details.

### `POST /api/github/repos/:owner/:repo/issues`

Create an issue.

**Body:** `{ title, body, labels?, assignees? }`

### `GET /api/github/users/search`

Search GitHub users (powers `@`-mention pickers in PR reviews).

**Query params:** `?q=<expr>`

---

## Document ↔ GitHub-file linking

These routes link a single document to a GitHub file for two-way sync.

### `GET /api/github/link/:logId`

Link metadata for a document, or `null` if unlinked.

### `PUT /api/github/link/:logId`

Create or replace the link.

**Body:** `{ repoOwner, repoName, filePath, branch }`

### `DELETE /api/github/link/:logId`

Remove the link.

### `GET /api/github/link/:logId/status`

Live sync state: `clean | remote_ahead | local_ahead | diverged | conflict`,
plus the last pull/push timestamps.

### `POST /api/github/link/:logId/pull`

Pull the linked file's current content into the document. Markdown is
converted to sanitized HTML.

### `POST /api/github/link/:logId/push`

Push the document's current Markdown to the linked file. Creates a commit
on the link's configured branch.

### `POST /api/github/link/:logId/resolve`

Mark a `conflict` state resolved after a manual merge.

### `GET /api/logs/by-github-ref`

Reverse lookup: given a GitHub `repoOwner/repoName/path`, find the linked
log (if any) the current user can see.

---

## Embeds

### `GET /api/github/embed/code`

Resolve an embedded code snippet to current content (used by the
`GitHubCodeEmbed` Tiptap extension).

**Query params:** `?repo_owner=&repo_name=&ref=&branch=&path=&from=&to=`

---

## Archive ↔ Repository linking

Archives have their own bulk-import workflow tied to a repo `docs/` tree.

### `POST /api/github/archives/:archiveId/repos/:repoId/import`

Bulk-imports all supported files from the linked repo path as logs.
Preserves folder structure as the log tree. Each imported log is linked
back to its source file.

### `POST /api/github/archives/:archiveId/repos/:repoId/refresh`

Re-runs the import; new files become new logs, existing linked files are
left alone.

### `POST /api/github/import-to-codex`

One-shot single-file import — creates a fresh log from a GitHub file with
the link pre-populated.

**Body:** `{ archiveId, repoOwner, repoName, filePath, branch }`

---

## Squad ↔ GitHub team sync

### `GET /api/squads/:squadId/github-team/preview` *(requires auth + GitHub)*

Preview the membership of a GitHub team without applying changes.

### `POST /api/squads/:squadId/github-team/sync` *(requires auth + GitHub)*

Sync squad membership against a GitHub team's members.

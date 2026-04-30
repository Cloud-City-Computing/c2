```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   DATABASE                                                                 ║
║   MySQL 8 schema — 25 tables modelling the workspace → log hierarchy.      ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Database

Cloud Codex uses **MySQL 8** running inside Docker. The schema is initialized
via [`init.sql`](../init.sql), with incremental upgrades for live deployments
in [`migrations/`](../migrations/). Optional seed data is in
[`seed.sql`](../seed.sql).

## Connection

```bash
docker compose up -d
mysql -h 127.0.0.1 -P 3306 -u <DB_USER> -p <DB_NAME>
```

See `.env.example` for the required environment variables (`DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`).

---

## Schema Overview

The database models a **workspace → squad → archive → log** hierarchy with layered access control at every level.

```
   workspaces
     └── squads
           ├── squad_permissions
           ├── squad_members
           ├── squad_invitations
           └── archives
                 ├── archive_repos          (GitHub bulk-import link)
                 └── logs
                       ├── versions
                       ├── comments
                       │     └── comment_replies
                       ├── github_links     (per-doc file sync)
                       ├── github_embed_refs
                       ├── github_pr_sessions
                       └── favorites

   users  ──< sessions / oauth_accounts / permissions
          ──< user_invitations / password_reset_tokens / two_factor_codes
          ──< notifications  ──┐
          ──< watches  ────────┤  fan-out paths from
                               └─ activity_log
```

---

## Tables

### `workspaces`

Top-level organizational container, owned by a single user (by email). Workspaces can only be created by admins.

| Column       | Type                    | Notes                              |
|--------------|-------------------------|------------------------------------|
| `id`         | INT AUTO_INCREMENT PK   |                                    |
| `name`       | TEXT NOT NULL           | Display name                       |
| `owner`      | TEXT NOT NULL           | Email address of the owner user    |
| `created_at` | TIMESTAMP               | Defaults to current timestamp      |

**Relationships:** Has many `squads`.

---

### `users`

Registered user accounts. User creation is invite-only (see `user_invitations`).

| Column               | Type                                 | Notes                                        |
|----------------------|--------------------------------------|----------------------------------------------|
| `id`                 | INT AUTO_INCREMENT PK                |                                              |
| `name`               | VARCHAR(32) UNIQUE NOT NULL          | Username; alphanumeric + underscores only    |
| `email`              | VARCHAR(255) UNIQUE NOT NULL         |                                              |
| `password_hash`      | TEXT                                 | bcrypt hash; NULL for OAuth-only accounts    |
| `avatar_url`         | VARCHAR(512)                         | Relative path to uploaded avatar             |
| `two_factor_method`  | ENUM('none', 'email', 'totp')        | Defaults to `'none'`                         |
| `totp_secret`        | VARCHAR(64)                          | TOTP shared secret (only set when TOTP is enabled) |
| `is_admin`           | BOOLEAN                              | Super-admin flag; synced from `.env` on startup |
| `notification_prefs` | JSON                                 | Per-type email opt-in/out (NULL = use defaults from `services/notifications.js`) |
| `created_at`         | TIMESTAMP                            |                                              |

**Relationships:** Has many `sessions`, `oauth_accounts`, `permissions`, `squad_members`, `notifications`, `watches`.

---

### `oauth_accounts`

Links a Cloud Codex user to an external OAuth provider (Google or GitHub).

| Column              | Type                          | Notes                                              |
|---------------------|-------------------------------|----------------------------------------------------|
| `id`                | INT AUTO_INCREMENT PK         |                                                    |
| `user_id`           | INT FK → users                | ON DELETE CASCADE                                  |
| `provider`          | ENUM('google', 'github')      |                                                    |
| `provider_user_id`  | VARCHAR(255)                  | ID from the OAuth provider                        |
| `provider_email`    | VARCHAR(255)                  | Email returned by the provider                    |
| `encrypted_token`   | TEXT                          | AES-256-GCM encrypted access token (GitHub only)  |
| `created_at`        | TIMESTAMP                     |                                                    |

**Unique constraint:** `(provider, provider_user_id)` — one provider account per user.

---

### `sessions`

Active login sessions. Tokens are 64-character cryptographically random strings.

| Column           | Type            | Notes                                  |
|------------------|-----------------|----------------------------------------|
| `id`             | CHAR(64) PK     | The session token itself               |
| `user_id`        | INT FK → users  | ON DELETE CASCADE                      |
| `ip_address`     | VARCHAR(45)     | IPv4 or IPv6                           |
| `user_agent`     | TEXT            |                                        |
| `created_at`     | TIMESTAMP       |                                        |
| `last_active_at` | TIMESTAMP       | Updated on each authenticated request |
| `expires_at`     | TIMESTAMP       | 7-day rolling expiry                   |

**Indexes:** `user_id`, `expires_at`.

> A user has at most one active session. On re-login, the existing session is refreshed in place. Expired sessions are renewed (new token generated, same row updated).

---

### `password_reset_tokens`

Single-use tokens sent by email for password resets.

| Column       | Type            | Notes                              |
|--------------|-----------------|------------------------------------|
| `id`         | INT AUTO_INCREMENT PK |                              |
| `user_id`    | INT FK → users  | ON DELETE CASCADE                  |
| `token`      | CHAR(64) UNIQUE | Cryptographically random           |
| `expires_at` | TIMESTAMP       | Typically 1 hour                   |
| `used`       | BOOLEAN         | Marked TRUE once consumed          |
| `created_at` | TIMESTAMP       |                                    |

---

### `two_factor_codes`

Short-lived 6-digit codes sent by email for the email-based 2FA flow.

| Column       | Type            | Notes                              |
|--------------|-----------------|------------------------------------|
| `id`         | INT AUTO_INCREMENT PK |                              |
| `user_id`    | INT FK → users  | ON DELETE CASCADE                  |
| `code`       | CHAR(6)         | Numeric OTP                        |
| `expires_at` | TIMESTAMP       | Short window (e.g. 10 min)         |
| `used`       | BOOLEAN         | Marked TRUE once verified          |
| `created_at` | TIMESTAMP       |                                    |

---

### `user_invitations`

Admin-issued email invitations required for new account creation.

| Column       | Type                    | Notes                                             |
|--------------|-------------------------|---------------------------------------------------|
| `id`         | INT AUTO_INCREMENT PK   |                                                   |
| `email`      | VARCHAR(255)            | Target email; must match at signup                |
| `token`      | CHAR(64) UNIQUE         | Included in the invitation link                   |
| `invited_by` | INT FK → users          | ON DELETE CASCADE                                 |
| `expires_at` | TIMESTAMP               | 7-day expiry                                      |
| `accepted`   | BOOLEAN                 | Marked TRUE when account is created               |
| `created_at` | TIMESTAMP               |                                                   |

---

### `squads`

A team or group within a workspace. Squads own archives.

| Column         | Type                    | Notes                           |
|----------------|-------------------------|---------------------------------|
| `id`           | INT AUTO_INCREMENT PK   |                                 |
| `workspace_id` | INT FK → workspaces     | ON DELETE CASCADE               |
| `name`         | TEXT NOT NULL           |                                 |
| `created_at`   | TIMESTAMP               |                                 |
| `created_by`   | INT FK → users          | ON DELETE SET NULL              |

**Relationships:** Has many `squad_members`, `archives`, and one `squad_permissions` row.

---

### `permissions`

Global per-user permissions for top-level actions. One row per user.

| Column            | Type            | Notes                                         |
|-------------------|-----------------|-----------------------------------------------|
| `id`              | INT AUTO_INCREMENT PK |                                         |
| `user_id`         | INT FK → users  | ON DELETE CASCADE                             |
| `create_squad`    | BOOLEAN         | Can create squads in any workspace            |
| `create_archive`  | BOOLEAN         | Can create archives in any squad              |
| `create_log`      | BOOLEAN         | Defaults to TRUE — can create documents       |

> Admins bypass all permission checks. Workspace owners also bypass permission checks within their workspace.

---

### `squad_permissions`

Per-squad default permissions for members. One row per squad.

| Column            | Type            | Notes                                    |
|-------------------|-----------------|------------------------------------------|
| `id`              | INT AUTO_INCREMENT PK |                                    |
| `squad_id`        | INT FK → squads | ON DELETE CASCADE; UNIQUE               |
| `create_archive`  | BOOLEAN         | Default for this squad's members         |
| `create_log`      | BOOLEAN         | Defaults to TRUE                         |

---

### `squad_members`

Member roster for a squad with granular per-member permission flags.

| Column                | Type                                  | Notes                                |
|-----------------------|---------------------------------------|--------------------------------------|
| `id`                  | INT AUTO_INCREMENT PK                 |                                      |
| `squad_id`            | INT FK → squads                       | ON DELETE CASCADE                    |
| `user_id`             | INT FK → users                        | ON DELETE CASCADE                    |
| `role`                | ENUM('member', 'admin', 'owner')      | `owner` has implicit full access     |
| `can_read`            | BOOLEAN                               | Can view archives                    |
| `can_write`           | BOOLEAN                               | Can edit documents                   |
| `can_create_log`      | BOOLEAN                               | Can create new documents             |
| `can_create_archive`  | BOOLEAN                               | Can create new archives              |
| `can_manage_members`  | BOOLEAN                               | Can invite/remove squad members      |
| `can_delete_version`  | BOOLEAN                               | Can delete published versions        |
| `can_publish`         | BOOLEAN                               | Can publish new versions             |
| `joined_at`           | TIMESTAMP                             |                                      |

**Unique constraint:** `(squad_id, user_id)`.

---

### `squad_invitations`

Pending/historical invitations to join a squad. Mirrors the permission flags of `squad_members`.

| Column              | Type                                        | Notes                  |
|---------------------|---------------------------------------------|------------------------|
| `id`                | INT AUTO_INCREMENT PK                       |                        |
| `squad_id`          | INT FK → squads                             | ON DELETE CASCADE      |
| `invited_by`        | INT FK → users                              | ON DELETE CASCADE      |
| `invited_user_id`   | INT FK → users                              | ON DELETE CASCADE      |
| `role`              | ENUM('member', 'admin', 'owner')            |                        |
| `can_read` … `can_publish` | BOOLEAN columns (same as squad_members) |               |
| `status`            | ENUM('pending', 'accepted', 'declined')     | Defaults to `'pending'`|
| `created_at`        | TIMESTAMP                                   |                        |
| `responded_at`      | TIMESTAMP NULL                              | Set when user responds |

**Unique constraint:** `(squad_id, invited_user_id, status)` — prevents duplicate pending invites.

---

### `archives`

A collection of related documents. Archives are the primary organizational unit for content, belonging to a squad.

| Column                   | Type              | Notes                                                           |
|--------------------------|-------------------|-----------------------------------------------------------------|
| `id`                     | INT AUTO_INCREMENT PK |                                                             |
| `squad_id`               | INT FK → squads   | ON DELETE SET NULL; NULL for personal/standalone archives       |
| `name`                   | TEXT NOT NULL     |                                                                 |
| `created_at`             | TIMESTAMP         |                                                                 |
| `created_by`             | INT FK → users    | ON DELETE SET NULL                                              |
| `read_access`            | JSON ARRAY        | User IDs who can read                                           |
| `write_access`           | JSON ARRAY        | User IDs who can write                                          |
| `read_access_squads`     | JSON ARRAY        | Squad IDs whose members inherit read access                     |
| `write_access_squads`    | JSON ARRAY        | Squad IDs whose members inherit write access                    |
| `read_access_workspace`  | BOOLEAN           | If TRUE, all members of the parent workspace can read           |
| `write_access_workspace` | BOOLEAN           | If TRUE, all members of the parent workspace can write          |

> Access is layered: direct user grants → squad membership grants → workspace-wide flag. Archive creators and squad/workspace owners always have full access regardless of the JSON arrays. See [Access Control](./access-control.md) for full details.

---

### `archive_repos`

Links a GitHub repository to an archive for the GitHub integration feature.

| Column          | Type               | Notes                           |
|-----------------|--------------------|---------------------------------|
| `id`            | INT AUTO_INCREMENT PK |                              |
| `archive_id`    | INT FK → archives  | ON DELETE CASCADE               |
| `repo_full_name`| VARCHAR(255)       | e.g. `owner/repo-name`          |
| `repo_owner`    | VARCHAR(255)       |                                 |
| `repo_name`     | VARCHAR(255)       |                                 |
| `linked_by`     | INT FK → users     | ON DELETE CASCADE               |
| `linked_at`     | TIMESTAMP          |                                 |

**Unique constraint:** `(archive_id, repo_full_name)`.

---

### `logs`

An individual document (referred to as a "log" in the data model). This is the core content entity.

| Column              | Type                | Notes                                                                 |
|---------------------|---------------------|-----------------------------------------------------------------------|
| `id`                | INT AUTO_INCREMENT PK |                                                                     |
| `archive_id`        | INT FK → archives   | ON DELETE CASCADE                                                     |
| `title`             | TEXT NOT NULL       |                                                                       |
| `html_content`      | TEXT                | Rendered HTML from the editor; sanitized before storage               |
| `markdown_content`  | MEDIUMTEXT          | Optional markdown source; NULL when rich text is the canonical format |
| `ydoc_state`        | LONGBLOB            | Binary Yjs CRDT state for real-time collaboration                     |
| `plain_content`     | TEXT (GENERATED)    | Strips HTML tags from `html_content`; stored for full-text search     |
| `parent_id`         | INT FK → logs       | ON DELETE SET NULL; used to nest logs into a tree                     |
| `created_at`        | TIMESTAMP           |                                                                       |
| `created_by`        | INT FK → users      | ON DELETE SET NULL                                                    |
| `updated_at`        | TIMESTAMP           | Auto-updated on every change                                          |
| `updated_by`        | INT FK → users      | ON DELETE SET NULL                                                    |
| `version`           | INT DEFAULT 0       | Incremented each time a version is published                          |
| `read_access`       | JSON ARRAY          | Per-log read grants (user IDs); supplemental to archive-level access  |
| `write_access`      | JSON ARRAY          | Per-log write grants                                                  |

**Full-text index:** `FULLTEXT (title, plain_content)` — used by the search API for fast, relevance-ranked queries.

> `ydoc_state` is written by the collaborative editing service every few seconds while a document is being actively edited. `html_content` is written on explicit save or publish events.

---

### `github_links`

Links a specific GitHub file to a log, enabling live file sync. One link per log.

| Column        | Type               | Notes                                          |
|---------------|--------------------|------------------------------------------------|
| `id`          | INT AUTO_INCREMENT PK |                                             |
| `log_id`      | INT FK → logs      | ON DELETE CASCADE; UNIQUE (one link per log)   |
| `repo_owner`  | VARCHAR(255)       |                                                |
| `repo_name`   | VARCHAR(255)       |                                                |
| `file_path`   | VARCHAR(500)       | Path within the repo (e.g. `docs/guide.md`)   |
| `branch`      | VARCHAR(255)       |                                                |
| `file_sha`    | VARCHAR(64)        | Last known SHA from GitHub; used for edit checks |
| `linked_by`   | INT FK → users     | ON DELETE CASCADE                              |
| `linked_at`   | TIMESTAMP          |                                                |
| `updated_at`  | TIMESTAMP          |                                                |

---

### `versions`

Published version snapshots of a document's HTML content.

| Column         | Type               | Notes                                           |
|----------------|--------------------|-------------------------------------------------|
| `id`           | INT AUTO_INCREMENT PK |                                              |
| `log_id`       | INT FK → logs      | ON DELETE CASCADE                               |
| `version`      | INT NOT NULL       | Monotonically increasing version number         |
| `title`        | VARCHAR(255)       | Optional human-readable version label           |
| `notes`        | TEXT               | Optional release notes (up to 5000 chars)       |
| `html_content` | TEXT               | Snapshot of document HTML at publish time       |
| `created_at`   | TIMESTAMP          |                                                 |
| `created_by`   | INT FK → users     | ON DELETE SET NULL                              |
| `read_access`  | JSON ARRAY         | Future use; currently mirrors the parent log    |

---

### `comments`

Threaded annotations on a document, optionally anchored to a text selection.

| Column           | Type                                                    | Notes                                |
|------------------|---------------------------------------------------------|--------------------------------------|
| `id`             | INT AUTO_INCREMENT PK                                   |                                      |
| `log_id`         | INT FK → logs                                           | ON DELETE CASCADE                    |
| `user_id`        | INT FK → users                                          | ON DELETE CASCADE                    |
| `content`        | TEXT NOT NULL                                           | Up to 10,000 characters              |
| `tag`            | ENUM('comment', 'suggestion', 'question', 'issue', 'note') | Defaults to `'comment'`           |
| `status`         | ENUM('open', 'resolved', 'dismissed')                   | Defaults to `'open'`                 |
| `selection_start`| INT                                                     | Character offset anchor start        |
| `selection_end`  | INT                                                     | Character offset anchor end          |
| `selected_text`  | TEXT                                                    | Copy of the selected text (up to 500 chars) |
| `resolved_by`    | INT FK → users                                          | ON DELETE SET NULL                   |
| `resolved_at`    | TIMESTAMP NULL                                          |                                      |
| `created_at`     | TIMESTAMP                                               |                                      |
| `updated_at`     | TIMESTAMP                                               |                                      |

**Indexes:** `(log_id)`, `(log_id, status)`.

---

### `comment_replies`

Replies to a top-level comment. One level of nesting only.

| Column       | Type               | Notes                        |
|--------------|--------------------|------------------------------|
| `id`         | INT AUTO_INCREMENT PK |                           |
| `comment_id` | INT FK → comments  | ON DELETE CASCADE            |
| `user_id`    | INT FK → users     | ON DELETE CASCADE            |
| `content`    | TEXT NOT NULL       |                              |
| `created_at` | TIMESTAMP           |                              |
| `updated_at` | TIMESTAMP           |                              |

**Index:** `(comment_id)`.

---

### `favorites`

Per-user bookmark list for quick access to logs.

| Column       | Type              | Notes                        |
|--------------|-------------------|------------------------------|
| `id`         | INT AUTO_INCREMENT PK |                          |
| `user_id`    | INT FK → users    | ON DELETE CASCADE            |
| `log_id`     | INT FK → logs     | ON DELETE CASCADE            |
| `created_at` | TIMESTAMP         |                              |

**Unique constraint:** `(user_id, log_id)`.

---

### `notifications`

Inbox entries surfaced to a single user. Created by
`services/notifications.js` for every user-facing alert (mention, comment on
my doc, watched-doc activity, squad invite). Self-suppressed and coalesced
within a 60-second window per (user, type, resource).

| Column          | Type                  | Notes                                              |
|-----------------|-----------------------|----------------------------------------------------|
| `id`            | INT AUTO_INCREMENT PK |                                                    |
| `user_id`       | INT FK → users        | ON DELETE CASCADE; recipient                       |
| `type`          | VARCHAR(50)           | e.g. `mention`, `comment_on_my_doc`, `watched_publish` |
| `actor_id`      | INT FK → users        | ON DELETE SET NULL; who caused it (NULL for system)|
| `title`         | VARCHAR(255)          | Sanitized + plain-text                             |
| `body`          | TEXT                  | Sanitized; up to 2000 chars                        |
| `link_url`      | VARCHAR(512)          | Where clicking the notification goes               |
| `resource_type` | VARCHAR(30)           | e.g. `log`, `comment`, `version`, `squad`          |
| `resource_id`   | INT                   | Used for the coalesce key                          |
| `metadata`      | JSON                  | Free-form per-type detail                          |
| `read_at`       | TIMESTAMP NULL        | NULL until marked read                             |
| `created_at`    | TIMESTAMP             |                                                    |

**Indexes:** `(user_id, created_at)`, `(user_id, read_at, created_at)`,
`(resource_type, resource_id)`.

---

### `watches`

Subscription rows linking a user to a log or archive. Activity events on a
watched resource fan out to per-user `notifications` rows. Created manually
from the document UI or automatically (e.g. when a user is mentioned).

| Column          | Type                  | Notes                                  |
|-----------------|-----------------------|----------------------------------------|
| `id`            | INT AUTO_INCREMENT PK |                                        |
| `user_id`       | INT FK → users        | ON DELETE CASCADE                      |
| `resource_type` | VARCHAR(30)           | `'log'` or `'archive'`                 |
| `resource_id`   | INT                   |                                        |
| `source`        | VARCHAR(20)           | `'manual'` or `'auto'` (e.g. `'mention'`) |
| `created_at`    | TIMESTAMP             |                                        |

**Unique constraint:** `(user_id, resource_type, resource_id)` — one row
per (user, resource).
**Index:** `(resource_type, resource_id)` — fast fan-out lookups.

---

### `activity_log`

Workspace-scoped chronological feed of meaningful events: documents
created/published/restored, comments added/resolved, archive grants
changed, squad memberships moved. Read access is filtered at query time
via `routes/helpers/ownership.js`. Auto-pruned daily by `server.js` —
entries older than 365 days are removed.

| Column          | Type                  | Notes                                       |
|-----------------|-----------------------|---------------------------------------------|
| `id`            | BIGINT AUTO_INCREMENT PK |                                          |
| `workspace_id`  | INT                   | Always present                              |
| `squad_id`      | INT                   | Optional                                    |
| `user_id`       | INT FK → users        | ON DELETE CASCADE; actor                    |
| `action`        | VARCHAR(50)           | e.g. `log.published`, `comment.resolved`    |
| `resource_type` | VARCHAR(30)           | `log`, `archive`, `comment`, `version`, `squad` |
| `resource_id`   | INT                   |                                             |
| `metadata`      | JSON                  | Free-form per-action detail                 |
| `created_at`    | TIMESTAMP             |                                             |

**Indexes:** `(workspace_id, created_at)`, `(squad_id, created_at)`,
`(resource_type, resource_id, created_at)`, `(user_id, created_at)`.

---

### `github_embed_refs`

Tracks every GitHub embed (code snippet, issue, pull request, file) that
appears inside a log. Each row stores a pinned `ref_value` (and pinned SHA
where applicable) so the embed remains stable even if the source moves.

| Column         | Type                    | Notes                                      |
|----------------|-------------------------|--------------------------------------------|
| `id`           | INT AUTO_INCREMENT PK   |                                            |
| `log_id`       | INT FK → logs           | ON DELETE CASCADE                          |
| `embed_type`   | ENUM('code','issue','pr','file') |                                   |
| `repo_owner`   | VARCHAR(255)            |                                            |
| `repo_name`    | VARCHAR(255)            |                                            |
| `ref_value`    | VARCHAR(500)            | File path / issue number / PR number / SHA |
| `pinned_sha`   | VARCHAR(64)             | Optional commit SHA the embed is pinned to |
| `branch`       | VARCHAR(255)            | Branch the embed was captured from         |
| `last_seen_at` | TIMESTAMP NULL          | Updated when the embed is rendered         |
| `created_at`   | TIMESTAMP               |                                            |

**Indexes:** `(log_id)`, `(repo_owner, repo_name, embed_type)`.

---

### `github_pr_sessions`

A long-lived session per GitHub PR that the team is collaborating on
through Cloud Codex. Backs the `GitHubMergeDialog` UI and links PR-side
conversation back to any documents tied to the changed files.

| Column        | Type                  | Notes                                |
|---------------|-----------------------|--------------------------------------|
| `id`          | INT AUTO_INCREMENT PK |                                      |
| `log_id`      | INT FK → logs         | ON DELETE CASCADE                    |
| `repo_owner`  | VARCHAR(255)          |                                      |
| `repo_name`   | VARCHAR(255)          |                                      |
| `pr_number`   | INT                   |                                      |
| `opened_by`   | INT FK → users        | ON DELETE CASCADE                    |
| `opened_at`   | TIMESTAMP             |                                      |

**Unique constraint:** `(repo_owner, repo_name, pr_number)`.
**Index:** `(log_id)`.

---

## Entity Relationship Diagram

```
   workspaces ──< squads ──< archives ──< logs ──< versions
                    │            │           │
                    ├──< squad_members (users)
                    ├──< squad_invitations (users)
                    ├──< squad_permissions
                    └──< archive_repos

   logs ──< comments ──< comment_replies
        ──< favorites
        ──< github_links              (per-doc file sync)
        ──< github_embed_refs         (code/issue/PR/file embeds)
        ──< github_pr_sessions        (long-lived PR session state)

   users ──< sessions
         ──< oauth_accounts
         ──< permissions
         ──< password_reset_tokens
         ──< two_factor_codes
         ──< user_invitations
         ──< notifications            (per-user inbox)
         ──< watches                  (per-user subscriptions)

   activity_log ─► (workspace, squad, user, resource_type+id)
                    no FK on workspace/squad/resource — pruned daily
```

---

## Migrations

`init.sql` is the canonical schema (used by fresh installs and by tests).
Live deployments apply incremental upgrades from the `migrations/`
directory. The current set:

| File                            | Adds                                                |
|---------------------------------|-----------------------------------------------------|
| `add_github_links.sql`          | `github_links` table                                |
| `add_markdown_content.sql`      | `logs.markdown_content` column                      |
| `add_activity_log.sql`          | `activity_log` table                                |
| `add_watches.sql`               | `watches` table                                     |
| `add_notifications.sql`         | `notifications` table + `users.notification_prefs`  |
| `p0_github_sync.sql`            | GitHub sync state on `github_links`                 |
| `p1_github_embeds.sql`          | `github_embed_refs` table                           |
| `p2_github_collab.sql`          | `github_pr_sessions` table                          |
| `p3_github_polish.sql`          | indexes / column tweaks for the GitHub stack        |

> **Rule:** any column or table added as a migration must also be present
> in `init.sql`. Both must stay in sync — fresh installs and existing
> deployments must converge to the same schema.

---

## Key Design Notes

- **Invite-only signups:** New users must have a matching `user_invitations` token. No public registration.
- **JSON access arrays:** `read_access` and `write_access` on `archives` store arrays of user IDs. This avoids a separate join table for common cases and keeps access queries compact.
- **Access cascade:** A workspace owner, squad owner, or archive creator always has full access — access arrays are supplemental grants, not the only mechanism. See the [access control doc](./access-control.md) for full resolution order.
- **Generated column for search:** `plain_content` on `logs` is a STORED generated column that strips HTML. The `FULLTEXT` index runs on this column plus `title`, enabling boolean mode relevance-ranked search without a separate search service.
- **Dual document state:** A log has `html_content` (human-readable, set on explicit save) and `ydoc_state` (binary Yjs CRDT, written frequently during live editing). When a user opens a document, the Tiptap editor hydrates from `html_content`; ongoing edits propagate as CRDT updates via WebSocket.
- **Soft parent references:** `logs.parent_id` self-references to form a document tree within an archive. Deleting a parent sets children's `parent_id` to NULL (ON DELETE SET NULL) rather than cascading deletes.

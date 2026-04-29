-- P0 GitHub bidirectional sync
-- Adds merge-base tracking, sync state, and OAuth identity/revocation columns.

ALTER TABLE github_links
  ADD COLUMN base_sha VARCHAR(64) DEFAULT NULL AFTER file_sha,
  ADD COLUMN last_pulled_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN last_pushed_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN sync_status ENUM('clean','remote_ahead','local_ahead','diverged','conflict') DEFAULT 'clean',
  ADD INDEX idx_links_status (sync_status);

-- At link time, file_sha and the merge base were equal. Backfill so existing
-- rows continue to behave correctly until the next status check.
UPDATE github_links SET base_sha = file_sha WHERE base_sha IS NULL;

ALTER TABLE oauth_accounts
  ADD COLUMN provider_username VARCHAR(255) DEFAULT NULL AFTER provider_email,
  ADD COLUMN provider_avatar_url VARCHAR(500) DEFAULT NULL AFTER provider_username,
  ADD COLUMN token_status ENUM('active','revoked','unknown') DEFAULT 'active' AFTER encrypted_token;

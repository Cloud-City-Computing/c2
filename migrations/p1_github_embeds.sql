-- P1 GitHub live embeds + archive-as-repo
-- Extends archive_repos with bulk-import metadata and adds a denormalized
-- index of GitHub references inside documents for back-linking.

ALTER TABLE archive_repos
  ADD COLUMN default_branch VARCHAR(255) DEFAULT 'main',
  ADD COLUMN docs_path VARCHAR(500) DEFAULT 'docs',
  ADD COLUMN auto_link_imports BOOLEAN DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS github_embed_refs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  log_id INT NOT NULL,
  embed_type ENUM('code','issue','pr','file') NOT NULL,
  repo_owner VARCHAR(255) NOT NULL,
  repo_name VARCHAR(255) NOT NULL,
  ref_value VARCHAR(500) NOT NULL,
  pinned_sha VARCHAR(64) DEFAULT NULL,
  branch VARCHAR(255) DEFAULT NULL,
  last_seen_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE,
  INDEX idx_embed_log (log_id),
  INDEX idx_embed_repo (repo_owner, repo_name, embed_type)
) ENGINE=InnoDB;

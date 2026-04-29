-- P2 GitHub collaboration: PR-as-document + Doc<->Issue cross-linking.
-- Extends comments to host PR review threads, adds a session table for
-- virtual logs that back PR views, and a system flag on archives so those
-- virtual logs don't pollute search or archive lists.

ALTER TABLE comments
  MODIFY tag ENUM('comment','suggestion','question','issue','note','pr_review') DEFAULT 'comment',
  ADD COLUMN external_kind ENUM('pr_file_line','pr_general','issue_thread') DEFAULT NULL,
  ADD COLUMN external_ref VARCHAR(500) DEFAULT NULL,
  ADD COLUMN external_id VARCHAR(64) DEFAULT NULL,
  ADD INDEX idx_comments_external (external_kind, external_ref);

CREATE TABLE IF NOT EXISTS github_pr_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  log_id INT NOT NULL,
  repo_owner VARCHAR(255) NOT NULL,
  repo_name VARCHAR(255) NOT NULL,
  pr_number INT NOT NULL,
  opened_by INT NOT NULL,
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE,
  FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_pr_session (repo_owner, repo_name, pr_number),
  INDEX idx_pr_session_log (log_id)
) ENGINE=InnoDB;

ALTER TABLE archives
  ADD COLUMN `system` BOOLEAN DEFAULT FALSE,
  ADD INDEX idx_archives_system (`system`);

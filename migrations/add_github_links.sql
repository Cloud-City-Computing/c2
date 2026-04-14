-- Migration: Add github_links table
-- Links Cloud Codex documents to GitHub files for sync/update tracking

CREATE TABLE IF NOT EXISTS github_links (
  id INT AUTO_INCREMENT PRIMARY KEY,
  log_id INT NOT NULL,
  repo_owner VARCHAR(255) NOT NULL,
  repo_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  branch VARCHAR(255) NOT NULL,
  file_sha VARCHAR(64) DEFAULT NULL,
  linked_by INT NOT NULL,
  linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE,
  FOREIGN KEY (linked_by) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_log_link (log_id)
) ENGINE=InnoDB;

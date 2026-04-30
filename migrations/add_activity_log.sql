-- Activity log: workspace-scoped chronological feed of meaningful events.
-- Read access is filtered at query time via routes/helpers/ownership.js.

CREATE TABLE IF NOT EXISTS activity_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  squad_id INT DEFAULT NULL,
  user_id INT NOT NULL,
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(30) NOT NULL,
  resource_id INT NOT NULL,
  metadata JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_activity_workspace_time (workspace_id, created_at),
  INDEX idx_activity_squad_time (squad_id, created_at),
  INDEX idx_activity_resource (resource_type, resource_id, created_at),
  INDEX idx_activity_user_time (user_id, created_at)
) ENGINE=InnoDB;

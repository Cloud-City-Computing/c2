-- Add notifications table and per-user notification preferences.
-- Foundation for the awareness/notifications feature set (mentions,
-- watch fan-out, comment-on-my-doc, squad invites).

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  actor_id INT DEFAULT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT DEFAULT NULL,
  link_url VARCHAR(512) DEFAULT NULL,
  resource_type VARCHAR(30) DEFAULT NULL,
  resource_id INT DEFAULT NULL,
  metadata JSON DEFAULT NULL,
  read_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_notifications_user_created (user_id, created_at),
  INDEX idx_notifications_user_unread (user_id, read_at, created_at),
  INDEX idx_notifications_resource (resource_type, resource_id)
) ENGINE=InnoDB;

ALTER TABLE users
  ADD COLUMN notification_prefs JSON DEFAULT NULL;

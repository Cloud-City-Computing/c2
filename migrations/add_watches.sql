-- Watch / subscribe table — links a user to a resource (log or archive).
-- Activity events on watched resources fan out to per-user notifications.

CREATE TABLE IF NOT EXISTS watches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  resource_type VARCHAR(30) NOT NULL,
  resource_id INT NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_watches_user_resource (user_id, resource_type, resource_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_watches_resource (resource_type, resource_id)
) ENGINE=InnoDB;

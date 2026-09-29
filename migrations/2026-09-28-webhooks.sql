-- Outbound webhooks: subscriptions, the outbox and its deliveries (W6-CDX-13).
--
-- Cloud Codex can tell a configured receiver when a document or an archive is
-- renamed, moved, edited, published, restored or deleted
-- (docs/api/admin.md, "Webhooks"). These three tables hold that, and an
-- install with no subscription never writes a row to any of them.
--
-- webhook_subscriptions: who receives what. source 'env' is the one row
-- reconciled at boot from WEBHOOK_URL, WEBHOOK_SECRET and WEBHOOK_WORKSPACE_ID;
-- its secret is read from the environment when a delivery is signed and is
-- never stored, so its secret column is NULL. source 'admin' rows are made
-- through /api/admin/webhooks and store their secret, which the API never
-- returns after creation. workspace_id deliberately has no foreign key: the
-- env row names a workspace by number, and deleting that workspace must not
-- delete the subscription silently.
--
-- webhook_events: the outbox. One row per emitted event, holding the exact
-- body bytes every delivery of it sends. Its id is the envelope's sequence
-- and event_uuid its idempotency key. occurred_at is UTC.
--
-- webhook_deliveries: one row per (subscription, event), worked in event order
-- per subscription by the delivery worker (W6-CDX-14).
--
-- Additive, so neither direction breaks the application, and not idempotent
-- (a second application fails with ER_TABLE_EXISTS_ERROR, which the runner
-- explains). To undo it:
--   DROP TABLE webhook_deliveries, webhook_events, webhook_subscriptions;

CREATE TABLE webhook_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  url VARCHAR(2048) NOT NULL,
  secret VARCHAR(255) NULL,
  source VARCHAR(8) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  event_types JSON NULL,
  workspace_id INT NULL,
  disabled_reason VARCHAR(255) NULL,
  consecutive_failures INT NOT NULL DEFAULT 0,
  paused_until DATETIME(3) NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_webhook_subscriptions_source CHECK (source IN ('env', 'admin')),
  CONSTRAINT chk_webhook_subscriptions_secret CHECK ((source = 'env') = (secret IS NULL)),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE webhook_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_uuid CHAR(36) NOT NULL,
  type VARCHAR(32) NOT NULL,
  workspace_id INT NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  body MEDIUMBLOB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook_events_uuid (event_uuid),
  INDEX idx_webhook_events_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE webhook_deliveries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  subscription_id INT NOT NULL,
  event_id BIGINT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  leased_by CHAR(36) NULL,
  lease_expires_at DATETIME(3) NULL,
  last_status SMALLINT NULL,
  last_error VARCHAR(255) NULL,
  delivered_at DATETIME(3) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_webhook_deliveries_status CHECK (status IN ('pending', 'delivered', 'dead')),
  UNIQUE KEY uq_webhook_deliveries_sub_event (subscription_id, event_id),
  INDEX idx_webhook_deliveries_head (subscription_id, status, event_id),
  FOREIGN KEY (subscription_id) REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES webhook_events(id) ON DELETE CASCADE
) ENGINE=InnoDB;

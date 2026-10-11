-- The emit order lock for the outbox (outbound events, a review finding on W6-CDX-13).
--
-- emitEvent takes the next webhook_events id at INSERT, inside a transaction
-- that commits later. Two emits can therefore commit in the opposite order to
-- their ids, and a receiver that is handed the later id first would see the
-- sequence go backwards. Each emit now locks this one row (SELECT ... FOR
-- UPDATE) before its INSERT, so the lock is held to commit and the ids are
-- allocated in commit order. The row is created here and by init.sql.
--
-- Additive, and not idempotent (a second application fails with
-- ER_TABLE_EXISTS_ERROR, which the runner explains). To undo it:
--   DROP TABLE webhook_sequence_lock;

CREATE TABLE webhook_sequence_lock (
  id TINYINT PRIMARY KEY,
  CONSTRAINT chk_webhook_sequence_lock_row CHECK (id = 1)
) ENGINE=InnoDB;

INSERT INTO webhook_sequence_lock (id) VALUES (1);

-- Rotation keeps the sign-in time and names the session it replaces (W6-CDX-6, review).
--
-- signed_in_at: when the person signed in. A password or email change deletes and re-mints every
-- session, and the replacement's created_at is the change, not the sign-in. The back-channel logout
-- bound (services/backchannel-logout.js) measures signed_in_at, so a session that was rotated after a
-- logout is still ended by that logout's token. Backfilled from created_at for every existing row.
--
-- rotated_from: the digest of the session this one replaced. A logout that presents the old token
-- finds the replacement by it, so a rotation that committed first cannot leave the replacement live.
--
-- Not idempotent. To undo it:
--   ALTER TABLE sessions DROP INDEX idx_sessions_rotated_from, DROP COLUMN rotated_from, DROP COLUMN signed_in_at;

ALTER TABLE sessions
  ADD COLUMN signed_in_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP AFTER created_at,
  ADD COLUMN rotated_from CHAR(64) NULL AFTER signed_in_at,
  ADD INDEX idx_sessions_rotated_from (rotated_from);

UPDATE sessions SET signed_in_at = created_at;

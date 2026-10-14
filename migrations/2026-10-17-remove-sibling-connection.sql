-- Codex becomes a standalone product; the suite integration is removed (CDX-SA-3).
--
-- The membership sync and the env-declared webhook subscription are gone from the code. This removes
-- what they left in the schema:
--   1. revoked open invitations are expired, so dropping revoked_at can never reopen one;
--   2. env-declared webhook subscriptions are deleted (their deliveries cascade); a self-hoster creates
--      the same subscription in Admin, Webhooks;
--   3. user_invitations.grants_admin and revoked_at are dropped. 0.15.0 reads neither.
--
-- MySQL commits each statement, so the order matters: 1 and 2 are safe to repeat if 3 fails.
-- Not idempotent as a whole. To undo it (the values are not restored; they meant something only to
-- the removed sync, and a downgraded 0.14.0 recreates its env subscription at boot):
--   ALTER TABLE user_invitations
--     ADD COLUMN grants_admin BOOLEAN NOT NULL DEFAULT FALSE,
--     ADD COLUMN revoked_at TIMESTAMP NULL DEFAULT NULL;

UPDATE user_invitations
   SET expires_at = LEAST(expires_at, NOW())
 WHERE revoked_at IS NOT NULL AND accepted = FALSE;

DELETE FROM webhook_subscriptions WHERE source = 'env';

ALTER TABLE user_invitations
  DROP COLUMN grants_admin,
  DROP COLUMN revoked_at;

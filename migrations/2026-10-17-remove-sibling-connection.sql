-- Codex becomes a standalone product; the suite integration is removed (CDX-SA-3).
--
-- The membership sync and the env-declared webhook subscription are gone from the code. This removes
-- what they left in the schema:
--   1. revoked open invitations are expired, so dropping revoked_at can never reopen one;
--   2. open invitations the sync created for a workspace owner (grants_admin = TRUE) are expired. Only the
--      sync ever wrote grants_admin = TRUE, and it granted admin, so after the drop each would admit a plain
--      member for up to a year. An owner who still needs access is invited again by an admin;
--   3. env-declared webhook subscriptions are deleted (their deliveries cascade); a self-hoster creates
--      the same subscription in Admin, Webhooks;
--   4. user_invitations.grants_admin and revoked_at are dropped. 0.15.0 reads neither.
--
-- MySQL commits each statement, so the order matters: 1 to 3 are safe to repeat if 4 fails.
-- Not idempotent as a whole.
--
-- Undo, for a rollback to 0.14.0 (the values are not restored: they meant something only to the removed
-- sync). 0.14.0 refuses to start without the two columns, so this runs BEFORE the 0.14.0 image starts.
-- A 0.14.0 started after the undo recreates its env subscription at boot from WEBHOOK_URL and
-- WEBHOOK_SECRET, if those are still set; the undo does not restore the deleted rows themselves.
--   ALTER TABLE user_invitations
--     ADD COLUMN grants_admin BOOLEAN NOT NULL DEFAULT FALSE,
--     ADD COLUMN revoked_at TIMESTAMP NULL DEFAULT NULL;

UPDATE user_invitations
   SET expires_at = LEAST(expires_at, NOW())
 WHERE revoked_at IS NOT NULL AND accepted = FALSE;

UPDATE user_invitations
   SET expires_at = LEAST(expires_at, NOW())
 WHERE grants_admin = TRUE AND accepted = FALSE;

DELETE FROM webhook_subscriptions WHERE source = 'env';

ALTER TABLE user_invitations
  DROP COLUMN grants_admin,
  DROP COLUMN revoked_at;

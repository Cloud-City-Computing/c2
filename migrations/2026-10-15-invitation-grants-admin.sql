-- An invitation can grant instance admin, so a workspace owner synced from Cloud Command is an admin
-- before their first sign-in (W6-CDX-9, the membership sync).
--
-- Read only when the invitation binds on a verified sign-in (services/identity.js, the invitation rung):
-- the INSERT that creates the user sets is_admin from it. Only a NEW user is created that way, so this
-- never promotes an existing account; that stays with ensureAdminUser's refusals.
--
-- Default FALSE: every existing invitation admits a plain member, as it did before this column.
-- Not idempotent. To undo it:
--   ALTER TABLE user_invitations DROP COLUMN grants_admin;

ALTER TABLE user_invitations
  ADD COLUMN grants_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- First-run experience.
--
-- An invitation can carry the squad the new account joins, so accepting an
-- invite lands the user somewhere reachable instead of in an empty app. The
-- role and permission flags mirror `squad_invitations` exactly, because
-- `squad_members` needs those columns at insert time and reusing the names
-- avoids inventing a second permission vocabulary.
--
-- `users.onboarded_at` records that a user has been through the welcome. It is
-- NULL for every existing user, so they each see it once, which is intended:
-- the admin has never been able to see one at all.

ALTER TABLE user_invitations
  ADD COLUMN squad_id INT NULL AFTER invited_by,
  ADD COLUMN role ENUM('member', 'admin', 'owner') DEFAULT 'member',
  ADD COLUMN can_read BOOLEAN DEFAULT TRUE,
  ADD COLUMN can_write BOOLEAN DEFAULT FALSE,
  ADD COLUMN can_create_log BOOLEAN DEFAULT FALSE,
  ADD COLUMN can_create_archive BOOLEAN DEFAULT FALSE,
  ADD COLUMN can_manage_members BOOLEAN DEFAULT FALSE,
  ADD COLUMN can_delete_version BOOLEAN DEFAULT FALSE,
  ADD COLUMN can_publish BOOLEAN DEFAULT FALSE,
  ADD CONSTRAINT fk_user_invitations_squad
    FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE SET NULL;

ALTER TABLE users
  ADD COLUMN onboarded_at TIMESTAMP NULL DEFAULT NULL;

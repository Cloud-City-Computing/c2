-- Workspace ownership becomes a real foreign key.
--
-- `workspaces.owner` was a TEXT column holding an email address with no
-- constraint pointing at `users`. Every ownership check compared it against
-- the session user's email (`o.owner = ?`), so a user who changed their email
-- silently stopped being the owner of their own workspace: clause 4 of the
-- readAccessWhere / writeAccessWhere fragments simply stopped matching, with
-- nothing logged and no error. Conversely, deleting a user left the email
-- behind, so a later account registering that address inherited the workspace.
--
-- Ownership is now `owner_id`, an INT referencing users(id) ON DELETE SET NULL:
-- deleting a user must not delete their workspace, it leaves the workspace
-- ownerless and reachable by admins only.
--
-- THIS MIGRATION DROPS `workspaces.owner`. It aborts before doing so if any
-- workspace's owner email matches no user row, because that email is the only
-- record of who was meant to own it. If it aborts, either create the missing
-- user or set the intended owner_id by hand, then re-run.

-- Report anything the backfill would not be able to resolve. This runs before
-- any write, so an abort here leaves the table exactly as it was and the
-- migration can simply be re-run once the report is empty.
SELECT id, name, owner AS unresolved_owner_email
  FROM workspaces w
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = w.owner);

-- Abort if that report was non-empty. Selecting an undefined column raises
-- ERROR 1054, and mysql stops with a non-zero exit rather than dropping an
-- email that is the only record of who was meant to own the workspace.
SET @orphans := (
  SELECT COUNT(*) FROM workspaces w
   WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = w.owner)
);
SET @guard := IF(@orphans > 0,
  'SELECT abort_some_workspace_owner_emails_match_no_user',
  'SELECT 1');
PREPARE guard FROM @guard;
EXECUTE guard;
DEALLOCATE PREPARE guard;

ALTER TABLE workspaces
  ADD COLUMN owner_id INT DEFAULT NULL AFTER name;

UPDATE workspaces w
  JOIN users u ON u.email = w.owner
   SET w.owner_id = u.id;

ALTER TABLE workspaces
  ADD CONSTRAINT fk_workspaces_owner
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE workspaces DROP COLUMN owner;

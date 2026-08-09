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
-- deleting a user must not delete their workspace. It leaves the workspace
-- ownerless, which means only clause 4 of the access fragments stops matching;
-- squad membership, per-squad grants and the workspace-wide flag are
-- unaffected, so the squad can still reach everything in it.
--
-- STOP THE APP BEFORE RUNNING THIS. There is no window in which both builds
-- work: the old code SELECTs `owner`, which errors the moment it is dropped,
-- and the new code SELECTs `owner_id`, which does not exist until this runs.
--
-- THIS MIGRATION DROPS `workspaces.owner`. It refuses to, twice over, if any
-- workspace's owner email matches no user row, because that email is the only
-- record of who was meant to own it. If it refuses, either create the missing
-- user or set the intended owner_id by hand, then re-run.
--
-- DO NOT RUN WITH `mysql --force`, and do not paste this into a GUI that runs
-- statements independently. The first guard below relies on the client
-- stopping at the first error. The DROP carries its own guard for that reason,
-- but --force also turns a refusal into a silent, successful-looking run.
--
-- Recovery: a normal run that refuses has written nothing, so fix the data and
-- re-run this file. A --force run that refuses HAS added and backfilled
-- `owner_id`, so re-running the whole file trips on the duplicate column; set
-- the missing owner_id values by hand and then run the final DROP alone.

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

-- The DROP guards itself rather than trusting the script to have stopped.
-- Recomputed from the post-backfill state, so it holds even if the guard above
-- was skipped by a client that continues past errors: any workspace still
-- lacking an owner_id here is one whose email resolved to nobody, and dropping
-- the column would destroy the only record of it.
SET @unresolved := (SELECT COUNT(*) FROM workspaces WHERE owner_id IS NULL);
SET @drop := IF(@unresolved > 0,
  'SELECT refusing_to_drop_owner_while_some_emails_are_unresolved',
  'ALTER TABLE workspaces DROP COLUMN owner');
PREPARE dropstmt FROM @drop;
EXECUTE dropstmt;
DEALLOCATE PREPARE dropstmt;

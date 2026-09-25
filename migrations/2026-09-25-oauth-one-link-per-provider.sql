-- One oauth_accounts link per user per provider (open-questions C7).
--
-- oauth_accounts was unique on (provider, provider_user_id) only, so the
-- schema said a provider account belongs to at most one user but not that a
-- user holds at most one account per provider. The Google sign-in ladder
-- (services/identity.js) now refuses a second Google subject for a user as
-- identity_conflict, but that is a SELECT followed by an INSERT: two
-- different Google subjects signing in for one user at the same instant can
-- both pass the SELECT and both insert. This key makes the rule a database
-- fact, so the second INSERT fails, and resolveIdentity answers that failure
-- with the same identity_conflict. GitHub linking already keeps one row per
-- user (routes/oauth.js updates the caller's row, or inserts only when there
-- is none), so for GitHub the key encodes what the code already does.
--
-- ── THE GUARD: IT REFUSES, IT NEVER DELETES ──────────────────────────────
--
-- An install that already holds a double link cannot take the key, and which
-- of two links is the real one is a decision about a person's account, not
-- something a migration can guess. So the guard below refuses before the
-- ALTER, deleting nothing, with a message naming the query that lists every
-- offending (user_id, provider) pair:
--
--   SELECT user_id, provider FROM oauth_accounts GROUP BY user_id, provider HAVING COUNT(*) > 1
--
-- To resolve a refusal, take a dump, then for each pair it lists look at the
-- rows:
--
--   SELECT id, provider_user_id, provider_email, provider_username, created_at
--     FROM oauth_accounts WHERE user_id = <user_id> AND provider = '<provider>';
--
-- decide which link the person really signs in with, delete the other with
-- DELETE FROM oauth_accounts WHERE id = <id>, and run `npm run migrate` again.
-- A deleted Google link stops that Google account signing in to this user; a
-- deleted GitHub link drops its stored token, and the user relinks GitHub.
--
-- MySQL has no conditional error outside a stored program, so the guard is a
-- throwaway procedure. CREATE PROCEDURE commits on its own, and a refusal stops
-- the batch at the SIGNAL, before the DROP that follows it. The runner drops
-- the procedures a refused file created (scripts/migrate.js), so a refused run
-- leaves nothing behind; the DROP PROCEDURE IF EXISTS first covers a run that
-- died some other way before its cleanup.
--
-- Apply it with `npm run migrate` only. The mysql command-line client splits a
-- script on every semicolon, including the ones inside the procedure body.
--
-- ── WRITERS, AND THE ONE RACE LEFT ───────────────────────────────────────
--
-- Neither direction breaks the application. New code against the old schema
-- only carries a catch that never fires. Old code against the new schema gets
-- error 1062 (ER_DUP_ENTRY), and a 500, wherever it would have written a second
-- link, which is the failure this key exists to cause: the Google ladder
-- before the C7 fix did that on every recycled address, not only in a race.
-- Stopping writers is therefore not required, but a double link written
-- between the guard and the ALTER makes the ALTER fail with that same error.
-- That ALTER is one statement and changes nothing when it fails, the guard is
-- already gone, and nothing is recorded, so the recovery is the resolution
-- above and a re-run.
--
-- Not idempotent, like the other ALTER migrations here: the runner never
-- re-runs a recorded file, and a second application fails with
-- ER_DUP_KEYNAME, which the runner explains. To undo it:
--   ALTER TABLE oauth_accounts DROP INDEX uq_oauth_user_provider;

DROP PROCEDURE IF EXISTS migration_guard_oauth_one_link_per_provider;

CREATE PROCEDURE migration_guard_oauth_one_link_per_provider()
BEGIN
  IF EXISTS (
    SELECT 1 FROM oauth_accounts GROUP BY user_id, provider HAVING COUNT(*) > 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Double links exist. Find them: SELECT user_id, provider FROM oauth_accounts GROUP BY user_id, provider HAVING COUNT(*) > 1';
  END IF;
END;

CALL migration_guard_oauth_one_link_per_provider();

DROP PROCEDURE migration_guard_oauth_one_link_per_provider;

ALTER TABLE oauth_accounts
  ADD UNIQUE KEY uq_oauth_user_provider (user_id, provider);

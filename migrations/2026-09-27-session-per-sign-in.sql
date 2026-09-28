-- One session row per sign-in, stored as a SHA-256 digest (W6-CDX-2).
--
-- generateSessionToken used to hand every sign-in of a user the same live
-- row, so a second device got the first device's token and one logout signed
-- every device out. sessions.id also held the raw token, so a database dump
-- was a list of working sign-ins. The new image mints a fresh row per
-- sign-in and stores only hashSessionToken(token) (services/session-token.js,
-- SHA-256, lowercase hex), which is 64 characters, so sessions.id stays
-- CHAR(64).
--
-- This file:
--   - adds sessions.auth_provider, the flow that minted the row. Existing rows
--     are local sign-ins or Google ones, and nothing recorded which, so they
--     all become 'local'. The default exists only to backfill them and is
--     dropped straight after, so a future flow that forgets to name itself
--     fails at insert (error 1364) instead of passing for a local sign-in, as
--     password_reset_tokens.purpose does. VARCHAR plus CHECK, not ENUM, for
--     the reason 2026-09-08-token-purpose.sql measured: a NOT NULL ENUM with
--     no default silently takes its first value;
--   - hashes every existing id in place, so a browser signed in before the
--     upgrade stays signed in after it.
--
-- ── WHY THE HASH RIDES WITH A COLUMN ─────────────────────────────────────
--
-- --adopt-fresh-install refuses any post-baseline file that declares no
-- CREATE TABLE, ADD COLUMN or named ADD KEY it can check against the live
-- schema (scripts/migrate.js, assertSchemaAlreadyHas). A data-only file would
-- make every later fresh install refuse to adopt. So the UPDATE lives in the
-- file that adds auth_provider, which is the claim adoption checks.
--
-- ── THE HASH IS IDEMPOTENT ───────────────────────────────────────────────
--
-- A raw token is 64 characters from [A-Za-z0-9]; a digest is lowercase hex.
-- Only a row holding a character outside [0-9a-f] is hashed, so a digest
-- (from a re-run, or from the new image) is left alone. The 'c' flag makes
-- the match case-sensitive whatever the column's collation, which otherwise
-- ignores case and would read 'A' as 'a'. The chance that a raw token
-- already looks like a digest is (16/62)^64.
--
-- ── ORDER OF OPERATIONS: STOP EVERY WRITER, APPLY THIS, START THE NEW IMAGE
--
-- The schema is incompatible with the app in BOTH directions:
--
--   old code + new schema -> every sign-in fails with error 1364 (the old
--     INSERT names no auth_provider), and every existing session looks
--     signed out, because the old code looks rows up by the raw token.
--   new code + old schema -> every sign-in fails with error 1054 (unknown
--     column auth_provider), and every existing session looks signed out,
--     because the new code looks rows up by the digest.
--
-- So stop every writer first ("every writer": in dev that is `npm run dev` on
-- the host, since docker-compose.yaml runs only the database), run
-- `npm run migrate`, then start the new image. Stopping writers also means no
-- raw-token row can arrive after the UPDATE and stay raw.
--
-- An interrupted run: MySQL implicitly commits each ALTER, so a run that dies
-- partway can leave the column without its CHECK or without the hash. Drop
-- the column by hand, which drops the CHECK with it, and run
-- `npm run migrate` again; the hash step changes nothing it already changed:
--   ALTER TABLE sessions DROP COLUMN auth_provider;
--
-- THERE IS NO ROLLBACK OF THE HASH. A digest cannot be turned back into the
-- token it came from. Reverting to the old image means dropping the column as
-- above, and every user signing in again, because the old image cannot match
-- a hashed row.

ALTER TABLE sessions
  ADD COLUMN auth_provider VARCHAR(16) NOT NULL DEFAULT 'local' AFTER user_id;

ALTER TABLE sessions
  ALTER COLUMN auth_provider DROP DEFAULT,
  ADD CONSTRAINT chk_sessions_auth_provider CHECK (auth_provider IN ('local', 'google'));

UPDATE sessions SET id = SHA2(id, 256) WHERE REGEXP_LIKE(id, '[^0-9a-f]', 'c');

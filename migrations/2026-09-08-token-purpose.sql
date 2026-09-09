-- Typed purpose for password_reset_tokens.
--
-- Four flows mint into this table and four read out of it, and no reader
-- constrained which flow minted the row it found. POST /api/login mints a
-- 2FA challenge row and returns that token to the caller in the response
-- body, and POST /api/reset-password read the same table by token with no
-- purpose filter, so the login endpoint's own token was accepted as a
-- password reset token.
--
-- Impact, stated accurately: reset-password rewrites password_hash, marks the
-- token used and deletes the user's sessions. It does not clear
-- two_factor_method and it issues no session, and the caller must already hold
-- the victim's password to reach the 2FA challenge at all. So this is a
-- persistent password rewrite plus a full session wipe of the victim, i.e.
-- lockout and an integrity defect. It is not account takeover.
--
-- Legacy rows cannot be classified after the fact, and every token in this
-- table is short-lived (10 minutes to 1 hour). They are deleted rather than
-- given a default, so this migration fails closed: in-flight resets, 2FA
-- challenges, TOTP enrolments and 2FA-disable confirmations are invalidated
-- and must be restarted.
--
-- ── WHY VARCHAR + CHECK AND NOT ENUM ─────────────────────────────────────
--
-- The whole point of the column is that a fifth flow which forgets to name its
-- purpose fails loudly at insert instead of silently minting a password reset
-- token. ENUM cannot deliver that. MySQL gives a NOT NULL ENUM with no DEFAULT
-- an implicit default of the FIRST enumerated value, even under
-- STRICT_TRANS_TABLES. Measured on mysql:8 (8.4.8), the shipped image:
--
--   CREATE TABLE e (id INT AUTO_INCREMENT PRIMARY KEY,
--     p ENUM('password_reset','two_factor_login', ...) NOT NULL);
--   INSERT INTO e (id) VALUES (NULL);   -- succeeds, p = 'password_reset'
--
-- That is the worst possible failure mode here: an omitted purpose becomes a
-- password reset token, which is the exact defect this migration exists to
-- close. VARCHAR(32) NOT NULL with no DEFAULT raises error 1364 on omission,
-- and the CHECK constraint (enforced since MySQL 8.0.16) raises error 3819 on
-- a value outside the set, so both mistakes are loud.
--
-- ── ORDER OF OPERATIONS IS LOAD-BEARING ──────────────────────────────────
--
-- Required order: STOP EVERY WRITER, APPLY THIS, START THE NEW IMAGE.
--
-- "Every writer", not "the app container": docker-compose.yaml defines only a
-- `database` service, so in dev the writer is `npm run dev` on the host and
-- there is no app container to stop.
--
-- No compose file overrides sql_mode, so MySQL 8's default
-- STRICT_TRANS_TABLES applies and this schema is incompatible with the app in
-- BOTH directions:
--
--   old code + new schema -> error 1364 on all four minters. Every 2FA user
--     gets a 500 on POST /api/login and cannot self-serve out, because
--     POST /api/forgot-password 500s on its own insert too. That also makes
--     forgot-password 500 for an address that exists and 200 for one that does
--     not, reinstating exactly the enumeration oracle the constant-time
--     response block in routes/auth.js exists to prevent.
--   new code + old schema -> error 1054, unknown column 'purpose'.
--
-- Stopping the writers first also closes a partial-failure race: a row
-- inserted between the DELETE and the final ALTER makes that ALTER fail, and
-- MySQL implicitly commits DDL, so the table would be left with a nullable
-- VARCHAR(32) and no CHECK constraint, and nothing recording that state (there
-- is no schema_migrations table at this point in the history). Nothing can
-- insert while the writers are down.
--
-- The error you would see is 1265, "Data truncated for column 'purpose'",
-- measured on 8.4.8 with one NULL row present. Not 1138: adding the CHECK in
-- the same ALTER forces the table-copy path, which reports the NULL that way.
-- A bare MODIFY on its own is what gives 1138. Either way the recovery is the
-- same, drop the column and re-apply.
--
-- THERE IS NO ROLLBACK. Reverting the application after applying this lands
-- the operator in old-code-against-new-schema, described above. Getting back
-- means dropping the column by hand:
--   ALTER TABLE password_reset_tokens DROP COLUMN purpose;
-- (which drops the CHECK constraint with it).
--
-- The single-process architecture already makes a restart a brief total
-- outage, so a planned one costs nothing extra.

ALTER TABLE password_reset_tokens
  ADD COLUMN purpose VARCHAR(32) NULL AFTER token;

DELETE FROM password_reset_tokens WHERE purpose IS NULL;

ALTER TABLE password_reset_tokens
  MODIFY COLUMN purpose VARCHAR(32) NOT NULL,
  ADD CONSTRAINT chk_password_reset_tokens_purpose
    CHECK (purpose IN ('password_reset','two_factor_login','totp_setup','two_factor_disable'));

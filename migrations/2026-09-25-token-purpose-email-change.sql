-- A fifth token purpose, email_change, and the address it confirms.
--
-- POST /api/update-account now needs the current password for an email or
-- password change. An account with no password (one an external sign-in
-- created) has nothing to answer that with, so its email change is confirmed
-- instead by a 6-digit code sent to its CURRENT address, the way
-- POST /api/2fa/disable confirms with a code and a confirmToken. The
-- confirmToken is a password_reset_tokens row, so it needs a purpose of its
-- own, and it has to carry the address it confirms: the code is sent for one
-- address, and POST /api/update-account/confirm-email applies exactly that one.
--
-- So this file:
--   - adds password_reset_tokens.new_email, NULL for every other purpose;
--   - widens chk_password_reset_tokens_purpose to include 'email_change'
--     (the constraint is dropped and re-added under the same name, in the
--     same statement; migrations/2026-09-08-token-purpose.sql is applied on
--     existing installs and is never edited, because the runner's checksum
--     guard refuses a changed file);
--   - adds chk_password_reset_tokens_new_email, which holds the two together:
--     an email_change row must carry an address, and no other row may. Both
--     mistakes are error 3819 at insert, measured on mysql:8.4 (8.4.11).
--
-- ── WRITERS ──────────────────────────────────────────────────────────────
--
-- Stopping writers is not required. Old code against the new schema never
-- names new_email, and every row it mints has one of the four older
-- purposes and a NULL new_email, which both constraints accept. New code
-- against the old schema fails only where it names the column: an email
-- change on a password-less account answers a 500 (error 1054, unknown column
-- 'new_email') until this is applied. Everything else is unaffected.
--
-- Rows already in the table are all older purposes with no new_email, so both
-- constraints hold for them and the ALTER succeeds with rows present.
--
-- Not idempotent, like the other ALTER migrations here: the runner never
-- re-runs a recorded file, and a second application fails with a duplicate
-- column. To undo it by hand, first delete any email_change rows, then:
--   ALTER TABLE password_reset_tokens
--     DROP CHECK chk_password_reset_tokens_new_email,
--     DROP CHECK chk_password_reset_tokens_purpose,
--     DROP COLUMN new_email,
--     ADD CONSTRAINT chk_password_reset_tokens_purpose
--       CHECK (purpose IN ('password_reset','two_factor_login','totp_setup','two_factor_disable'));

ALTER TABLE password_reset_tokens
  ADD COLUMN new_email VARCHAR(255) NULL AFTER purpose,
  DROP CHECK chk_password_reset_tokens_purpose,
  ADD CONSTRAINT chk_password_reset_tokens_purpose
    CHECK (purpose IN ('password_reset','two_factor_login','totp_setup','two_factor_disable','email_change')),
  ADD CONSTRAINT chk_password_reset_tokens_new_email
    CHECK ((purpose = 'email_change') = (new_email IS NOT NULL));

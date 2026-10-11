-- The OIDC relying party's identity table, and session provenance (W6-CDX-5).
--
-- A person signed in through Cloud City ID (or any OIDC issuer this instance is
-- configured for) is keyed on (issuer, subject), not on an email address. This
-- table holds that link: one row per (issuer, sub) per local user.
--
--   user_identities.subject is utf8mb4_bin, because an OIDC sub is
--   case-sensitive: "Ab" and "ab" are two people, and the default collation
--   would fold them together.
--   UNIQUE (issuer, subject): an identity belongs to at most one user.
--   UNIQUE (user_id, issuer): a user holds at most one identity per issuer, which
--   makes the same-issuer conflict rule a database fact.
--
-- sessions gains identity_id (the identity an OIDC sign-in used) and provider_sid
-- (the issuer's sid, for back-channel logout in W6-CDX-6). auth_provider widens to
-- 'oidc'. chk_sessions_identity_pairing keeps 'oidc' and identity_id together in
-- both directions; generateSessionToken refuses the same pairing before any SQL.
-- MySQL 8.4 refuses a CHECK only over a foreign-key column whose referential
-- action is ON UPDATE CASCADE or ON DELETE SET NULL (error 3823); ON DELETE
-- CASCADE, as used here, is allowed. tests/integration/identities.test.js pins both.
--
-- Additive for the data already present: every existing session keeps
-- auth_provider 'local' or 'google', and identity_id and provider_sid are NULL.
-- Not idempotent (a second application fails with a duplicate table or column,
-- which the runner explains). To undo it, on an install with no OIDC sessions:
--   ALTER TABLE sessions DROP FOREIGN KEY fk_sessions_identity,
--     DROP INDEX idx_sessions_provider_sid, DROP COLUMN provider_sid,
--     DROP COLUMN identity_id, DROP CHECK chk_sessions_identity_pairing,
--     DROP CHECK chk_sessions_auth_provider,
--     ADD CONSTRAINT chk_sessions_auth_provider CHECK (auth_provider IN ('local', 'google'));
--   DROP TABLE user_identities;

CREATE TABLE user_identities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  issuer VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  email_at_link VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_user_identities_issuer_subject (issuer, subject),
  UNIQUE KEY uq_user_identities_user_issuer (user_id, issuer)
) ENGINE=InnoDB;

ALTER TABLE sessions
  ADD COLUMN identity_id INT NULL AFTER auth_provider,
  ADD COLUMN provider_sid VARCHAR(255) NULL AFTER identity_id,
  ADD INDEX idx_sessions_provider_sid (provider_sid),
  ADD CONSTRAINT fk_sessions_identity
    FOREIGN KEY (identity_id) REFERENCES user_identities(id) ON DELETE CASCADE;

ALTER TABLE sessions DROP CHECK chk_sessions_auth_provider;

ALTER TABLE sessions
  ADD CONSTRAINT chk_sessions_auth_provider CHECK (auth_provider IN ('local', 'google', 'oidc')),
  ADD CONSTRAINT chk_sessions_identity_pairing
    CHECK ((auth_provider = 'oidc') = (identity_id IS NOT NULL));

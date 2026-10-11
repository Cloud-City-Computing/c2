-- The sealed OIDC ID token a sign-out sends back to the issuer (W6-CDX-6).
--
-- An OIDC session keeps the ID token its sign-in received, sealed with AES-256-GCM
-- (services/id-token-seal.js), so POST /api/logout can send it as id_token_hint. Without the hint the
-- issuer shows an account picker and ends nothing; with it the one session ends at once. The column
-- holds the sealed form only (iv:tag:ciphertext, hex), never the token itself.
--
-- chk_sessions_id_token_oidc_only: a sealed token belongs to an oidc session and nothing else. It does
-- not require one: sessions signed in before this migration keep NULL, and their sign-out ends locally.
--
-- Additive: every existing row gets NULL. Not idempotent. To undo it:
--   ALTER TABLE sessions DROP CHECK chk_sessions_id_token_oidc_only, DROP COLUMN oidc_id_token;

ALTER TABLE sessions
  ADD COLUMN oidc_id_token TEXT NULL AFTER provider_sid;

ALTER TABLE sessions
  ADD CONSTRAINT chk_sessions_id_token_oidc_only
    CHECK (oidc_id_token IS NULL OR auth_provider = 'oidc');

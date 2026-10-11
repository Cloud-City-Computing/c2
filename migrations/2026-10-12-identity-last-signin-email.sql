-- The issuer's email at the identity's most recent sign-in, for display and audit (W6-CDX-5).
--
-- A sign-in through an identity never writes users.email. The issuer's verified email can
-- change, and users.email is the address password reset mails and the local email-change rules
-- guard; following the issuer would let a change there reach the local account (see the ladder in
-- services/identity.js). This column records what the issuer last said, and nothing reads it for
-- authority.
--
-- Additive: existing identity rows get NULL until their next sign-in. Not idempotent. To undo it:
--   ALTER TABLE user_identities DROP COLUMN email_at_last_signin;

ALTER TABLE user_identities
  ADD COLUMN email_at_last_signin VARCHAR(255) NULL AFTER email_at_link;

/**
 * How to take an init.sql schema back to the pre-runner state
 *
 * The per-file setup ADOPTS every migration file (adoptFreshInstall records
 * each one and runs none), so on its own this project never executes a
 * migration file's SQL. The upgrade-path test does: it builds init.sql,
 * removes what every post-baseline file adds (the statements below, applied
 * newest first), records the pre-runner baseline, and then lets the runner
 * apply every newer file for real. The result must match a fresh init.sql
 * build exactly.
 *
 * Every migration file that is not in LEGACY_BASELINE needs an entry here,
 * and the upgrade-path test fails until it has one. The statement undoes that
 * file's change on a schema init.sql built, and nothing else.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

export const UNDO_ON_INIT_SQL = Object.freeze({
  '2026-09-08-token-purpose.sql':
    'ALTER TABLE password_reset_tokens DROP CHECK chk_password_reset_tokens_purpose, DROP COLUMN purpose',
  '2026-09-25-oauth-one-link-per-provider.sql':
    'ALTER TABLE oauth_accounts DROP INDEX uq_oauth_user_provider',
  '2026-09-25-token-purpose-email-change.sql':
    'ALTER TABLE password_reset_tokens DROP CHECK chk_password_reset_tokens_new_email, ' +
    'DROP CHECK chk_password_reset_tokens_purpose, DROP COLUMN new_email, ' +
    'ADD CONSTRAINT chk_password_reset_tokens_purpose ' +
    "CHECK (purpose IN ('password_reset','two_factor_login','totp_setup','two_factor_disable'))",
  '2026-09-27-session-per-sign-in.sql':
    'ALTER TABLE sessions DROP CHECK chk_sessions_auth_provider, DROP COLUMN auth_provider',
  '2026-09-27-who-may-see-doc-images.sql': 'DROP TABLE doc_images',
  '2026-09-28-webhooks.sql': 'DROP TABLE webhook_deliveries, webhook_events, webhook_subscriptions',
  '2026-10-10-webhook-sequence-lock.sql': 'DROP TABLE webhook_sequence_lock',
  '2026-10-15-invitation-grants-admin.sql': 'ALTER TABLE user_invitations DROP COLUMN grants_admin',
  '2026-10-14-session-rotation.sql':
    'ALTER TABLE sessions DROP INDEX idx_sessions_rotated_from, DROP COLUMN rotated_from, DROP COLUMN signed_in_at',
  '2026-10-13-session-id-token.sql':
    'ALTER TABLE sessions DROP CHECK chk_sessions_id_token_oidc_only, DROP COLUMN oidc_id_token',
  '2026-10-12-identity-last-signin-email.sql': 'ALTER TABLE user_identities DROP COLUMN email_at_last_signin',
  '2026-10-12-user-deactivation.sql': 'ALTER TABLE users DROP COLUMN deactivated_at',
  '2026-10-11-user-identities.sql':
    'ALTER TABLE sessions DROP FOREIGN KEY fk_sessions_identity, DROP INDEX idx_sessions_provider_sid, ' +
    'DROP COLUMN provider_sid, DROP COLUMN identity_id, DROP CHECK chk_sessions_identity_pairing, ' +
    'DROP CHECK chk_sessions_auth_provider, ' +
    "ADD CONSTRAINT chk_sessions_auth_provider CHECK (auth_provider IN ('local', 'google')); " +
    'DROP TABLE user_identities',
});

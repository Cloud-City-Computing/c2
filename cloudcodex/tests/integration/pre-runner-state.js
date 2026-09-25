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
});

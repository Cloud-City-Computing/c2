/**
 * Every environment variable the server reads, and how each behaves when unset
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

// Data only, no imports: a paired product pins a copy of this file and reads it.
//
// kind: 'required' (boot exits without it), 'required-in-production' (boot
// exits without it when NODE_ENV=production), 'default' (unset or blank behaves as
// `default`) or 'optional' (unset turns something off, or keeps a documented
// behaviour). requiredWith, on an optional entry: boot requires it whenever
// the variable it names is set.
//
// perInstance: linking the instance to its workspace supplies the value (its host,
// credentials, issuer application, webhook subscription and suite link), not the
// deployment's env template, the database provisioning step or a default.
//
// tests/env-contract.test.js fails when the server reads a variable that has
// no entry here, or when an entry names a variable nothing reads.
export const ENV_CONTRACT = [
  // Database
  { name: 'DB_HOST', kind: 'default', default: 'localhost', perInstance: false,
    why: 'the MySQL host; the compose files set it to the database service' },
  { name: 'DB_NAME', kind: 'default', default: 'c2', perInstance: false,
    why: 'the MySQL schema, one per instance, chosen when the database is provisioned' },
  { name: 'DB_USER', kind: 'required', perInstance: false, why: 'the MySQL user the app connects as' },
  { name: 'DB_PASS', kind: 'required', perInstance: false, why: 'that MySQL user\'s password' },
  { name: 'DB_POOL_SIZE', kind: 'default', default: '10', perInstance: false,
    why: 'mysql2 connectionLimit, an integer from 1 to 100; anything else exits at boot' },

  // The app
  { name: 'APP_URL', kind: 'required-in-production', perInstance: true,
    why: 'invitation, reset and notification links, and the CORS allow rule; '
      + 'development falls back to http://localhost:3000' },
  { name: 'PORT', kind: 'default', default: '3000', perInstance: false,
    why: 'the port the app listens on; an invalid value exits at boot' },
  { name: 'NODE_ENV', kind: 'optional', perInstance: false,
    why: 'production serves the built app, arms the rate limiters and puts the security headers '
      + 'on every response; the Docker image and npm run start set it' },
  { name: 'TRUST_PROXY', kind: 'default', default: '1', perInstance: false,
    why: 'Express trust proxy (a hop count, true, false, or an address list such as loopback), '
      + 'which decides req.ip for the rate limiters; an invalid value exits at boot' },
  { name: 'CORS_ORIGIN', kind: 'optional', perInstance: false,
    why: 'one more origin allowed to call the API; the app\'s own origin and APP_URL always are' },
  { name: 'C2_INSTANCE_LOCK', kind: 'default', default: '1', perInstance: false,
    why: 'the single-writer lock, one process per schema; only 0 disables it' },
  { name: 'DOC_IMAGES_PUBLIC', kind: 'optional', perInstance: false,
    why: 'exactly 1 serves document images to anyone with the address, as before; only for an '
      + 'upgrade that must start before npm run backfill:doc-images has run' },

  // The boot admin
  { name: 'ADMIN_USERNAME', kind: 'required', perInstance: false,
    why: 'the boot admin\'s name: created, or an existing admin synced, never a non-admin promoted' },
  { name: 'ADMIN_PASSWORD', kind: 'required', perInstance: false,
    why: 'the boot admin\'s password, reset at every boot' },
  { name: 'ADMIN_EMAIL', kind: 'required', perInstance: false,
    why: 'the boot admin\'s email, reset at every boot; the operator\'s address' },

  // Mail
  { name: 'SMTP_HOST', kind: 'optional', perInstance: false,
    why: 'with SMTP_USER and SMTP_PASS, turns email on; without them invitations show a copyable '
      + 'link and password reset is unavailable' },
  { name: 'SMTP_PORT', kind: 'default', default: '587', perInstance: false,
    why: 'the SMTP port; 465 means implicit TLS' },
  { name: 'SMTP_USER', kind: 'optional', perInstance: false, why: 'the SMTP login' },
  { name: 'SMTP_PASS', kind: 'optional', perInstance: false, why: 'the SMTP password' },
  { name: 'SMTP_FROM', kind: 'default', default: 'Cloud Codex <noreply@cloudcitycomputing.com>',
    perInstance: false, why: 'the From address on every email' },

  // Sign-in
  { name: 'AUTH_PROVIDERS', kind: 'optional', perInstance: false,
    why: 'the sign-in methods offered; unset is local, plus google when Google is configured' },
  { name: 'GOOGLE_CLIENT_ID', kind: 'optional', perInstance: false,
    why: 'with GOOGLE_CLIENT_SECRET, turns Google sign-in on' },
  { name: 'GOOGLE_CLIENT_SECRET', kind: 'optional', perInstance: false,
    why: 'the Google OAuth client secret' },
  { name: 'GOOGLE_OAUTH_DOMAIN', kind: 'optional', perInstance: false,
    why: 'a Google Workspace domain whose users may sign up without an invitation' },
  { name: 'GITHUB_CLIENT_ID', kind: 'optional', perInstance: false,
    why: 'with GITHUB_CLIENT_SECRET, turns the GitHub integration on' },
  { name: 'GITHUB_CLIENT_SECRET', kind: 'optional', perInstance: false,
    why: 'the GitHub OAuth secret, and the seed of the key that encrypts stored GitHub tokens' },

  // Machine access
  { name: 'SERVICE_TOKEN', kind: 'optional', perInstance: true,
    why: 'the machine credential for GET /api/search, GET /api/browse and GET /api/documents/state, '
      + 'at least 32 characters' },
  { name: 'SERVICE_TOKEN_USER', kind: 'optional', perInstance: true,
    why: 'the email of the existing non-admin user whose access the machine credential acts with' },
];

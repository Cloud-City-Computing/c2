/**
 * Every environment variable the server reads, and how each behaves when unset
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

// Data only, no imports: a paired product pins a copy of this file and reads it.
//
// kind: 'required' (boot exits without it), 'required-in-production' (boot
// exits without it when NODE_ENV=production), 'required-with-local' (boot exits without it
// while local sign-in is on, which AUTH_PROVIDERS decides), 'default' (unset or blank behaves as
// `default`), 'optional' (unset turns something off, or keeps a documented
// behaviour) or 'removed' (no longer read for any behaviour: boot prints one line naming the
// variable and `why` when it is set, then starts; it stays listed for at least one minor release,
// and out of .env.example and the Environment Variables table). requiredWith, on an optional
// entry: boot requires it whenever the variable it names is set.
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
    why: 'production serves the built app, puts the security headers on every response, requires '
      + 'APP_URL and stops allowing localhost origins; the rate limiters are on in every mode but '
      + 'test; the Docker image and npm run start set it' },
  { name: 'TRUST_PROXY', kind: 'default', default: '127.0.0.1/32, ::1/128, 172.29.0.1/32',
    perInstance: false,
    why: 'Express trust proxy, which decides req.ip for the rate limiters: a list of addresses, CIDRs '
      + 'and subnet names whose X-Forwarded-For is believed, or false; the default names loopback and '
      + 'the pinned compose network\'s gateway, and nothing else. A hop count, true, or a range wider '
      + 'than an IPv4 /8, wider than an IPv6 /16 outside fc00::/7 and fe80::/10, or holding more than '
      + 'an IPv4 /8 of ::ffff:0:0/96 exits at boot unless TRUST_PROXY_ALLOW_HOP_COUNT is true; an '
      + 'entry in non-standard notation, or a value Express cannot parse, always does' },
  { name: 'TRUST_PROXY_ALLOW_HOP_COUNT', kind: 'optional', perInstance: false,
    why: 'true lets TRUST_PROXY be a hop count, true or an over-wide range, accepting that any client '
      + 'able to reach the app\'s port can then choose its own address; anything but true, false or blank '
      + 'exits at boot' },
  { name: 'CORS_ORIGIN', kind: 'optional', perInstance: false,
    why: 'one more origin allowed to call the API; the app\'s own origin and APP_URL always are' },
  { name: 'C2_INSTANCE_LOCK', kind: 'default', default: '1', perInstance: false,
    why: 'the single-writer lock, one process per schema; only 0 disables it' },
  { name: 'DOC_IMAGES_PUBLIC', kind: 'optional', perInstance: false,
    why: 'exactly 1 serves document images to anyone with the address, as before; only for an '
      + 'upgrade that must start before npm run backfill:doc-images has run' },

  // The boot admin
  { name: 'ADMIN_USERNAME', kind: 'required-with-local', perInstance: false,
    why: 'the boot admin\'s name: created, or an existing admin synced, never a non-admin promoted; required '
      + 'while local sign-in is on, and on a hosted instance (no local) unset means a name derived from ADMIN_EMAIL' },
  { name: 'ADMIN_PASSWORD', kind: 'required-with-local', perInstance: false,
    why: 'the boot admin\'s password, reset at every boot; required while local sign-in is on, and never read on a '
      + 'hosted instance' },
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
    why: 'the sign-in methods offered; unset is local, plus google and oidc when each is configured' },
  { name: 'GOOGLE_CLIENT_ID', kind: 'optional', perInstance: false,
    why: 'with GOOGLE_CLIENT_SECRET, turns Google sign-in on' },
  { name: 'GOOGLE_CLIENT_SECRET', kind: 'optional', perInstance: false,
    why: 'the Google OAuth client secret' },
  { name: 'GOOGLE_OAUTH_DOMAIN', kind: 'optional', perInstance: false,
    why: 'a Google Workspace domain whose users may sign up without an invitation' },
  { name: 'OIDC_ISSUER_URL', kind: 'optional', perInstance: true,
    why: 'the OIDC issuer this instance signs people in through, https or plain http on loopback; with '
      + 'OIDC_CLIENT_ID and OIDC_CLIENT_SECRET, turns OIDC sign-in on; the issuer application is per instance' },
  { name: 'OIDC_CLIENT_ID', kind: 'optional', requiredWith: 'OIDC_ISSUER_URL', perInstance: true,
    why: 'the client id of this instance\'s application at the issuer; boot requires it when OIDC_ISSUER_URL is set' },
  { name: 'OIDC_CLIENT_SECRET', kind: 'optional', requiredWith: 'OIDC_ISSUER_URL', perInstance: true,
    why: 'that application\'s client secret, which also keys the signature on the sign-in flow cookie' },
  { name: 'OIDC_PROVIDER_NAME', kind: 'default', default: 'SSO', perInstance: false,
    why: 'the label on the sign-in button, "Sign in with <name>"' },
  { name: 'OIDC_ACCOUNT_URL', kind: 'removed', perInstance: true,
    why: 'accounts are editable in Codex now; unset it' },
  { name: 'OIDC_LINK_BY_VERIFIED_EMAIL', kind: 'default', default: '1', perInstance: false,
    why: '1 links an existing account to the issuer identity by its verified email when that account has '
      + 'two-factor off; 0 never links by email; any other value exits at boot' },
  { name: 'OIDC_SESSION_TTL_HOURS', kind: 'default', default: '24', perInstance: false,
    why: 'how long an OIDC sign-in lasts, in whole hours; a value that is not a positive whole number exits at boot' },
  { name: 'LEGACY_SESSION_COOKIE', kind: 'default', default: '1', perInstance: false,
    why: 'whether a lone sessionToken cookie from before __Host-sessionToken still signs its '
      + 'holder in; only 0 turns it off, which a hosted instance on https sets' },
  { name: 'GITHUB_CLIENT_ID', kind: 'optional', perInstance: false,
    why: 'with GITHUB_CLIENT_SECRET, turns the GitHub integration on' },
  { name: 'GITHUB_CLIENT_SECRET', kind: 'optional', perInstance: false,
    why: 'the GitHub OAuth secret, and the seed of the key that encrypts stored GitHub tokens' },

  // Removed in 0.15.0 (the machine credential and its JWT path). Read for nothing; boot names each one that is set.
  { name: 'SERVICE_TOKEN', kind: 'removed', perInstance: true,
    why: 'the static machine credential was removed in 0.15.0; a script signs in as a user and sends that '
      + 'session. Unset it' },
  { name: 'SERVICE_TOKEN_USER', kind: 'removed', perInstance: true,
    why: 'the machine credential\'s account was removed in 0.15.0; the account stays an ordinary user. Unset it' },
  { name: 'MACHINE_OIDC_AUDIENCE', kind: 'removed', perInstance: true,
    why: 'machine JWTs were removed in 0.15.0; the OIDC sign-in for people is unaffected. Unset it' },
  { name: 'MACHINE_OIDC_SUBJECTS', kind: 'removed', perInstance: true,
    why: 'machine JWTs were removed in 0.15.0; the OIDC sign-in for people is unaffected. Unset it' },

  // Removed in 0.15.0 (the suite integration). Read for nothing; boot names each one that is still set.
  { name: 'SUITE_COMMAND_WORKSPACE_URL', kind: 'removed', perInstance: true,
    why: 'suite mode was removed in 0.15.0. Accounts linked to an identity provider now accept a local password '
      + 'and local two-factor; set AUTH_PROVIDERS=oidc to keep sign-in provider-only. Unset it' },
  { name: 'SUITE_NAME', kind: 'removed', perInstance: true,
    why: 'suite mode was removed in 0.15.0; unset it' },
  { name: 'SUITE_PREFERENCE_DOMAIN', kind: 'removed', perInstance: true,
    why: 'the theme and accent preference is per host now; unset it' },

  // Outbound webhooks
  { name: 'WEBHOOK_URL', kind: 'optional', perInstance: true,
    why: 'with WEBHOOK_SECRET, the receiver the env-declared subscription sends events to; either unset '
      + 'disables that subscription at boot' },
  { name: 'WEBHOOK_SECRET', kind: 'optional', perInstance: true,
    why: 'the env subscription\'s signing secret, at least 32 characters, read from the environment '
      + 'and never stored' },
  { name: 'WEBHOOK_WORKSPACE_ID', kind: 'optional', perInstance: true,
    why: 'limits the env subscription to one workspace\'s events; unset sends every workspace\'s, '
      + 'a value that is not a whole number disables it, and one that names no workspace matches nothing' },
  { name: 'WEBHOOK_ALLOW_PRIVATE_TARGETS', kind: 'optional', perInstance: false,
    why: 'exactly 1 lets any webhook, the env one and admin-created ones, reach loopback and private '
      + 'addresses; link-local and metadata addresses stay refused' },
];

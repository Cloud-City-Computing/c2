/**
 * Which sign-in methods this instance offers, and the hosted rule that a list without local enforces
 *
 * AUTH_PROVIDERS decides the human sign-in methods. Unset keeps today's derived set: local always,
 * google when its two variables are set, oidc when an issuer is set. A list without local is hosted
 * mode: OIDC is then the only human sign-in, so the list must name oidc, must not name google, and the
 * Google variables must be unset. The non-throwing readers below are called on every request
 * (validateAndAutoLogin, the local route guards), so they never validate: parseAuthProviders() does,
 * once, at boot.
 *
 * This module imports nothing, so the database layer can read the mode without a cycle through
 * services/identity.js.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/** Sign-in providers this version knows. */
export const KNOWN_AUTH_PROVIDERS = ['local', 'google', 'oidc'];

/** The names in AUTH_PROVIDERS, trimmed and lowercased, blanks dropped. Empty when unset. */
function listedNames() {
  const raw = process.env.AUTH_PROVIDERS;
  if (raw === undefined || raw.trim() === '') return null;
  return raw.split(',').map((name) => name.trim().toLowerCase()).filter((name) => name !== '');
}

/**
 * Google counts as configured on the same rule routes/oauth.js applies: both the client id and the
 * secret set. Read at call time, by literal name.
 */
function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** The OIDC relying party counts as configured when an issuer is set. */
function isOidcConfigured() {
  const issuer = process.env.OIDC_ISSUER_URL;
  return issuer !== undefined && issuer.trim() !== '';
}

/**
 * The sign-in providers this instance offers, read without validation. Unset or blank: the derived
 * set. Set: the names as listed (unknown names included, which parseAuthProviders refuses at boot).
 * @returns {Set<string>}
 */
export function offeredProviders() {
  const names = listedNames();
  if (names === null) {
    return new Set([
      'local',
      ...(isGoogleConfigured() ? ['google'] : []),
      ...(isOidcConfigured() ? ['oidc'] : []),
    ]);
  }
  return new Set(names);
}

/**
 * Whether local sign-in (password, sign-up, reset, 2FA, local email change) is on. False is hosted
 * mode: AUTH_PROVIDERS is set and does not list local.
 * @returns {boolean}
 */
export function localSignInEnabled() {
  return offeredProviders().has('local');
}

/**
 * The boot-time check of AUTH_PROVIDERS. Each refusal is a sentence that opens with the variable.
 * @returns {Set<string>} the offered providers
 * @throws {Error} on an unknown name, an empty list, a listed provider that is not configured, a
 *   configured one the list leaves out, or a hosted list that breaks the OIDC-only rule
 */
export function parseAuthProviders() {
  const googleConfigured = isGoogleConfigured();
  const oidcConfigured = isOidcConfigured();
  const names = listedNames();

  if (names === null) {
    return offeredProviders();
  }

  for (const name of names) {
    if (!KNOWN_AUTH_PROVIDERS.includes(name)) {
      throw new Error(
        `AUTH_PROVIDERS lists "${name}", which is not a sign-in provider this version knows; ` +
        `use a comma list of ${KNOWN_AUTH_PROVIDERS.join(' and ')}, or leave AUTH_PROVIDERS unset.`
      );
    }
  }

  if (names.length === 0) {
    throw new Error('AUTH_PROVIDERS lists no sign-in provider; list local, or leave AUTH_PROVIDERS unset.');
  }

  const providers = new Set(names);

  if (!providers.has('local')) {
    // Hosted mode. OIDC is the only human sign-in, so the list must be oidc and nothing else that signs
    // people in, and the Google variables must not offer a second door.
    if (!providers.has('oidc')) {
      throw new Error(
        'AUTH_PROVIDERS without local is hosted mode, which is OIDC only: list oidc, or add local.'
      );
    }
    if (providers.has('google')) {
      throw new Error(
        'AUTH_PROVIDERS lists google, but a hosted instance (no local) is OIDC only; remove google.'
      );
    }
    if (googleConfigured) {
      throw new Error(
        'AUTH_PROVIDERS is hosted (no local), so the Google variables GOOGLE_CLIENT_ID and ' +
        'GOOGLE_CLIENT_SECRET must be unset.'
      );
    }
  }

  if (providers.has('google') && !googleConfigured) {
    throw new Error(
      'AUTH_PROVIDERS lists google, but GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not both ' +
      'set; set them, or remove google from AUTH_PROVIDERS.'
    );
  }

  if (!providers.has('google') && googleConfigured) {
    throw new Error(
      'AUTH_PROVIDERS does not list google, but GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are ' +
      'set, so Google sign-in would still be offered; add google to AUTH_PROVIDERS, or unset ' +
      'the Google variables.'
    );
  }

  if (providers.has('oidc') && !oidcConfigured) {
    throw new Error(
      'AUTH_PROVIDERS lists oidc, but OIDC_ISSUER_URL is not set; set the OIDC_ variables, or ' +
      'remove oidc from AUTH_PROVIDERS.'
    );
  }

  if (!providers.has('oidc') && oidcConfigured) {
    throw new Error(
      'AUTH_PROVIDERS does not list oidc, but OIDC_ISSUER_URL is set, so OIDC sign-in would still ' +
      'be offered; add oidc to AUTH_PROVIDERS, or unset OIDC_ISSUER_URL.'
    );
  }

  return providers;
}

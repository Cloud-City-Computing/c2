/**
 * The RP-initiated logout URL: where a sign-out sends the browser so the issuer ends its session (W6-CDX-6)
 *
 * The URL carries the stored ID token as id_token_hint. Without it the issuer shows an account picker
 * and ends nothing, so the hint is what makes the sign-out reach the issuer at all. Every failure
 * answers url null with a short reason, and the caller still ends the local session: a sign-out never
 * fails because the issuer could not be reached.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import * as client from 'openid-client';
import { loadConfiguration } from './oidc.js';
import { openIdToken } from './id-token-seal.js';

/** How long a sign-out waits for the issuer's discovery document before it gives up on the URL. */
export const END_SESSION_LOOKUP_MS = 3000;

/**
 * Builds the end-session URL for a sealed ID token.
 * @param {ReturnType<typeof import('./oidc.js').getOidcConfig>} config - non-null
 * @param {string | null | undefined} sealedIdToken - the session's sealed ID token, if it kept one
 * @returns {Promise<{ url: string | null, failure: null | 'no_hint' | 'timeout' | 'discovery' | 'no_end_session' }>}
 */
export async function endSessionUrlFor(config, sealedIdToken) {
  const idToken = openIdToken(sealedIdToken, config.clientSecret);
  if (idToken === null) return { url: null, failure: 'no_hint' };

  let configuration;
  try {
    configuration = await within(loadConfiguration(config), END_SESSION_LOOKUP_MS);
  } catch (err) {
    return { url: null, failure: err.name === 'DeadlineExceeded' ? 'timeout' : 'discovery' };
  }

  try {
    const url = client.buildEndSessionUrl(configuration, {
      id_token_hint: idToken,
      post_logout_redirect_uri: new URL('/?signedOut=1', config.appUrl).href,
      state: client.randomState(),
    });
    return { url: url.href, failure: null };
  } catch {
    return { url: null, failure: 'no_end_session' };
  }
}

/**
 * Rejects with a DeadlineExceeded error if the promise has not settled within ms.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function within(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('the issuer did not answer in time');
      err.name = 'DeadlineExceeded';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

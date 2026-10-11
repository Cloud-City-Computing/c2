/**
 * Seals and opens the OIDC ID token a sign-out needs, with AES-256-GCM
 *
 * The ID token is the one value end_session needs as id_token_hint (W6-CDX-6), and it is a
 * credential-shaped value, so it is never stored in the clear. The key is derived from
 * OIDC_CLIENT_SECRET with scrypt, the same construction routes/oauth.js uses for GitHub tokens,
 * so no new variable is needed. Rotating the client secret makes stored tokens unopenable; a
 * sign-out then ends the local session only, and says so in the log. It never locks anyone out.
 *
 * Stored form: iv:tag:ciphertext, each part hex (iv 12 bytes, tag 16 bytes).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const CIPHER = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT = 'cloudcodex-oidc-id-token';

/** The key for the last secret seen: derived once per process, not once per sign-out. */
let cachedKey = null;

/**
 * @param {string} clientSecret
 * @returns {Buffer}
 */
function keyFor(clientSecret) {
  if (cachedKey === null || cachedKey.secret !== clientSecret) {
    cachedKey = { secret: clientSecret, key: scryptSync(clientSecret, SALT, KEY_LENGTH) };
  }
  return cachedKey.key;
}

/**
 * @param {string} plaintext - the raw ID token
 * @param {string} clientSecret - OIDC_CLIENT_SECRET
 * @returns {string} iv:tag:ciphertext, hex
 */
export function sealIdToken(plaintext, clientSecret) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(CIPHER, keyFor(clientSecret), iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Opens a sealed value. Answers null, and never throws, for a missing, malformed, tampered or
 * foreign-keyed value: the caller treats them all as "no hint to send".
 * @param {string | null | undefined} sealed
 * @param {string} clientSecret
 * @returns {string | null}
 */
export function openIdToken(sealed, clientSecret) {
  if (typeof sealed !== 'string') return null;
  const parts = sealed.split(':');
  if (parts.length !== 3) return null;
  const [ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ctHex, 'hex');
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH || ciphertext.length === 0) return null;
  try {
    const decipher = createDecipheriv(CIPHER, keyFor(clientSecret), iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

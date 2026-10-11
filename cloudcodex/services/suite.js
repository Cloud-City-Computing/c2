/**
 * Suite mode: whether this instance belongs to a suite, and what the suite is called
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

const NAME_MAX = 40;

/**
 * Reads and validates both settings. Off unless SUITE_COMMAND_WORKSPACE_URL is set; with it on,
 * SUITE_NAME is required. Throws the sentence boot prints; the caller decides to exit.
 *
 * Reads process.env by literal name, never through a parameter, so the configuration-contract
 * scan (tests/env-contract.test.js) sees both variables. Tests set process.env.
 */
export function readSuiteConfig() {
  const raw = process.env.SUITE_COMMAND_WORKSPACE_URL?.trim();
  if (!raw) return { enabled: false, name: null, commandWorkspaceUrl: null };

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('SUITE_COMMAND_WORKSPACE_URL is not a URL.');
  }
  const production = process.env.NODE_ENV === 'production';
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && !production)) || url.username || url.password) {
    throw new Error('SUITE_COMMAND_WORKSPACE_URL must be https (http only outside production), with no user or password.');
  }

  const name = process.env.SUITE_NAME?.trim() ?? '';
  // eslint-disable-next-line no-control-regex
  if (!name || name.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error(`SUITE_NAME is required in suite mode: 1 to ${NAME_MAX} characters, no control characters.`);
  }
  return { enabled: true, name, commandWorkspaceUrl: url.href };
}

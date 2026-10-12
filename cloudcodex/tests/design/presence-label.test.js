/**
 * The label on a presence cursor or avatar is the one avatarLabel() chooses, resolved through each theme's tokens
 * (W6-CDX-43 review, item 1): a fixed white on the cursor colours fails 4.5:1 on nine of the ten.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  contrastRatio, parseColor, parseThemeTokens, resolveTokenValue, round,
} from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { CURSOR_COLORS } from '../../services/cursor-colors.js';
import { avatarLabel } from '../../src/lib/avatar-label.js';
import { ROOT, THEME_NAMES, THEME_OPTIONS } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const index = read('src/index.css');
const bridgeBlock = /:root\s*\{([^}]*)\}/.exec(index)[1];
const themed = parseThemeTokens(
  `${read('vendor/cloud-city-design/core.css')}\n${read('src/codex.css')}\n:root {${bridgeBlock}}`,
  THEME_OPTIONS,
);

/** The colour a label variable paints in a theme. */
function paintOf(value, tokens) {
  const v = /^var\((--[\w-]+)\)$/.exec(value);
  const raw = v ? resolveTokenValue(tokens, v[1]) : value;
  const colour = parseColor(raw);
  if (colour === undefined) throw new Error(`${value} does not paint a colour`);
  return colour;
}

describe.each(THEME_NAMES)('the presence label, %s theme', (theme) => {
  const tokens = themed[theme];

  it.each(CURSOR_COLORS)('%s: the label avatarLabel() chooses clears 4.5:1 with the real token', (bg) => {
    const { color } = avatarLabel(bg);
    const ratio = contrastRatio(paintOf(color, tokens), parseColor(bg));
    expect(ratio, `${bg} with ${color} measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the presence surfaces take their label from avatarLabel()', () => {
  it('paints the remote cursor label and the avatars through labelStyle, never a fixed colour', () => {
    const remote = read('src/components/RemoteCursors.jsx');
    const presence = read('src/components/CollabPresence.jsx');
    expect(remote.match(/remote-cursor__label" style=\{labelStyle\(cursor\.color\)\}/g)?.length).toBe(2);
    expect(presence.match(/labelStyle\(u\.color\)/g)?.length).toBe(2);
  });

  it('declares no fixed white colour on the label or the avatar in index.css (the inline label colour is the one)', () => {
    const rule = (selector) => new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(index)?.[1] ?? '';
    expect(rule('.collab-avatar')).not.toMatch(/(^|;|\s)color\s*:/);
    expect(rule('.remote-cursor__label')).not.toMatch(/(^|;|\s)color\s*:/);
  });
});

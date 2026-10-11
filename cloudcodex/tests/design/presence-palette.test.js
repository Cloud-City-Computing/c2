/**
 * Every presence colour carries a label that clears 4.5:1, measured over the whole palette
 *
 * A user's cursor colour is the background of their presence avatar (PresenceAvatars.jsx), and the
 * initial on it is the label. avatarLabel() picks white, the dark ink (--cx-on-accent), or black,
 * whichever is the first to clear 4.5:1. This test walks every colour the server hands out
 * (services/cursor-colors.js), resolves each label through the real tokens and measures it with the
 * vendored contrast gate, so a palette colour that no label clears turns the named test red.
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
import { avatarLabel, INK_HEX } from '../../src/lib/avatar-label.js';
import { ROOT } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const tokens = parseThemeTokens(`${read('vendor/cloud-city-design/core.css')}\n${read('src/codex.css')}`).dark;

/** The colour a label variable paints, resolved through the tokens. */
function paintOf(value) {
  const v = /^var\((--[\w-]+)\)$/.exec(value);
  if (!v) return parseColor(value);
  const colour = parseColor(resolveTokenValue(tokens, v[1]));
  if (colour === undefined) throw new Error(`${value} does not resolve to a colour`);
  return colour;
}

describe('the presence palette', () => {
  it('is the ten cursor colours the server hands out, each a six-digit hex', () => {
    expect(CURSOR_COLORS).toHaveLength(10);
    for (const c of CURSOR_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('pins the ink constant to the --cx-on-accent token it stands for', () => {
    const token = paintOf('var(--cx-on-accent)');
    const hex = parseColor(INK_HEX);
    expect(round(contrastRatio(hex, parseColor('#fff')), 1))
      .toBe(round(contrastRatio(token, parseColor('#fff')), 1));
  });

  it.each(CURSOR_COLORS)('%s: the chosen label clears 4.5:1 on it', (bg) => {
    const { color } = avatarLabel(bg);
    const ratio = contrastRatio(paintOf(color), parseColor(bg));
    expect(ratio, `${bg} with ${color} measures ${round(ratio, 2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

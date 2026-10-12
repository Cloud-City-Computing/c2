/**
 * A status edge names its status, not the picked accent, so it cannot be mistaken for the danger edge
 *
 * The GitHub sync banner's info tone once borrowed the picked accent. Under a red-adjacent pick (nova,
 * hue 355) it read as the danger tone beside it. The info edge is --cx-info, a fixed step that does not
 * follow the picker, and it sits well away from the danger hue on every accent. Read from the real
 * declarations in src/index.css and src/codex.css. A revert to --cx-accent turns the named test red.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseThemeTokens, resolveTokenValue } from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { ACCENTS } from '../../src/tokens/accents.js';
import { ROOT, THEME_OPTIONS, THEME_NAMES } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const core = read('vendor/cloud-city-design/core.css');
const codex = read('src/codex.css');
const index = read('src/index.css');
const themed = parseThemeTokens(`${core}\n${codex}`, THEME_OPTIONS);
describe.each(THEME_NAMES)('%s theme', (theme) => {
  const tokens = themed[theme];


  function declared(selector, prop) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let value;
    for (const m of index.matchAll(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`, 'g'))) {
      for (const d of m[1].matchAll(/(?:^|;|\s)([a-z-]+)\s*:\s*([^;]+);/g)) {
        if (d[1] === prop) value = d[2].trim();
      }
    }
    if (value === undefined) throw new Error(`${selector} declares no ${prop} in src/index.css`);
    return value;
  }

  // The OKLCH hue of a token that resolves to an oklch() literal, read from the palette value.
  const hueOf = (token) => {
    const value = resolveTokenValue(tokens, token);
    const m = /^oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)/.exec(value);
    if (!m) throw new Error(`${token} is not an oklch() value: ${value}`);
    return Number(m[1]);
  };

  describe('the sync banner info edge is the info status, not the picked accent', () => {
    it('reads the info edge from its real declaration, and it is the info token', () => {
      expect(declared('.gh-sync-banner--info', 'border-left-color')).toBe('var(--cx-info)');
    });

    it('keeps the info token off the accent: it is a fixed step, declared from the palette and not from --cx-accent', () => {
      expect(declared('.gh-sync-banner--info', 'border-left-color')).not.toMatch(/--cx-accent/);
      expect(codex).toMatch(/--cx-info:\s*var\(--accent-400\)/);
    });

    it('keeps the info edge a visibly different hue from the danger edge, on the default and every picker accent', () => {
      const danger = declared('.gh-sync-banner--danger', 'border-left-color');
      expect(danger).toBe('var(--cx-danger)');
      const info = declared('.gh-sync-banner--info', 'border-left-color');
      const infoHue = hueOf(/var\((--[\w-]+)\)/.exec(info)[1]);
      const dangerHue = hueOf(/var\((--[\w-]+)\)/.exec(danger)[1]);
      const gap = Math.abs(infoHue - dangerHue);
      expect(gap).toBeGreaterThanOrEqual(60);
      expect(Object.keys(ACCENTS).length).toBe(8);
    });
  });
});

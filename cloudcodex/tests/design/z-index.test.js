/**
 * Every stacking order in src/ is a token from the shared z-scale, never a raw number
 *
 * The scale is vendored in vendor/cloud-city-design/core.css (--z-base through --z-toast). The
 * floor of 12 is the count of distinct raw values the stylesheet held before W6-CDX-25, so a
 * scan that finds fewer declarations than that has stopped reading the files it should.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { scanTargets, relativePath, ROOT } from './buckets.js';
import { maskComments } from '../../vendor/cloud-city-design/gates/token-discipline.mjs';

const CORE = new URL('../../vendor/cloud-city-design/core.css', import.meta.url);
const SCALE = [...readFileSync(CORE, 'utf8').matchAll(/--(z-[a-z]+)\s*:/g)].map((m) => `--${m[1]}`);

// A CSS declaration, `z-index: value`, and a React style object key, `zIndex: value`.
const CSS_DECL = /(?<![\w-])z-index\s*:\s*([^;{}]+)/g;
const JS_KEY = /(?<![\w$])zIndex\s*:\s*([^,}\n]+)/g;

function declarations() {
  const found = { css: [], js: [] };
  for (const file of scanTargets()) {
    const rel = relativePath(file);
    const code = maskComments(readFileSync(file, 'utf8'));
    for (const m of code.matchAll(CSS_DECL)) found.css.push({ rel, value: m[1].trim() });
    for (const m of code.matchAll(JS_KEY)) found.js.push({ rel, value: m[1].trim().replace(/^['"]|['"]$/g, '') });
  }
  return found;
}

describe('stacking order', () => {
  it('the vendored scale has the seven named levels', () => {
    expect(SCALE).toEqual(['--z-base', '--z-sticky', '--z-scrim', '--z-modal', '--z-skip', '--z-menu', '--z-toast']);
  });

  it('every CSS z-index is a var() of a scale token', () => {
    const { css } = declarations();
    expect(css.length).toBeGreaterThanOrEqual(12);
    const raw = css.filter((d) => !/^var\(--z-[a-z]+\)$/.test(d.value));
    expect(raw.map((d) => `${d.rel}: z-index: ${d.value}`)).toEqual([]);
    for (const d of css) {
      const token = /^var\((--z-[a-z]+)\)$/.exec(d.value)[1];
      expect(SCALE).toContain(token);
    }
  });

  it('every React style zIndex is a var() of a scale token', () => {
    const { js } = declarations();
    expect(js.length).toBeGreaterThanOrEqual(2);
    const raw = js.filter((d) => !/^var\(--z-[a-z]+\)$/.test(d.value));
    expect(raw.map((d) => `${d.rel}: zIndex: ${d.value}`)).toEqual([]);
  });
});

// The layering the editor and the shell depend on, read from the real rules in src/index.css. A
// rule's z-index is the first one declared inside its own braces, so a bare `.mobile-nav { display: none }`
// is skipped and the media-query override is the one read.
const INDEX = readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
function ruleZ(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)[ \\t]*${esc}\\s*\\{[^}]*?z-index:\\s*var\\((--z-[a-z]+)\\)`).exec(INDEX);
  if (!m) throw new Error(`${selector} declares no z-index token in src/index.css`);
  return m[1];
}
const rank = (token) => SCALE.indexOf(token);

describe('the shell layers that the editor overlays depend on', () => {
  // The suite switcher's panel (.cc-suite__panel) lives inside .topbar and paints in the top bar's
  // stacking context. The sidebar is a sibling in the app grid, so it wins any tie of the same token
  // and covers a panel that hangs down over it. The top bar must be STRICTLY above the sidebar.
  it('the top bar sits strictly above the sidebar and the mobile bottom nav, so its dropdowns (the suite switcher) paint over both', () => {
    expect(rank(ruleZ('.topbar'))).toBeGreaterThan(rank(ruleZ('.mobile-nav')));
    expect(rank(ruleZ('.topbar'))).toBeGreaterThan(rank(ruleZ('.sidebar')));
  });

  it('the sidebar sits at base, so no sibling of the top bar can tie it and paint over the top bar\'s dropdowns', () => {
    expect(ruleZ('.sidebar')).toBe('--z-base');
  });

  it('the mobile bottom nav sits below the top bar, so a dropdown that reaches it stays on top', () => {
    expect(ruleZ('.mobile-nav')).toBe('--z-base');
  });

  // The collapsed sidebar's hover panel overlays the editor, so it alone is raised above the editor
  // overlays (comment highlights and remote cursors). The docked sidebar is in its own grid column.
  it('the hover-expanded sidebar is above the editor overlays (comment highlights and remote cursors), so its panel is not painted under them', () => {
    const hover = ruleZ('.sidebar-collapsed .sidebar:hover');
    expect(hover).toBe('--z-sticky');
    expect(rank(hover)).toBeGreaterThan(rank(ruleZ('.comment-highlights')));
    expect(rank(hover)).toBeGreaterThan(rank(ruleZ('.remote-cursors')));
  });
});

describe('the mobile bottom nav over the footer row it overlaps', () => {
  it('the footer is not a positioned box in the phone block that shows the nav, so the nav at base paints over it', () => {
    const phone = [...INDEX.matchAll(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}\n/g)]
      .map((m) => m[1]).find((block) => /\.mobile-nav \{/.test(block));
    expect(phone, 'the 768px block that shows .mobile-nav is in src/index.css').toBeDefined();
    expect(phone).toMatch(/\.log-footer \{\s*position:\s*static;/);
  });
});

// The phone strip (W6-CDX-44 review): every focusable item in the strip keeps its focus ring inside the strip's
// visible area. The ring is the item's outline, 2 px wide and 2 px out, so the outline box is the item's box grown by
// 4 px. jsdom has no layout, so this runs in a browser at a phone width.
//
// Inputs come from the environment, never from this file: BASE_URL, CDX_USER, CDX_PASSWORD, PW_MODULE, CHROME_PATH.
// Exits 1 if any focused item's outline box falls outside the strip. Writes strip-focus-check.json beside this file.

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PW_MODULE || 'playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL;
if (!BASE || !process.env.CDX_USER || !process.env.CDX_PASSWORD) {
  throw new Error('Set BASE_URL, CDX_USER and CDX_PASSWORD in the environment.');
}
mkdirSync(path.join(here, 'shots'), { recursive: true });

const login = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ username: process.env.CDX_USER, password: process.env.CDX_PASSWORD }),
});
if (!login.ok) throw new Error(`sign-in returned ${login.status}`);
const { token } = await login.json();

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const results = [];
// CONTROL=old reinstates the strip's previous spacing (no inline padding, no scroll padding), to show the check fails there.
const OLD_STRIP = `.sidebar__nav { margin: 0 -10px !important; padding: 0 10px 8px !important; scroll-padding-inline: 0 !important;
  -webkit-mask-image: linear-gradient(to right, currentColor calc(100% - 28px), transparent) !important;
  mask-image: linear-gradient(to right, currentColor calc(100% - 28px), transparent) !important; }`;
const control = process.env.CONTROL === 'old';
let failed = false;
const outside = [];
for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
  await context.addInitScript((t) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('cc_suite_theme', t);
      sessionStorage.setItem('seeded', '1');
    }
  }, theme);
  await context.addCookies([{ name: 'sessionToken', value: token, url: BASE, sameSite: 'Strict' }]);
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForSelector('.sidebar__nav a');
  if (control) await page.addStyleTag({ content: OLD_STRIP });
  await page.waitForTimeout(500);
  // Keyboard only: Tab from the top of the page, and check each strip item the moment it takes focus.
  await page.evaluate(() => document.activeElement?.blur());
  const seen = new Set();
  for (let step = 0; step < 80 && seen.size < 40; step += 1) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || !el.closest('.sidebar__nav a')) return null;
      const nav = document.querySelector('.sidebar__nav').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      const ring = 4; // outline 2 px wide, 2 px out
      return {
        label: el.textContent.trim(),
        nav: { left: nav.left, right: nav.right, top: nav.top, bottom: nav.bottom },
        outline: { left: r.left - ring, right: r.right + ring, top: r.top - ring, bottom: r.bottom + ring },
      };
    });
    if (!hit || seen.has(hit.label)) continue;
    seen.add(hit.label);
    const inside = hit.outline.left >= hit.nav.left && hit.outline.right <= hit.nav.right
      && hit.outline.top >= hit.nav.top && hit.outline.bottom <= hit.nav.bottom;
    if (!inside) {
      failed = true;
      outside.push({ theme, item: hit.label });
    }
    results.push({ theme, item: hit.label, inside, nav: hit.nav, outline: hit.outline });
    if (/Notifications/.test(hit.label)) {
      await page.screenshot({ path: path.join(here, 'shots', `strip-focus-bell-${theme}-${control ? 'old' : 'new'}-390.png`), clip: { x: 0, y: 0, width: 390, height: 110 } });
    }
  }
  await context.close();
}
writeFileSync(path.join(here, control ? 'strip-focus-check-control-old.json' : 'strip-focus-check.json'), `${JSON.stringify({ control, failed, outside, results }, null, 2)}\n`);
await browser.close();
console.log(`${control ? 'CONTROL (old strip CSS)' : 'STRIP FOCUS'}: ${results.length} focused items, ${outside.length} with a ring outside the strip`);
process.exit(!control && failed ? 1 : 0);

// Captures the Codex main pages at 1280x860 and 390x844, in dark and light, from a local instance.
//
// Usage: node capture.mjs <out-dir>
// Environment (none of it is stored here):
//   CAPTURE_PASSWORD  the sign-in password of CAPTURE_USER (the local seed account)
//   CAPTURE_USER      the sign-in name (default alice)
//   CAPTURE_BASE      the suite-off instance, e.g. http://127.0.0.1:3917
//   CAPTURE_SUITE     the suite-on instance, e.g. http://127.0.0.1:3918 (Account only)
//   CHROME_PATH       a Chromium executable (a Playwright browser build)
// The theme is set on the root's data-theme attribute, since the switch lands in W6-CDX-44.

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: node capture.mjs <out-dir>');
const { CAPTURE_PASSWORD, CHROME_PATH } = process.env;
const USER = process.env.CAPTURE_USER ?? 'alice';
const OFF = process.env.CAPTURE_BASE;
const ON = process.env.CAPTURE_SUITE;
if (!CAPTURE_PASSWORD || !CHROME_PATH || !OFF || !ON) throw new Error('set CAPTURE_PASSWORD, CHROME_PATH, CAPTURE_BASE, CAPTURE_SUITE');

const WIDTHS = [{ name: '1280', width: 1280, height: 860 }, { name: '390', width: 390, height: 844 }];
const THEMES = ['dark', 'light'];
const PAGES = [
  { name: 'home', base: OFF, route: '/' },
  { name: 'archive-list', base: OFF, route: '/archives' },
  { name: 'archive-view', base: OFF, route: '/archives/1' },
  { name: 'document-read', base: OFF, route: '/archives/1/doc/1' },
  { name: 'document-edit', base: OFF, route: '/editor/1' },
  { name: 'account-suite-on', base: ON, route: '/account' },
  { name: 'account', base: OFF, route: '/account', section: true },
  { name: 'admin', base: OFF, route: '/admin' },
  { name: 'notifications', base: OFF, route: '/notifications' },
];
const ACCENTS = ['nova', 'cyan'];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ['--no-sandbox'] });
const failures = [];

// One sign-in per instance (the login route is rate-limited); later contexts start from its stored cookies.
const sessions = new Map();
async function signedIn(base, width, height) {
  const viewport = { width, height };
  if (!sessions.has(base)) {
    const probe = await browser.newContext({ viewport });
    if (base === ON && process.env.CAPTURE_SESSION_TOKEN) {
      // The suite-on instance refuses a password for an issuer-linked account, so its session is a row the
      // issuer would have minted (auth_provider oidc), presented as the cookie.
      await probe.addCookies([{ name: 'sessionToken', value: process.env.CAPTURE_SESSION_TOKEN, url: base }]);
    } else {
      const login = await probe.request.post(`${base}/api/login`, {
        data: { username: USER, password: CAPTURE_PASSWORD },
      });
      if (!login.ok()) throw new Error(`login to ${base} failed: ${login.status()}`);
      // The client stores the token it is handed (components/Login.jsx, setSessionCookie), so the capture does the same.
      const { token } = await login.json();
      await probe.addCookies([{ name: 'sessionToken', value: token, url: base }]);
    }
    sessions.set(base, await probe.storageState());
    await probe.close();
  }
  return browser.newContext({ viewport, deviceScaleFactor: 1, storageState: sessions.get(base) });
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  // The first-run dialog opens over a new account's first page; the capture dismisses it, as a person would.
  const dismiss = page.getByRole('button', { name: 'Get Started' });
  if (await dismiss.count()) await dismiss.first().click().catch(() => {});
  await page.waitForTimeout(700);
}

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    for (const spec of PAGES) {
      const context = await signedIn(spec.base, width.width, width.height);
      const page = await context.newPage();
      try {
        await page.goto(`${spec.base}${spec.route}`, { waitUntil: 'domcontentloaded' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await settle(page);
        const file = path.join(outDir, `${spec.name}-${width.name}-${theme}.png`);
        if (spec.section) {
          const section = page.locator('.pref-section', { hasText: 'Accent Color' }).first();
          await section.scrollIntoViewIfNeeded();
          await section.screenshot({ path: file.replace('.png', '-accent-section.png') });
        }
        await page.screenshot({ path: file });
      } catch (err) {
        failures.push(`${spec.name} ${width.name} ${theme}: ${err.message}`);
      } finally {
        await context.close();
      }
    }
    // The accent picker, on two hues, from a stored preference applied at boot.
    for (const accent of ACCENTS) {
      const context = await signedIn(OFF, width.width, width.height);
      const page = await context.newPage();
      try {
        await page.goto(`${OFF}/account`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(({ a }) => localStorage.setItem('c2-user-prefs', JSON.stringify({ accentColor: a })), { a: accent });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await settle(page);
        const section = page.locator('.pref-section', { hasText: 'Accent Color' }).first();
        await section.scrollIntoViewIfNeeded();
        await section.screenshot({ path: path.join(outDir, `accent-${accent}-${width.name}-${theme}.png`) });
      } catch (err) {
        failures.push(`accent ${accent} ${width.name} ${theme}: ${err.message}`);
      } finally {
        await context.close();
      }
    }
  }
}
await browser.close();
console.log(failures.length ? `FAILURES:\n${failures.join('\n')}` : 'all captures written');
